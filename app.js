/**
 * Move – Global decentralized transport booking on BOT Chain
 * Vanilla JS + ethers.js v6
 */

const BOT_CHAIN = {
  chainId: 677,
  chainIdHex: '0x2a5',
  name: 'BOT Chain',
  rpcUrl: 'https://rpc.botchain.ai',
  explorer: 'https://scan.botchain.ai',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  usdtAddress: '0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C'
};

// Update after deployment
const CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000000';

const CONTRACT_ABI = [
  "function owner() view returns (address)",
  "function nextOperatorId() view returns (uint256)",
  "function nextRouteId() view returns (uint256)",
  "function walletToOperatorId(address) view returns (uint256)",
  "function operators(uint256) view returns (uint256 id, address wallet, string companyName, string contactPhone, string contactEmail, string logoUri, bool isVerified, bool isActive, uint256 registeredAt)",
  "function vehicles(uint256) view returns (uint256 id, uint256 operatorId, string plateNumber, string vehicleType, string model, uint256 seatCapacity, bool isActive, uint256 registeredAt)",
  "function routes(uint256) view returns (uint256 id, uint256 operatorId, uint256 vehicleId, string origin, string destination, uint256 departureTimestamp, uint256 durationMinutes, uint256 fareBOT, uint256 fareUSDT, uint256 totalSeats, uint256 availableSeats, bool isActive, string additionalInfo)",
  "function bookings(uint256) view returns (uint256 id, uint256 routeId, address passenger, uint256 seatsBooked, uint256 amountPaid, address paymentToken, uint8 status, uint256 bookedAt, uint256 cancelledAt, string passengerName, string passengerPhone)",
  "function registerOperator(string,string,string,string) returns (uint256)",
  "function registerVehicle(uint256,string,string,string,uint256) returns (uint256)",
  "function createRoute(uint256,uint256,string,string,uint256,uint256,uint256,uint256,string) returns (uint256)",
  "function bookWithBOT(uint256,uint256,string,string) payable returns (uint256)",
  "function bookWithUSDT(uint256,uint256,string,string) returns (uint256)",
  "function cancelBooking(uint256)",
  "function verifyOperator(uint256,bool)",
  "function searchRoutes(string,string) view returns (uint256[])",
  "function getPassengerBookings(address) view returns (uint256[])",
  "function getOperatorRoutes(uint256) view returns (uint256[])"
];

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)"
];

let provider, signer, contract, userAddress, userRole, operatorId = 0, currentBookingRoute = null;

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 4000);
}

function shortAddr(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }
function formatBOT(w) { try { return parseFloat(ethers.formatEther(w)).toFixed(4); } catch { return '0'; } }
function formatUSDT(a) { try { return (Number(a) / 1e6).toFixed(2); } catch { return '0'; } }
function tsToLocal(ts) { return new Date(Number(ts) * 1000).toLocaleString(); }
function scrollToId(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }
function toggleFaq(btn) { btn.parentElement.classList.toggle('open'); }

function swapLocations() {
  const o = document.getElementById('searchOrigin');
  const d = document.getElementById('searchDestination');
  [o.value, d.value] = [d.value, o.value];
}

function showSection(name) {
  document.getElementById('landingSection').classList.toggle('hidden', name !== 'landing');
  ['passengerDashboard', 'operatorDashboard', 'adminDashboard'].forEach(id =>
    document.getElementById(id).classList.add('hidden')
  );
  if (name === 'passenger') document.getElementById('passengerDashboard').classList.remove('hidden');
  if (name === 'operator') document.getElementById('operatorDashboard').classList.remove('hidden');
  if (name === 'admin') document.getElementById('adminDashboard').classList.remove('hidden');
  window.scrollTo(0, 0);
}

function switchTab(btn) {
  const parent = btn.closest('.dash-body');
  parent.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  parent.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(btn.dataset.tab).classList.add('active');
}

// ── Wallet ────────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) {
    showToast('Install MetaMask or BO Wallet', 'error');
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    userAddress = accounts[0];

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BOT_CHAIN.chainIdHex }]
      });
    } catch (e) {
      if (e.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: BOT_CHAIN.chainIdHex,
            chainName: BOT_CHAIN.name,
            nativeCurrency: BOT_CHAIN.nativeCurrency,
            rpcUrls: [BOT_CHAIN.rpcUrl],
            blockExplorerUrls: [BOT_CHAIN.explorer]
          }]
        });
      } else throw e;
    }

    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== BOT_CHAIN.chainId) {
      showToast('Switch to BOT Chain (ID 677)', 'error');
      return;
    }

    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    await identifyRole();

    document.getElementById('connectBtn').classList.add('hidden');
    document.getElementById('dashboardBtn').classList.remove('hidden');
    showToast('Connected: ' + shortAddr(userAddress));
    openDashboard();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Connection failed', 'error');
  }
}

async function identifyRole() {
  try {
    const owner = await contract.owner();
    if (owner.toLowerCase() === userAddress.toLowerCase()) {
      userRole = 'admin';
      return;
    }
    const opId = await contract.walletToOperatorId(userAddress);
    if (Number(opId) > 0) {
      operatorId = Number(opId);
      userRole = 'operator';
      return;
    }
    userRole = 'passenger';
  } catch {
    userRole = 'passenger';
  }
}

function openDashboard() {
  if (!userAddress) return connectWallet();
  if (userRole === 'admin') {
    document.getElementById('adminAddress').textContent = shortAddr(userAddress);
    showSection('admin');
  } else if (userRole === 'operator') {
    document.getElementById('operatorAddress').textContent = shortAddr(userAddress);
    loadOperatorProfile();
    showSection('operator');
  } else {
    document.getElementById('passengerAddress').textContent = shortAddr(userAddress);
    loadPassengerBookings();
    showSection('passenger');
  }
}

function disconnectWallet() {
  userAddress = signer = contract = userRole = null;
  operatorId = 0;
  document.getElementById('connectBtn').classList.remove('hidden');
  document.getElementById('dashboardBtn').classList.add('hidden');
  showSection('landing');
  showToast('Disconnected');
}

// ── Search ────────────────────────────────────────────────
async function searchRoutes() {
  const origin = document.getElementById('searchOrigin').value.trim();
  const dest = document.getElementById('searchDestination').value.trim();
  if (!origin || !dest) return showToast('Enter origin and destination', 'error');
  await performSearch(origin, dest, 'searchResults');
}

function quickSearch(o, d) {
  document.getElementById('searchOrigin').value = o;
  document.getElementById('searchDestination').value = d;
  searchRoutes();
  scrollToId('search');
}

async function passengerSearch() {
  const o = document.getElementById('pOrigin').value.trim();
  const d = document.getElementById('pDestination').value.trim();
  if (!o || !d) return showToast('Enter origin and destination', 'error');
  await performSearch(o, d, 'pSearchResults');
}

async function performSearch(origin, dest, containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = '<p class="empty">Searching on-chain…</p>';

  if (!contract || CONTRACT_ADDRESS.startsWith('0x0000')) {
    el.innerHTML = renderDemo(origin, dest);
    return;
  }

  try {
    const ids = await contract.searchRoutes(origin, dest);
    if (!ids.length) {
      el.innerHTML = `<p class="empty">No active routes for ${origin} → ${dest}. Operators can publish new ones.</p>`;
      return;
    }
    let html = '';
    for (const id of ids) {
      const r = await contract.routes(id);
      const op = await contract.operators(r.operatorId);
      const v = await contract.vehicles(r.vehicleId);
      html += routeCard(id, r, op, v);
    }
    el.innerHTML = html;
  } catch (e) {
    console.error(e);
    el.innerHTML = renderDemo(origin, dest);
    showToast('Showing demo data (contract not live)', 'error');
  }
}

function renderDemo(origin, dest) {
  const samples = [
    { id: 1, origin, dest, dep: Date.now() + 864e5 * 1.5, dur: 180, bot: '8.0', usdt: '5.50', seats: 9, total: 14, op: 'Express Line', veh: 'Coach · XL-902', info: 'AC · WiFi' },
    { id: 2, origin, dest, dep: Date.now() + 864e5 * 2.2, dur: 210, bot: '6.5', usdt: '4.20', seats: 12, total: 18, op: 'CityLink', veh: 'Bus · AB-441', info: 'Luggage included' }
  ];
  return samples.map(s => `
    <div class="result-card">
      <div>
        <div class="title">${s.origin} → ${s.dest}</div>
        <div class="meta">${new Date(s.dep).toLocaleString()} · ~${s.dur} min<br/>${s.op} · ${s.veh}<br/>${s.info}</div>
      </div>
      <div>
        <div class="price">${s.bot} BOT / ${s.usdt} USDT</div>
        <div class="seats">${s.seats} seats left</div>
        <button class="btn btn-primary btn-sm" style="margin-top:.4rem" onclick="openBookingDemo(${s.id},'${s.origin}','${s.dest}','${s.bot}','${s.usdt}',${s.seats})">Book</button>
      </div>
    </div>
  `).join('');
}

function routeCard(id, r, op, v) {
  return `
    <div class="result-card">
      <div>
        <div class="title">${r.origin} → ${r.destination}</div>
        <div class="meta">${tsToLocal(r.departureTimestamp)} · ~${r.durationMinutes} min<br/>
          ${op.companyName} · ${v.vehicleType} ${v.model} (${v.plateNumber})<br/>${r.additionalInfo || ''}</div>
      </div>
      <div>
        <div class="price">${formatBOT(r.fareBOT)} BOT / ${formatUSDT(r.fareUSDT)} USDT</div>
        <div class="seats">${r.availableSeats}/${r.totalSeats} seats</div>
        <button class="btn btn-primary btn-sm" style="margin-top:.4rem" onclick="openBookingModal(${id})">Book</button>
      </div>
    </div>`;
}

// ── Booking ───────────────────────────────────────────────
async function openBookingModal(routeId) {
  if (!userAddress) return showToast('Connect wallet first', 'error');
  try {
    const r = await contract.routes(routeId);
    currentBookingRoute = { id: routeId, ...r };
    document.getElementById('bookingSummary').innerHTML =
      `<strong>${r.origin} → ${r.destination}</strong><br/>${tsToLocal(r.departureTimestamp)} · ${r.availableSeats} seats left`;
    document.getElementById('bookSeats').max = Number(r.availableSeats);
    document.getElementById('bookingModal').classList.remove('hidden');
    updateTotal();
  } catch { showToast('Could not load route', 'error'); }
}

function openBookingDemo(id, origin, dest, bot, usdt, seats) {
  if (!userAddress) { showToast('Connect wallet to book', 'error'); return connectWallet(); }
  currentBookingRoute = {
    id, origin, destination: dest,
    fareBOT: ethers.parseEther(bot),
    fareUSDT: BigInt(Math.round(parseFloat(usdt) * 1e6)),
    availableSeats: seats, demo: true
  };
  document.getElementById('bookingSummary').innerHTML =
    `<strong>${origin} → ${dest}</strong><br/>Demo route · ${seats} seats available`;
  document.getElementById('bookSeats').max = seats;
  document.getElementById('bookingModal').classList.remove('hidden');
  updateTotal();
}

function updateTotal() {
  if (!currentBookingRoute) return;
  const seats = Number(document.getElementById('bookSeats').value) || 1;
  const method = document.getElementById('bookPayment').value;
  const total = method === 'BOT'
    ? formatBOT(currentBookingRoute.fareBOT * BigInt(seats)) + ' BOT'
    : formatUSDT(currentBookingRoute.fareUSDT * BigInt(seats)) + ' USDT';
  document.getElementById('bookingTotal').textContent = 'Total: ' + total;
}

document.getElementById('bookSeats')?.addEventListener('input', updateTotal);
document.getElementById('bookPayment')?.addEventListener('change', updateTotal);

function closeModal() {
  document.getElementById('bookingModal').classList.add('hidden');
  document.getElementById('bookingStatus').textContent = '';
  currentBookingRoute = null;
}

async function confirmBooking() {
  const name = document.getElementById('bookName').value.trim();
  const phone = document.getElementById('bookPhone').value.trim();
  const seats = Number(document.getElementById('bookSeats').value);
  const method = document.getElementById('bookPayment').value;
  const status = document.getElementById('bookingStatus');

  if (!name || !phone) return showToast('Enter name and phone', 'error');
  if (!currentBookingRoute) return;

  if (currentBookingRoute.demo || CONTRACT_ADDRESS.startsWith('0x0000')) {
    status.innerHTML = '<span style="color:var(--green)">Demo booking recorded. Deploy the contract to enable real on-chain bookings.</span>';
    showToast('Demo booking successful');
    setTimeout(closeModal, 2500);
    return;
  }

  const btn = document.getElementById('confirmBookBtn');
  btn.disabled = true;
  status.textContent = 'Confirming…';

  try {
    let tx;
    if (method === 'BOT') {
      const total = currentBookingRoute.fareBOT * BigInt(seats);
      tx = await contract.bookWithBOT(currentBookingRoute.id, seats, name, phone, { value: total });
    } else {
      const usdt = new ethers.Contract(BOT_CHAIN.usdtAddress, ERC20_ABI, signer);
      const total = currentBookingRoute.fareUSDT * BigInt(seats);
      const allowance = await usdt.allowance(userAddress, CONTRACT_ADDRESS);
      if (allowance < total) {
        status.textContent = 'Approving USDT…';
        await (await usdt.approve(CONTRACT_ADDRESS, total)).wait();
      }
      status.textContent = 'Paying with USDT…';
      tx = await contract.bookWithUSDT(currentBookingRoute.id, seats, name, phone);
    }
    status.textContent = 'Waiting for confirmation…';
    const receipt = await tx.wait();
    status.innerHTML = `<span style="color:var(--green)">Booked! <a href="${BOT_CHAIN.explorer}/tx/${receipt.hash}" target="_blank" style="color:var(--accent-2)">${receipt.hash.slice(0,10)}…</a></span>`;
    showToast('Booking confirmed');
    loadPassengerBookings();
    setTimeout(closeModal, 3000);
  } catch (err) {
    status.innerHTML = `<span style="color:#ef4444">${err.reason || err.message || 'Failed'}</span>`;
  } finally {
    btn.disabled = false;
  }
}

// ── Passenger bookings ────────────────────────────────────
async function loadPassengerBookings() {
  const active = document.getElementById('activeBookings');
  const history = document.getElementById('travelHistory');
  if (!contract || CONTRACT_ADDRESS.startsWith('0x0000')) {
    active.innerHTML = '<p class="empty">Deploy contract to see on-chain bookings.</p>';
    history.innerHTML = '<p class="empty">No history yet.</p>';
    return;
  }
  try {
    const ids = await contract.getPassengerBookings(userAddress);
    if (!ids.length) {
      active.innerHTML = '<p class="empty">No bookings yet.</p>';
      history.innerHTML = '<p class="empty">No history yet.</p>';
      return;
    }
    let aHtml = '', hHtml = '';
    for (const id of ids) {
      const b = await contract.bookings(id);
      const r = await contract.routes(b.routeId);
      const statuses = ['Pending', 'Confirmed', 'Cancelled', 'Completed', 'Refunded'];
      const card = `
        <div class="result-card">
          <div>
            <div class="title">${r.origin} → ${r.destination}</div>
            <div class="meta">#${id} · ${b.seatsBooked} seat(s) · ${tsToLocal(b.bookedAt)}<br/>Status: ${statuses[b.status]}</div>
          </div>
          <div>
            ${b.status === 1 && Number(r.departureTimestamp) > Date.now() / 1000 + 7200
              ? `<button class="btn btn-ghost btn-sm" onclick="cancelBooking(${id})">Cancel & Refund</button>` : ''}
            <button class="btn btn-primary btn-sm" style="margin-top:.3rem" onclick="showQR(${id})">QR</button>
          </div>
        </div>`;
      if (b.status === 1) aHtml += card; else hHtml += card;
    }
    active.innerHTML = aHtml || '<p class="empty">No active bookings.</p>';
    history.innerHTML = hHtml || '<p class="empty">No past trips.</p>';
  } catch (e) { console.error(e); }
}

async function cancelBooking(id) {
  if (!confirm('Cancel and receive 90% refund?')) return;
  try {
    const tx = await contract.cancelBooking(id);
    showToast('Cancellation submitted…');
    await tx.wait();
    showToast('Cancelled & refunded');
    loadPassengerBookings();
  } catch (e) { showToast(e.reason || e.message, 'error'); }
}

function showQR(id) {
  showToast(`Booking QR: Move:Booking:${id}:${userAddress}`);
}

// ── Operator ──────────────────────────────────────────────
async function registerOperator() {
  const name = document.getElementById('opCompanyName').value.trim();
  const phone = document.getElementById('opPhone').value.trim();
  const email = document.getElementById('opEmail').value.trim();
  const logo = document.getElementById('opLogo').value.trim() || '';
  if (!name) return showToast('Company name required', 'error');
  if (!contract || CONTRACT_ADDRESS.startsWith('0x0000')) return showToast('Deploy contract first', 'error');
  try {
    const tx = await contract.registerOperator(name, phone, email, logo);
    showToast('Registering…');
    await tx.wait();
    showToast('Operator registered');
    await identifyRole();
    loadOperatorProfile();
  } catch (e) { showToast(e.reason || e.message, 'error'); }
}

async function loadOperatorProfile() {
  if (!operatorId) {
    document.getElementById('registerOperatorForm').classList.remove('hidden');
    document.getElementById('operatorProfileView').classList.add('hidden');
    return;
  }
  try {
    const op = await contract.operators(operatorId);
    document.getElementById('registerOperatorForm').classList.add('hidden');
    document.getElementById('operatorProfileView').classList.remove('hidden');
    document.getElementById('opProfileDetails').innerHTML = `
      <p><strong>${op.companyName}</strong></p>
      <p>${op.contactPhone} · ${op.contactEmail}</p>
      <p>Verified: ${op.isVerified ? 'Yes' : 'Pending'}</p>
      <p>Since: ${tsToLocal(op.registeredAt)}</p>`;
    document.getElementById('operatorStatus').textContent = op.isVerified ? 'Verified' : 'Unverified';
    loadOperatorRoutes();
  } catch (e) { console.error(e); }
}

async function registerVehicle() {
  if (!operatorId) return showToast('Register as operator first', 'error');
  const plate = document.getElementById('vehPlate').value.trim();
  const type = document.getElementById('vehType').value;
  const model = document.getElementById('vehModel').value.trim();
  const seats = Number(document.getElementById('vehSeats').value);
  if (!plate || !seats) return showToast('Fill required fields', 'error');
  try {
    const tx = await contract.registerVehicle(operatorId, plate, type, model, seats);
    showToast('Adding vehicle…');
    await tx.wait();
    showToast('Vehicle added');
  } catch (e) { showToast(e.reason || e.message, 'error'); }
}

async function createRoute() {
  if (!operatorId) return showToast('Register as operator first', 'error');
  const vehicleId = Number(document.getElementById('routeVehicleId').value);
  const origin = document.getElementById('routeOrigin').value.trim();
  const dest = document.getElementById('routeDestination').value.trim();
  const depLocal = document.getElementById('routeDeparture').value;
  const duration = Number(document.getElementById('routeDuration').value);
  const fareBOT = document.getElementById('routeFareBOT').value;
  const fareUSDT = document.getElementById('routeFareUSDT').value;
  const info = document.getElementById('routeInfo').value.trim();

  if (!vehicleId || !origin || !dest || !depLocal) return showToast('Fill required fields', 'error');

  const depTs = Math.floor(new Date(depLocal).getTime() / 1000);
  const botWei = fareBOT ? ethers.parseEther(fareBOT) : 0n;
  const usdtUnits = fareUSDT ? BigInt(Math.round(parseFloat(fareUSDT) * 1e6)) : 0n;

  try {
    const tx = await contract.createRoute(operatorId, vehicleId, origin, dest, depTs, duration, botWei, usdtUnits, info);
    showToast('Publishing route…');
    await tx.wait();
    showToast('Route published');
    loadOperatorRoutes();
  } catch (e) { showToast(e.reason || e.message, 'error'); }
}

async function loadOperatorRoutes() {
  const el = document.getElementById('routeList');
  if (!operatorId || !contract) return;
  try {
    const ids = await contract.getOperatorRoutes(operatorId);
    if (!ids.length) {
      el.innerHTML = '<p class="empty">No routes yet.</p>';
      return;
    }
    let html = '';
    for (const id of ids) {
      const r = await contract.routes(id);
      html += `
        <div class="result-card">
          <div>
            <div class="title">${r.origin} → ${r.destination}</div>
            <div class="meta">#${id} · ${tsToLocal(r.departureTimestamp)} · ${r.availableSeats}/${r.totalSeats} seats<br/>
              ${formatBOT(r.fareBOT)} BOT / ${formatUSDT(r.fareUSDT)} USDT</div>
          </div>
        </div>`;
    }
    el.innerHTML = html;
  } catch (e) { console.error(e); }
}

// ── Admin ─────────────────────────────────────────────────
async function verifyOperator() {
  const id = Number(document.getElementById('verifyOpId').value);
  const verified = document.getElementById('verifyOpStatus').value === 'true';
  try {
    const tx = await contract.verifyOperator(id, verified);
    showToast('Updating…');
    await tx.wait();
    showToast('Verification updated');
  } catch (e) { showToast(e.reason || e.message, 'error'); }
}

function downloadWhitepaper() {
  window.open('../docs/Move_Whitepaper.pdf', '_blank');
}

document.getElementById('menuToggle')?.addEventListener('click', () => {
  document.getElementById('navLinks').classList.toggle('open');
});

if (window.ethereum) {
  window.ethereum.on('accountsChanged', () => disconnectWallet());
  window.ethereum.on('chainChanged', () => window.location.reload());
}

console.log('Move ready · BOT Chain');
