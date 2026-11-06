/**
 * Move – Global decentralized transport booking on BOT Chain
 * Vanilla JS + ethers.js v6
 */

const BOT_CHAIN = {
  chainId: 968,
  chainIdHex: '0x3c8',
  name: 'BOT Chain Testnet',
  rpcUrl: 'https://rpc.bohr.life',
  explorer: 'https://scan.bohr.life',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 }
};

const CONTRACT_ADDRESS = '0x13B45FEA3a0866cA298bb4d4498DB6752ab8e6F0';

const CONTRACT_ABI = [
  "function owner() view returns (address)",
  "function usdtToken() view returns (address)",
  "function platformFeeBps() view returns (uint256)",
  "function nextOperatorId() view returns (uint256)",
  "function nextVehicleId() view returns (uint256)",
  "function nextRouteId() view returns (uint256)",
  "function walletToOperatorId(address) view returns (uint256)",
  "function operators(uint256) view returns (uint256 id, address wallet, string companyName, string contactPhone, string contactEmail, string logoUri, bool isVerified, bool isActive, uint256 registeredAt)",
  "function vehicles(uint256) view returns (uint256 id, uint256 operatorId, string plateNumber, string vehicleType, string model, uint256 seatCapacity, bool isActive, uint256 registeredAt)",
  "function routes(uint256) view returns (uint256 id, uint256 operatorId, uint256 vehicleId, string origin, string destination, uint256 departureTimestamp, uint256 durationMinutes, uint256 fareBOT, uint256 fareUSDT, uint256 totalSeats, uint256 availableSeats, bool isActive, string additionalInfo)",
  "function bookings(uint256) view returns (uint256 id, uint256 routeId, address passenger, uint256 seatsBooked, uint256 amountPaid, address paymentToken, uint8 status, uint256 bookedAt, uint256 cancelledAt, string passengerName, string passengerPhone)",
  "function registerOperator(string,string,string,string) returns (uint256)",
  "function registerVehicle(uint256,string,string,string,uint256) returns (uint256)",
  "function createRoute(uint256 operatorId, tuple(uint256 vehicleId, string origin, string destination, uint256 departureTimestamp, uint256 durationMinutes, uint256 fareBOT, uint256 fareUSDT, string additionalInfo) p) returns (uint256)",
  "function deactivateRoute(uint256)",
  "function bookWithBOT(uint256,uint256,string,string) payable returns (uint256)",
  "function bookWithUSDT(uint256,uint256,string,string) returns (uint256)",
  "function cancelBooking(uint256)",
  "function submitReview(uint256,uint8,string)",
  "function verifyOperator(uint256,bool)",
  "function withdrawFees(address,uint256)",
  "function getPassengerBookings(address) view returns (uint256[])",
  "function getOperatorRoutes(uint256) view returns (uint256[])",
  "function getRouteBookings(uint256) view returns (uint256[])",
  "function getRouteReviews(uint256) view returns (tuple(address reviewer, uint256 bookingId, uint8 rating, string comment, uint256 timestamp)[])"
];

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const ZERO = ethers.ZeroAddress;
const BOOKING_STATUS = ['Pending', 'Confirmed', 'Cancelled', 'Completed', 'Refunded'];

// Read-only access works without a wallet
const NET = ethers.Network.from(BOT_CHAIN.chainId);
const readProvider = new ethers.JsonRpcProvider(BOT_CHAIN.rpcUrl, NET, { staticNetwork: NET });
const readContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, readProvider);

let provider, signer, contract, userAddress, userRole, operatorId = 0, currentBookingRoute = null;
let usdtAddress = ZERO, usdtDecimals = 6, operatorVerified = false;

function R() { return contract || readContract; }
function chainProvider() { return provider || readProvider; }

// ── Helpers ───────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  clearTimeout(showToast.h);
  showToast.h = setTimeout(() => t.classList.add('hidden'), 4500);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function errMsg(e) {
  if (e?.code === 'ACTION_REJECTED' || e?.code === 4001) return 'Transaction rejected';
  return e?.reason || e?.shortMessage || e?.info?.error?.message || e?.message || 'Something went wrong';
}
function shortAddr(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }
function formatBOT(w) { try { return parseFloat(ethers.formatEther(w)).toFixed(4); } catch { return '0'; } }
function formatUSDT(a) { try { return parseFloat(ethers.formatUnits(a, usdtDecimals)).toFixed(2); } catch { return '0'; } }
function fmtAmount(v, token) { return token === ZERO ? formatBOT(v) + ' BOT' : formatUSDT(v) + ' USDT'; }
function tsToLocal(ts) { return new Date(Number(ts) * 1000).toLocaleString(); }
function range(from, to) { const a = []; for (let i = from; i < to; i++) a.push(i); return a; }
function scrollToId(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }
function toggleFaq(btn) { btn.parentElement.classList.toggle('open'); }

function priceLabel(r) {
  const parts = [];
  if (r.fareBOT > 0n) parts.push(formatBOT(r.fareBOT) + ' BOT');
  if (r.fareUSDT > 0n) parts.push(formatUSDT(r.fareUSDT) + ' USDT');
  return parts.join(' / ');
}

// ── Normalise contract results (uint8/uint256 → Number) ───
function normOp(o) {
  return { id: Number(o.id), wallet: o.wallet, companyName: o.companyName, contactPhone: o.contactPhone, contactEmail: o.contactEmail, logoUri: o.logoUri, isVerified: o.isVerified, isActive: o.isActive, registeredAt: Number(o.registeredAt) };
}
function normVeh(v) {
  return { id: Number(v.id), operatorId: Number(v.operatorId), plateNumber: v.plateNumber, vehicleType: v.vehicleType, model: v.model, seatCapacity: Number(v.seatCapacity), isActive: v.isActive };
}
function normRoute(r) {
  return { id: Number(r.id), operatorId: Number(r.operatorId), vehicleId: Number(r.vehicleId), origin: r.origin, destination: r.destination, departure: Number(r.departureTimestamp), duration: Number(r.durationMinutes), fareBOT: r.fareBOT, fareUSDT: r.fareUSDT, totalSeats: Number(r.totalSeats), availableSeats: Number(r.availableSeats), isActive: r.isActive, info: r.additionalInfo };
}
function normBooking(b) {
  return { id: Number(b.id), routeId: Number(b.routeId), passenger: b.passenger, seats: Number(b.seatsBooked), amountPaid: b.amountPaid, paymentToken: b.paymentToken, status: Number(b.status), bookedAt: Number(b.bookedAt), name: b.passengerName, phone: b.passengerPhone };
}

// ── Navigation ────────────────────────────────────────────
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
async function ensureChain() {
  const cur = await window.ethereum.request({ method: 'eth_chainId' });
  if (parseInt(cur, 16) === BOT_CHAIN.chainId) return;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BOT_CHAIN.chainIdHex }] });
  } catch (e) {
    const code = e?.code ?? e?.data?.originalError?.code;
    if (code === 4902 || /unrecognized|not added|unknown chain/i.test(e?.message || '')) {
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
}

async function connectWallet() {
  if (!window.ethereum) {
    showToast('Install MetaMask or BO Wallet', 'error');
    return;
  }
  try {
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    await ensureChain();

    // create the provider after the chain switch
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== BOT_CHAIN.chainId) {
      showToast('Switch to BOT Chain Testnet (ID 968)', 'error');
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
    showToast(errMsg(err), 'error');
  }
}

async function identifyRole() {
  try {
    const opId = Number(await contract.walletToOperatorId(userAddress));
    operatorId = opId;
    const owner = await contract.owner();
    if (owner.toLowerCase() === userAddress.toLowerCase()) { userRole = 'admin'; return; }
    userRole = opId > 0 ? 'operator' : 'passenger';
  } catch {
    userRole = 'passenger';
  }
}

function openDashboard() {
  if (!userAddress) return connectWallet();
  if (userRole === 'admin') {
    document.getElementById('adminAddress').textContent = shortAddr(userAddress);
    showSection('admin');
    loadAdmin();
  } else if (userRole === 'operator') {
    openOperatorPortal();
  } else {
    openPassengerView();
  }
}

function openPassengerView() {
  document.getElementById('passengerAddress').textContent = shortAddr(userAddress);
  showSection('passenger');
  loadPassengerBookings();
}

function openOperatorPortal() {
  if (!userAddress) return connectWallet();
  document.getElementById('operatorAddress').textContent = shortAddr(userAddress);
  document.getElementById('backToPassengerBtn').classList.toggle('hidden', userRole === 'operator');
  showSection('operator');
  loadOperatorProfile();
}

async function becomeOperator() {
  if (!userAddress) await connectWallet();
  if (userAddress) openOperatorPortal();
}

function disconnectWallet() {
  userAddress = signer = contract = provider = userRole = null;
  operatorId = 0;
  document.getElementById('connectBtn').classList.remove('hidden');
  document.getElementById('dashboardBtn').classList.add('hidden');
  showSection('landing');
  showToast('Disconnected');
}

// ── Search (case-insensitive, done in the browser) ────────
async function loadAllRoutes() {
  const n = Number(await R().nextRouteId());
  return Promise.all(range(1, n).map(async id => normRoute(await R().routes(id))));
}

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
  try {
    const now = Date.now() / 1000;
    const match = (a, q) => a.toLowerCase().includes(q.toLowerCase());
    const found = (await loadAllRoutes())
      .filter(r => r.isActive && r.departure > now && r.availableSeats > 0 && match(r.origin, origin) && match(r.destination, dest))
      .sort((a, b) => a.departure - b.departure);

    if (!found.length) {
      el.innerHTML = `<p class="empty">No upcoming routes for ${esc(origin)} → ${esc(dest)}. Operators can publish new ones.</p>`;
      return;
    }
    const opIds = [...new Set(found.map(r => r.operatorId))];
    const vehIds = [...new Set(found.map(r => r.vehicleId))];
    const [ops, vehs] = await Promise.all([
      Promise.all(opIds.map(async id => [id, normOp(await R().operators(id))])).then(Object.fromEntries),
      Promise.all(vehIds.map(async id => [id, normVeh(await R().vehicles(id))])).then(Object.fromEntries)
    ]);
    el.innerHTML = found.map(r => routeCard(r, ops[r.operatorId], vehs[r.vehicleId])).join('');
  } catch (e) {
    console.error(e);
    el.innerHTML = `<p class="empty">Could not load routes: ${esc(errMsg(e))}</p>`;
  }
}

function routeCard(r, op, v) {
  return `
    <div class="result-card">
      <div>
        <div class="title">${esc(r.origin)} → ${esc(r.destination)}</div>
        <div class="meta">${tsToLocal(r.departure)} · ~${r.duration} min<br/>
          ${esc(op?.companyName || 'Operator #' + r.operatorId)}${op?.isVerified ? ' ✓' : ''} · ${esc(v?.vehicleType || '')} ${esc(v?.model || '')} (${esc(v?.plateNumber || '')})<br/>${esc(r.info || '')}</div>
      </div>
      <div>
        <div class="price">${priceLabel(r)}</div>
        <div class="seats">${r.availableSeats}/${r.totalSeats} seats</div>
        <button class="btn btn-primary btn-sm" style="margin-top:.4rem" onclick="openBookingModal(${r.id})">Book</button>
      </div>
    </div>`;
}

// ── Booking ───────────────────────────────────────────────
async function openBookingModal(routeId) {
  if (!userAddress) { showToast('Connect wallet to book', 'error'); return connectWallet(); }
  try {
    const r = normRoute(await R().routes(routeId));
    currentBookingRoute = r;
    document.getElementById('bookingSummary').innerHTML =
      `<strong>${esc(r.origin)} → ${esc(r.destination)}</strong><br/>${tsToLocal(r.departure)} · ${r.availableSeats} seats left`;
    const seats = document.getElementById('bookSeats');
    seats.max = r.availableSeats;
    seats.value = 1;
    document.getElementById('bookPayment').innerHTML =
      (r.fareBOT > 0n ? '<option value="BOT">BOT</option>' : '') +
      (r.fareUSDT > 0n ? '<option value="USDT">USDT</option>' : '');
    document.getElementById('bookingStatus').textContent = '';
    document.getElementById('bookingModal').classList.remove('hidden');
    updateTotal();
  } catch (e) { showToast('Could not load route: ' + errMsg(e), 'error'); }
}

function updateTotal() {
  if (!currentBookingRoute) return;
  const seats = Math.max(1, Number(document.getElementById('bookSeats').value) || 1);
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
  const r = currentBookingRoute;

  if (!name || !phone) return showToast('Enter name and phone', 'error');
  if (!r) return;
  if (!Number.isInteger(seats) || seats < 1 || seats > r.availableSeats) return showToast(`Choose 1–${r.availableSeats} seats`, 'error');

  const btn = document.getElementById('confirmBookBtn');
  btn.disabled = true;

  try {
    let tx;
    if (method === 'BOT') {
      const total = r.fareBOT * BigInt(seats);
      if ((await provider.getBalance(userAddress)) < total) throw new Error('Insufficient BOT balance');
      status.textContent = 'Confirm in your wallet…';
      tx = await contract.bookWithBOT(r.id, seats, name, phone, { value: total });
    } else {
      const usdt = new ethers.Contract(usdtAddress, ERC20_ABI, signer);
      const total = r.fareUSDT * BigInt(seats);
      if ((await usdt.balanceOf(userAddress)) < total) throw new Error('Insufficient USDT balance');
      const allowance = await usdt.allowance(userAddress, CONTRACT_ADDRESS);
      if (allowance < total) {
        // USDT-style tokens need a non-zero allowance reset to 0 first
        if (allowance > 0n) {
          status.textContent = 'Resetting USDT allowance…';
          await (await usdt.approve(CONTRACT_ADDRESS, 0n)).wait();
        }
        status.textContent = 'Approving USDT…';
        await (await usdt.approve(CONTRACT_ADDRESS, total)).wait();
      }
      status.textContent = 'Confirm payment in your wallet…';
      tx = await contract.bookWithUSDT(r.id, seats, name, phone);
    }
    status.textContent = 'Waiting for confirmation…';
    const receipt = await tx.wait();
    status.innerHTML = `<span style="color:var(--green)">Booked! <a href="${BOT_CHAIN.explorer}/tx/${receipt.hash}" target="_blank" rel="noopener" style="color:var(--accent-2)">${receipt.hash.slice(0, 10)}…</a></span>`;
    showToast('Booking confirmed');
    loadPassengerBookings();
    setTimeout(closeModal, 3000);
  } catch (err) {
    status.innerHTML = `<span style="color:#ef4444">${esc(errMsg(err))}</span>`;
  } finally {
    btn.disabled = false;
  }
}

// ── Passenger bookings ────────────────────────────────────
async function loadPassengerBookings() {
  const active = document.getElementById('activeBookings');
  const history = document.getElementById('travelHistory');
  if (!contract) return;
  active.innerHTML = '<p class="empty">Loading…</p>';
  try {
    // the contract pushes BOT bookings into this list twice, so de-duplicate
    const ids = [...new Set((await contract.getPassengerBookings(userAddress)).map(Number))].sort((a, b) => b - a);
    if (!ids.length) {
      active.innerHTML = '<p class="empty">No bookings yet.</p>';
      history.innerHTML = '<p class="empty">No history yet.</p>';
      return;
    }
    const items = await Promise.all(ids.map(async id => {
      const b = normBooking(await contract.bookings(id));
      const r = normRoute(await contract.routes(b.routeId));
      return { b, r };
    }));
    const now = Date.now() / 1000;
    let aHtml = '', hHtml = '';
    for (const { b, r } of items) {
      const upcoming = b.status === 1 && r.departure > now;
      const canCancel = b.status === 1 && r.departure > now + 7200;
      const canReview = b.status === 1 && r.departure < now;
      const card = `
        <div class="result-card">
          <div>
            <div class="title">${esc(r.origin)} → ${esc(r.destination)}</div>
            <div class="meta">#${b.id} · ${b.seats} seat(s) · ${fmtAmount(b.amountPaid, b.paymentToken)}<br/>
              Departs ${tsToLocal(r.departure)}<br/>Status: ${BOOKING_STATUS[b.status] || b.status}</div>
          </div>
          <div>
            ${canCancel ? `<button class="btn btn-ghost btn-sm" onclick="cancelBooking(${b.id})">Cancel & Refund</button>` : ''}
            ${canReview ? `<button class="btn btn-ghost btn-sm" onclick="submitReview(${b.id})">Leave review</button>` : ''}
            ${b.status === 1 ? `<button class="btn btn-primary btn-sm" style="margin-top:.3rem" onclick="showQR(${b.id})">QR</button>` : ''}
          </div>
        </div>`;
      if (upcoming) aHtml += card; else hHtml += card;
    }
    active.innerHTML = aHtml || '<p class="empty">No upcoming trips.</p>';
    history.innerHTML = hHtml || '<p class="empty">No past trips.</p>';
  } catch (e) {
    console.error(e);
    active.innerHTML = `<p class="empty">Could not load bookings: ${esc(errMsg(e))}</p>`;
  }
}

async function cancelBooking(id) {
  try {
    const b = normBooking(await contract.bookings(id));
    const refund = b.amountPaid * 90n / 100n;
    // The operator is paid at booking time, so refunds come from whatever the contract still holds
    const held = b.paymentToken === ZERO
      ? await chainProvider().getBalance(CONTRACT_ADDRESS)
      : await new ethers.Contract(b.paymentToken, ERC20_ABI, chainProvider()).balanceOf(CONTRACT_ADDRESS);
    if (held < refund) {
      return showToast(`Refund unavailable right now: the contract holds ${fmtAmount(held, b.paymentToken)} but the refund is ${fmtAmount(refund, b.paymentToken)}. Contact the platform admin.`, 'error');
    }
    if (!confirm(`Cancel booking #${id} and receive ${fmtAmount(refund, b.paymentToken)} (90%)?`)) return;
    const tx = await contract.cancelBooking(id);
    showToast('Cancellation submitted…');
    await tx.wait();
    showToast('Cancelled & refunded');
    loadPassengerBookings();
  } catch (e) { showToast(errMsg(e), 'error'); }
}

async function submitReview(bookingId) {
  const rating = Number(prompt('Rate this trip from 1 to 5'));
  if (!(Number.isInteger(rating) && rating >= 1 && rating <= 5)) return showToast('Rating must be a whole number from 1 to 5', 'error');
  const comment = (prompt('Optional comment (stored publicly on-chain)') || '').trim();
  try {
    const tx = await contract.submitReview(bookingId, rating, comment);
    showToast('Submitting review…');
    await tx.wait();
    showToast('Review saved on-chain');
  } catch (e) { showToast(errMsg(e), 'error'); }
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
  try {
    const tx = await contract.registerOperator(name, phone, email, logo);
    showToast('Registering…');
    await tx.wait();
    showToast('Operator registered — an admin must verify you before you can publish routes');
    await identifyRole();
    openOperatorPortal();
  } catch (e) { showToast(errMsg(e), 'error'); }
}

async function loadOperatorProfile() {
  const form = document.getElementById('registerOperatorForm');
  const view = document.getElementById('operatorProfileView');
  const badge = document.getElementById('operatorStatus');
  if (!operatorId) {
    form.classList.remove('hidden');
    view.classList.add('hidden');
    badge.textContent = 'Not registered';
    document.getElementById('vehicleList').innerHTML = '<p class="empty">Register your company first.</p>';
    document.getElementById('routeList').innerHTML = '';
    document.getElementById('routeVerifyNote').textContent = 'Register your company first.';
    return;
  }
  try {
    const op = normOp(await R().operators(operatorId));
    operatorVerified = op.isVerified;
    form.classList.add('hidden');
    view.classList.remove('hidden');
    document.getElementById('opProfileDetails').innerHTML = `
      <p><strong>${esc(op.companyName)}</strong> · Operator #${op.id}</p>
      <p>${esc(op.contactPhone)} · ${esc(op.contactEmail)}</p>
      <p>Verified: ${op.isVerified ? 'Yes' : 'Pending — share your Operator ID (#' + op.id + ') with the platform admin'}</p>
      <p>Since: ${tsToLocal(op.registeredAt)}</p>`;
    badge.textContent = op.isVerified ? 'Verified' : 'Unverified';
    document.getElementById('routeVerifyNote').textContent = op.isVerified
      ? ''
      : 'Your operator account must be verified by an admin before you can publish routes.';
    await Promise.all([loadVehicles(), loadOperatorRoutes()]);
  } catch (e) { console.error(e); showToast(errMsg(e), 'error'); }
}

async function loadVehicles() {
  const list = document.getElementById('vehicleList');
  const select = document.getElementById('routeVehicleId');
  try {
    const n = Number(await R().nextVehicleId());
    const mine = (await Promise.all(range(1, n).map(async id => normVeh(await R().vehicles(id)))))
      .filter(v => v.operatorId === operatorId);
    list.innerHTML = mine.length ? mine.map(v => `
      <div class="result-card">
        <div>
          <div class="title">${esc(v.vehicleType)} · ${esc(v.plateNumber)}</div>
          <div class="meta">#${v.id} · ${esc(v.model)} · ${v.seatCapacity} seats${v.isActive ? '' : ' · inactive'}</div>
        </div>
      </div>`).join('') : '<p class="empty">No vehicles yet.</p>';
    const active = mine.filter(v => v.isActive);
    select.innerHTML = active.length
      ? active.map(v => `<option value="${v.id}">#${v.id} · ${esc(v.vehicleType)} ${esc(v.plateNumber)} (${v.seatCapacity} seats)</option>`).join('')
      : '<option value="">Add a vehicle first</option>';
  } catch (e) { console.error(e); }
}

async function registerVehicle() {
  if (!operatorId) return showToast('Register as operator first', 'error');
  const plate = document.getElementById('vehPlate').value.trim();
  const type = document.getElementById('vehType').value;
  const model = document.getElementById('vehModel').value.trim();
  const seats = Number(document.getElementById('vehSeats').value);
  if (!plate) return showToast('Plate number required', 'error');
  if (!Number.isInteger(seats) || seats < 1 || seats > 100) return showToast('Seats must be 1–100', 'error');
  try {
    const tx = await contract.registerVehicle(operatorId, plate, type, model, seats);
    showToast('Adding vehicle…');
    await tx.wait();
    showToast('Vehicle added');
    document.getElementById('vehPlate').value = '';
    document.getElementById('vehModel').value = '';
    loadVehicles();
  } catch (e) { showToast(errMsg(e), 'error'); }
}

async function createRoute() {
  if (!operatorId) return showToast('Register as operator first', 'error');
  if (!operatorVerified) return showToast('Your operator account must be verified by an admin first', 'error');
  const vehicleId = Number(document.getElementById('routeVehicleId').value);
  const origin = document.getElementById('routeOrigin').value.trim();
  const dest = document.getElementById('routeDestination').value.trim();
  const depLocal = document.getElementById('routeDeparture').value;
  const duration = Number(document.getElementById('routeDuration').value);
  const fareBOT = document.getElementById('routeFareBOT').value.trim();
  const fareUSDT = document.getElementById('routeFareUSDT').value.trim();
  const info = document.getElementById('routeInfo').value.trim();

  if (!vehicleId) return showToast('Select a vehicle', 'error');
  if (!origin || !dest || !depLocal) return showToast('Fill origin, destination and departure', 'error');

  const depTs = Math.floor(new Date(depLocal).getTime() / 1000);
  if (depTs <= Date.now() / 1000) return showToast('Departure must be in the future', 'error');
  if (!Number.isInteger(duration) || duration < 1) return showToast('Enter a valid duration', 'error');

  let botWei, usdtUnits;
  try {
    botWei = fareBOT ? ethers.parseEther(fareBOT) : 0n;
    usdtUnits = fareUSDT ? ethers.parseUnits(fareUSDT, usdtDecimals) : 0n;
  } catch { return showToast('Enter valid fares', 'error'); }
  if (botWei === 0n && usdtUnits === 0n) return showToast('Set at least one fare', 'error');

  const params = {
    vehicleId, origin, destination: dest, departureTimestamp: depTs,
    durationMinutes: duration, fareBOT: botWei, fareUSDT: usdtUnits, additionalInfo: info
  };
  try {
    const tx = await contract.createRoute(operatorId, params);
    showToast('Publishing route…');
    await tx.wait();
    showToast('Route published');
    loadOperatorRoutes();
  } catch (e) { showToast(errMsg(e), 'error'); }
}

async function loadOperatorRoutes() {
  const el = document.getElementById('routeList');
  const bookingsEl = document.getElementById('operatorBookings');
  if (!operatorId) return;
  try {
    const ids = [...new Set((await R().getOperatorRoutes(operatorId)).map(Number))].sort((a, b) => b - a);
    if (!ids.length) {
      el.innerHTML = '<p class="empty">No routes yet.</p>';
      bookingsEl.innerHTML = '<p class="empty">Bookings for your routes will appear here.</p>';
      return;
    }
    const routes = await Promise.all(ids.map(async id => normRoute(await R().routes(id))));
    const now = Date.now() / 1000;
    el.innerHTML = routes.map(r => `
      <div class="result-card">
        <div>
          <div class="title">${esc(r.origin)} → ${esc(r.destination)}</div>
          <div class="meta">#${r.id} · ${tsToLocal(r.departure)} · ${r.availableSeats}/${r.totalSeats} seats left<br/>
            ${priceLabel(r)}${r.isActive ? (r.departure < now ? ' · departed' : '') : ' · deactivated'}</div>
        </div>
        <div>${r.isActive && r.departure > now ? `<button class="btn btn-ghost btn-sm" onclick="deactivateRoute(${r.id})">Deactivate</button>` : ''}</div>
      </div>`).join('');

    // Bookings across all routes
    const rows = [];
    for (const r of routes) {
      const bIds = [...new Set((await R().getRouteBookings(r.id)).map(Number))];
      const bs = await Promise.all(bIds.map(async id => normBooking(await R().bookings(id))));
      bs.forEach(b => rows.push({ b, r }));
    }
    rows.sort((x, y) => y.b.bookedAt - x.b.bookedAt);
    bookingsEl.innerHTML = rows.length ? rows.map(({ b, r }) => `
      <div class="result-card">
        <div>
          <div class="title">#${b.id} · ${esc(b.name)}</div>
          <div class="meta">${esc(r.origin)} → ${esc(r.destination)} · ${tsToLocal(r.departure)}<br/>
            ${b.seats} seat(s) · ${fmtAmount(b.amountPaid, b.paymentToken)} · ${esc(b.phone)}<br/>
            ${shortAddr(b.passenger)} · ${BOOKING_STATUS[b.status] || b.status}</div>
        </div>
      </div>`).join('') : '<p class="empty">No bookings yet.</p>';
  } catch (e) { console.error(e); }
}

async function deactivateRoute(id) {
  if (!confirm(`Deactivate route #${id}? Passengers will no longer be able to book it.`)) return;
  try {
    const tx = await contract.deactivateRoute(id);
    showToast('Deactivating…');
    await tx.wait();
    showToast('Route deactivated');
    loadOperatorRoutes();
  } catch (e) { showToast(errMsg(e), 'error'); }
}

// ── Admin ─────────────────────────────────────────────────
async function loadAdmin() {
  const info = document.getElementById('adminInfo');
  const opsEl = document.getElementById('adminOperators');
  try {
    const usdt = new ethers.Contract(usdtAddress, ERC20_ABI, chainProvider());
    const [fee, botBal, usdtBal, n] = await Promise.all([
      R().platformFeeBps(),
      chainProvider().getBalance(CONTRACT_ADDRESS),
      usdt.balanceOf(CONTRACT_ADDRESS).catch(() => 0n),
      R().nextOperatorId()
    ]);
    info.innerHTML = `
      <p>Contract: <a href="${BOT_CHAIN.explorer}/address/${CONTRACT_ADDRESS}" target="_blank" rel="noopener">${shortAddr(CONTRACT_ADDRESS)}</a></p>
      <p>Platform fee: ${(Number(fee) / 100).toFixed(2)}%</p>
      <p>USDT token: ${shortAddr(usdtAddress)} (${usdtDecimals} decimals)</p>
      <p>Contract balance: ${formatBOT(botBal)} BOT · ${formatUSDT(usdtBal)} USDT</p>`;

    const ops = await Promise.all(range(1, Number(n)).map(async id => normOp(await R().operators(id))));
    opsEl.innerHTML = ops.length ? ops.map(op => `
      <div class="result-card">
        <div>
          <div class="title">#${op.id} · ${esc(op.companyName)}</div>
          <div class="meta">${shortAddr(op.wallet)} · ${esc(op.contactPhone)} · ${esc(op.contactEmail)}<br/>
            Registered ${tsToLocal(op.registeredAt)} · ${op.isVerified ? 'Verified' : 'Unverified'}</div>
        </div>
        <div>
          <button class="btn ${op.isVerified ? 'btn-ghost' : 'btn-primary'} btn-sm" onclick="setOperatorVerified(${op.id}, ${!op.isVerified})">${op.isVerified ? 'Revoke' : 'Verify'}</button>
        </div>
      </div>`).join('') : '<p class="empty">No operators registered yet.</p>';
  } catch (e) {
    console.error(e);
    info.innerHTML = `<p class="empty">Could not load: ${esc(errMsg(e))}</p>`;
  }
}

async function setOperatorVerified(id, verified) {
  try {
    const tx = await contract.verifyOperator(id, verified);
    showToast('Updating…');
    await tx.wait();
    showToast(verified ? 'Operator verified' : 'Verification revoked');
    loadAdmin();
  } catch (e) { showToast(errMsg(e), 'error'); }
}

async function withdrawFees() {
  const which = document.getElementById('feeToken').value;
  const amountStr = document.getElementById('feeAmount').value.trim();
  let token, amount;
  try {
    token = which === 'BOT' ? ZERO : usdtAddress;
    amount = which === 'BOT' ? ethers.parseEther(amountStr) : ethers.parseUnits(amountStr, usdtDecimals);
  } catch { return showToast('Enter a valid amount', 'error'); }
  if (amount <= 0n) return showToast('Amount must be greater than 0', 'error');
  try {
    const tx = await contract.withdrawFees(token, amount);
    showToast('Withdrawing…');
    await tx.wait();
    showToast('Fees withdrawn');
    document.getElementById('feeAmount').value = '';
    loadAdmin();
  } catch (e) { showToast(errMsg(e), 'error'); }
}

function downloadWhitepaper() {
  window.open('../docs/Move_Whitepaper.pdf', '_blank');
}

// ── Init ──────────────────────────────────────────────────
document.getElementById('menuToggle')?.addEventListener('click', () => {
  document.getElementById('navLinks').classList.toggle('open');
});

if (window.ethereum?.on) {
  window.ethereum.on('accountsChanged', () => window.location.reload());
  window.ethereum.on('chainChanged', () => window.location.reload());
}

(async function init() {
  const link = document.getElementById('contractLink');
  if (link) { link.href = `${BOT_CHAIN.explorer}/address/${CONTRACT_ADDRESS}`; link.textContent = shortAddr(CONTRACT_ADDRESS); }

  // USDT address and decimals come from the contract itself
  try {
    usdtAddress = await readContract.usdtToken();
    usdtDecimals = Number(await new ethers.Contract(usdtAddress, ERC20_ABI, readProvider).decimals());
  } catch (e) { console.warn('Could not read USDT info', e); }

  // silently reconnect if already authorised and on the right chain
  if (window.ethereum) {
    try {
      const acc = await window.ethereum.request({ method: 'eth_accounts' });
      const ch = await window.ethereum.request({ method: 'eth_chainId' });
      if (acc.length && parseInt(ch, 16) === BOT_CHAIN.chainId) connectWallet();
    } catch {}
  }
  console.log('Move ready · BOT Chain Testnet');
})();