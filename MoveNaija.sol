// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MoveNaija
 * @dev Decentralized Nigerian Transport Booking Platform on BOT Chain
 * All permanent records (operators, vehicles, routes, bookings, payments) stored on-chain.
 */

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract MoveNaija {
    // ============ State Variables ============
    address public owner;
    address public usdtToken; // BOT Chain USDT: 0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C
    uint256 public platformFeeBps; // basis points (e.g. 200 = 2%)
    uint256 public nextOperatorId;
    uint256 public nextVehicleId;
    uint256 public nextRouteId;
    uint256 public nextBookingId;

    // ============ Structs ============
    struct Operator {
        uint256 id;
        address wallet;
        string companyName;
        string contactPhone;
        string contactEmail;
        string logoUri;
        bool isVerified;
        bool isActive;
        uint256 registeredAt;
    }

    struct Vehicle {
        uint256 id;
        uint256 operatorId;
        string plateNumber;
        string vehicleType; // Bus, MiniBus, Car, etc.
        string model;
        uint256 seatCapacity;
        bool isActive;
        uint256 registeredAt;
    }

    struct Route {
        uint256 id;
        uint256 operatorId;
        uint256 vehicleId;
        string origin;
        string destination;
        uint256 departureTimestamp;
        uint256 durationMinutes; // estimated travel time
        uint256 fareBOT; // in wei (18 decimals)
        uint256 fareUSDT; // in smallest unit (6 decimals)
        uint256 totalSeats;
        uint256 availableSeats;
        bool isActive;
        string additionalInfo;
    }

    enum BookingStatus { Pending, Confirmed, Cancelled, Completed, Refunded }

    struct Booking {
        uint256 id;
        uint256 routeId;
        address passenger;
        uint256 seatsBooked;
        uint256 amountPaid;
        address paymentToken; // address(0) for native BOT
        BookingStatus status;
        uint256 bookedAt;
        uint256 cancelledAt;
        string passengerName;
        string passengerPhone;
    }

    // ============ Mappings ============
    mapping(uint256 => Operator) public operators;
    mapping(address => uint256) public walletToOperatorId;
    mapping(uint256 => Vehicle) public vehicles;
    mapping(uint256 => Route) public routes;
    mapping(uint256 => Booking) public bookings;
    mapping(address => uint256[]) public passengerBookings;
    mapping(uint256 => uint256[]) public operatorRoutes; // operatorId => routeIds
    mapping(uint256 => uint256[]) public routeBookings; // routeId => bookingIds

    // Reviews
    struct Review {
        address reviewer;
        uint256 bookingId;
        uint8 rating; // 1-5
        string comment;
        uint256 timestamp;
    }
    mapping(uint256 => Review[]) public routeReviews; // routeId => reviews

    // ============ Events ============
    event OperatorRegistered(uint256 indexed operatorId, address indexed wallet, string companyName);
    event OperatorVerified(uint256 indexed operatorId, bool verified);
    event VehicleRegistered(uint256 indexed vehicleId, uint256 indexed operatorId, string plateNumber);
    event RouteCreated(uint256 indexed routeId, uint256 indexed operatorId, string origin, string destination, uint256 departureTimestamp);
    event BookingCreated(uint256 indexed bookingId, uint256 indexed routeId, address indexed passenger, uint256 seats, uint256 amount);
    event BookingConfirmed(uint256 indexed bookingId);
    event BookingCancelled(uint256 indexed bookingId, address indexed by);
    event RefundProcessed(uint256 indexed bookingId, address indexed passenger, uint256 amount);
    event PlatformFeeUpdated(uint256 newFeeBps);
    event ReviewSubmitted(uint256 indexed routeId, address indexed reviewer, uint8 rating);

    // ============ Modifiers ============
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOperator(uint256 operatorId) {
        require(operators[operatorId].wallet == msg.sender, "Not operator");
        require(operators[operatorId].isActive, "Operator inactive");
        _;
    }

    modifier onlyVerifiedOperator(uint256 operatorId) {
        require(operators[operatorId].wallet == msg.sender, "Not operator");
        require(operators[operatorId].isVerified, "Not verified");
        require(operators[operatorId].isActive, "Operator inactive");
        _;
    }

    // ============ Constructor ============
    constructor(address _usdtToken, uint256 _platformFeeBps) {
        owner = msg.sender;
        usdtToken = _usdtToken;
        platformFeeBps = _platformFeeBps;
        nextOperatorId = 1;
        nextVehicleId = 1;
        nextRouteId = 1;
        nextBookingId = 1;
    }

    // ============ Admin Functions ============
    function setPlatformFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "Fee too high"); // max 10%
        platformFeeBps = _feeBps;
        emit PlatformFeeUpdated(_feeBps);
    }

    function setUSDTToken(address _usdt) external onlyOwner {
        usdtToken = _usdt;
    }

    function verifyOperator(uint256 operatorId, bool verified) external onlyOwner {
        require(operators[operatorId].id != 0, "Operator not found");
        operators[operatorId].isVerified = verified;
        emit OperatorVerified(operatorId, verified);
    }

    function withdrawFees(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            payable(owner).transfer(amount);
        } else {
            IERC20(token).transfer(owner, amount);
        }
    }

    // ============ Operator Registration ============
    function registerOperator(
        string calldata companyName,
        string calldata contactPhone,
        string calldata contactEmail,
        string calldata logoUri
    ) external returns (uint256) {
        require(walletToOperatorId[msg.sender] == 0, "Already registered");
        require(bytes(companyName).length > 0, "Name required");

        uint256 id = nextOperatorId++;
        operators[id] = Operator({
            id: id,
            wallet: msg.sender,
            companyName: companyName,
            contactPhone: contactPhone,
            contactEmail: contactEmail,
            logoUri: logoUri,
            isVerified: false,
            isActive: true,
            registeredAt: block.timestamp
        });
        walletToOperatorId[msg.sender] = id;

        emit OperatorRegistered(id, msg.sender, companyName);
        return id;
    }

    function updateOperatorProfile(
        uint256 operatorId,
        string calldata companyName,
        string calldata contactPhone,
        string calldata contactEmail,
        string calldata logoUri
    ) external onlyOperator(operatorId) {
        Operator storage op = operators[operatorId];
        op.companyName = companyName;
        op.contactPhone = contactPhone;
        op.contactEmail = contactEmail;
        op.logoUri = logoUri;
    }

    // ============ Vehicle Registration ============
    function registerVehicle(
        uint256 operatorId,
        string calldata plateNumber,
        string calldata vehicleType,
        string calldata model,
        uint256 seatCapacity
    ) external onlyOperator(operatorId) returns (uint256) {
        require(seatCapacity > 0 && seatCapacity <= 100, "Invalid capacity");
        require(bytes(plateNumber).length > 0, "Plate required");

        uint256 id = nextVehicleId++;
        vehicles[id] = Vehicle({
            id: id,
            operatorId: operatorId,
            plateNumber: plateNumber,
            vehicleType: vehicleType,
            model: model,
            seatCapacity: seatCapacity,
            isActive: true,
            registeredAt: block.timestamp
        });

        emit VehicleRegistered(id, operatorId, plateNumber);
        return id;
    }

    // ============ Route Management ============
    function createRoute(
        uint256 operatorId,
        uint256 vehicleId,
        string calldata origin,
        string calldata destination,
        uint256 departureTimestamp,
        uint256 durationMinutes,
        uint256 fareBOT,
        uint256 fareUSDT,
        string calldata additionalInfo
    ) external onlyVerifiedOperator(operatorId) returns (uint256) {
        require(vehicles[vehicleId].operatorId == operatorId, "Vehicle not yours");
        require(vehicles[vehicleId].isActive, "Vehicle inactive");
        require(departureTimestamp > block.timestamp, "Departure must be future");
        require(bytes(origin).length > 0 && bytes(destination).length > 0, "Locations required");
        require(fareBOT > 0 || fareUSDT > 0, "Fare required");

        uint256 seats = vehicles[vehicleId].seatCapacity;
        uint256 id = nextRouteId++;

        routes[id] = Route({
            id: id,
            operatorId: operatorId,
            vehicleId: vehicleId,
            origin: origin,
            destination: destination,
            departureTimestamp: departureTimestamp,
            durationMinutes: durationMinutes,
            fareBOT: fareBOT,
            fareUSDT: fareUSDT,
            totalSeats: seats,
            availableSeats: seats,
            isActive: true,
            additionalInfo: additionalInfo
        });

        operatorRoutes[operatorId].push(id);
        emit RouteCreated(id, operatorId, origin, destination, departureTimestamp);
        return id;
    }

    function updateRouteSeats(uint256 routeId, uint256 newAvailable) external {
        Route storage r = routes[routeId];
        require(operators[r.operatorId].wallet == msg.sender, "Not operator");
        require(newAvailable <= r.totalSeats, "Exceeds capacity");
        r.availableSeats = newAvailable;
    }

    function deactivateRoute(uint256 routeId) external {
        Route storage r = routes[routeId];
        require(operators[r.operatorId].wallet == msg.sender || msg.sender == owner, "Not authorized");
        r.isActive = false;
    }

    // ============ Booking ============
    function bookWithBOT(
        uint256 routeId,
        uint256 seats,
        string calldata passengerName,
        string calldata passengerPhone
    ) external payable returns (uint256) {
        Route storage r = routes[routeId];
        require(r.isActive, "Route inactive");
        require(r.departureTimestamp > block.timestamp, "Route departed");
        require(seats > 0 && seats <= r.availableSeats, "Not enough seats");
        require(r.fareBOT > 0, "BOT payment not supported for this route");

        uint256 totalFare = r.fareBOT * seats;
        require(msg.value >= totalFare, "Insufficient BOT");

        // Seat lock
        r.availableSeats -= seats;

        uint256 bookingId = nextBookingId++;
        bookings[bookingId] = Booking({
            id: bookingId,
            routeId: routeId,
            passenger: msg.sender,
            seatsBooked: seats,
            amountPaid: totalFare,
            paymentToken: address(0),
            status: BookingStatus.Confirmed,
            bookedAt: block.timestamp,
            cancelledAt: 0,
            passengerName: passengerName,
            passengerPhone: passengerPhone
        });

        passengerBookings[msg.sender].push(bookingId);
        routeBookings[routeId].push(bookingId);

        // Platform fee
        uint256 fee = (totalFare * platformFeeBps) / 10000;
        uint256 operatorAmount = totalFare - fee;

        // Transfer to operator
        address operatorWallet = operators[r.operatorId].wallet;
        payable(operatorWallet).transfer(operatorAmount);
        // Fee stays in contract

        // Refund excess
        if (msg.value > totalFare) {
            payable(msg.sender).transfer(msg.value - totalFare);
        }

        emit BookingCreated(bookingId, routeId, msg.sender, seats, totalFare);
        emit BookingConfirmed(bookingId);
        return bookingId;
    }

    function bookWithUSDT(
        uint256 routeId,
        uint256 seats,
        string calldata passengerName,
        string calldata passengerPhone
    ) external returns (uint256) {
        Route storage r = routes[routeId];
        require(r.isActive, "Route inactive");
        require(r.departureTimestamp > block.timestamp, "Route departed");
        require(seats > 0 && seats <= r.availableSeats, "Not enough seats");
        require(r.fareUSDT > 0, "USDT payment not supported");

        uint256 totalFare = r.fareUSDT * seats;

        // Transfer USDT from passenger
        require(IERC20(usdtToken).transferFrom(msg.sender, address(this), totalFare), "USDT transfer failed");

        r.availableSeats -= seats;

        uint256 bookingId = nextBookingId++;
        bookings[bookingId] = Booking({
            id: bookingId,
            routeId: routeId,
            passenger: msg.sender,
            seatsBooked: seats,
            amountPaid: totalFare,
            paymentToken: usdtToken,
            status: BookingStatus.Confirmed,
            bookedAt: block.timestamp,
            cancelledAt: 0,
            passengerName: passengerName,
            passengerPhone: passengerPhone
        });

        passengerBookings[msg.sender].push(bookingId);
        routeBookings[routeId].push(bookingId);

        // Platform fee
        uint256 fee = (totalFare * platformFeeBps) / 10000;
        uint256 operatorAmount = totalFare - fee;

        address operatorWallet = operators[r.operatorId].wallet;
        require(IERC20(usdtToken).transfer(operatorWallet, operatorAmount), "Operator transfer failed");
        // Fee remains in contract

        emit BookingCreated(bookingId, routeId, msg.sender, seats, totalFare);
        emit BookingConfirmed(bookingId);
        return bookingId;
    }

    // ============ Cancellation & Refund ============
    function cancelBooking(uint256 bookingId) external {
        Booking storage b = bookings[bookingId];
        require(b.passenger == msg.sender || operators[routes[b.routeId].operatorId].wallet == msg.sender || msg.sender == owner, "Not authorized");
        require(b.status == BookingStatus.Confirmed || b.status == BookingStatus.Pending, "Cannot cancel");

        Route storage r = routes[b.routeId];
        // Cancellation window: at least 2 hours before departure
        require(block.timestamp + 2 hours < r.departureTimestamp, "Too late to cancel");

        b.status = BookingStatus.Cancelled;
        b.cancelledAt = block.timestamp;
        r.availableSeats += b.seatsBooked;

        // Refund 90% (10% cancellation fee retained by platform)
        uint256 refundAmount = (b.amountPaid * 90) / 100;

        if (b.paymentToken == address(0)) {
            payable(b.passenger).transfer(refundAmount);
        } else {
            require(IERC20(b.paymentToken).transfer(b.passenger, refundAmount), "Refund failed");
        }

        b.status = BookingStatus.Refunded;
        emit BookingCancelled(bookingId, msg.sender);
        emit RefundProcessed(bookingId, b.passenger, refundAmount);
    }

    // ============ Reviews ============
    function submitReview(uint256 bookingId, uint8 rating, string calldata comment) external {
        require(rating >= 1 && rating <= 5, "Invalid rating");
        Booking storage b = bookings[bookingId];
        require(b.passenger == msg.sender, "Not your booking");
        require(b.status == BookingStatus.Confirmed || b.status == BookingStatus.Completed, "Invalid status");

        routeReviews[b.routeId].push(Review({
            reviewer: msg.sender,
            bookingId: bookingId,
            rating: rating,
            comment: comment,
            timestamp: block.timestamp
        }));

        emit ReviewSubmitted(b.routeId, msg.sender, rating);
    }

    // ============ View Functions ============
    function getOperator(uint256 operatorId) external view returns (Operator memory) {
        return operators[operatorId];
    }

    function getVehicle(uint256 vehicleId) external view returns (Vehicle memory) {
        return vehicles[vehicleId];
    }

    function getRoute(uint256 routeId) external view returns (Route memory) {
        return routes[routeId];
    }

    function getBooking(uint256 bookingId) external view returns (Booking memory) {
        return bookings[bookingId];
    }

    function getPassengerBookings(address passenger) external view returns (uint256[] memory) {
        return passengerBookings[passenger];
    }

    function getOperatorRoutes(uint256 operatorId) external view returns (uint256[] memory) {
        return operatorRoutes[operatorId];
    }

    function getRouteBookings(uint256 routeId) external view returns (uint256[] memory) {
        return routeBookings[routeId];
    }

    function getRouteReviews(uint256 routeId) external view returns (Review[] memory) {
        return routeReviews[routeId];
    }

    function searchRoutes(string calldata origin, string calldata destination) external view returns (uint256[] memory) {
        // Simple on-chain search (for small scale; off-chain indexing recommended for production)
        uint256 count = 0;
        for (uint256 i = 1; i < nextRouteId; i++) {
            if (routes[i].isActive &&
                keccak256(bytes(routes[i].origin)) == keccak256(bytes(origin)) &&
                keccak256(bytes(routes[i].destination)) == keccak256(bytes(destination)) &&
                routes[i].departureTimestamp > block.timestamp &&
                routes[i].availableSeats > 0) {
                count++;
            }
        }

        uint256[] memory results = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 1; i < nextRouteId; i++) {
            if (routes[i].isActive &&
                keccak256(bytes(routes[i].origin)) == keccak256(bytes(origin)) &&
                keccak256(bytes(routes[i].destination)) == keccak256(bytes(destination)) &&
                routes[i].departureTimestamp > block.timestamp &&
                routes[i].availableSeats > 0) {
                results[idx++] = i;
            }
        }
        return results;
    }

    // Fallback to receive BOT
    receive() external payable {}
}
