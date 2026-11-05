const $ = (selector) => document.querySelector(selector);
let token = sessionStorage.getItem("wallet_demo_token") || "";
let currentUser = null;

function money(value) {
  return new Intl.NumberFormat("en-NP", { style: "currency", currency: "NPR", minimumFractionDigits: 2 }).format(value);
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function showMessage(element, message, success = false) {
  element.textContent = message;
  element.className = success ? "message success" : "message";
}
function setTab(tab) {
  document.querySelectorAll(".tab").forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
  $("#loginForm").classList.toggle("hidden", tab !== "login");
  $("#registerForm").classList.toggle("hidden", tab !== "register");
  showMessage($("#authMessage"), "");
}
document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => setTab(button.dataset.tab)));

function setSession(data) {
  token = data.token;
  currentUser = data.user;
  sessionStorage.setItem("wallet_demo_token", token);
  renderDashboard();
}
function renderDashboard() {
  $("#authView").classList.add("hidden");
  $("#dashboardView").classList.remove("hidden");
  $("#logoutBtn").classList.remove("hidden");
  $("#userName").textContent = currentUser.name.split(" ")[0];
  $("#balance").textContent = money(currentUser.balance);
  loadTransactions();
}
async function loadTransactions() {
  try {
    const data = await api("/api/transactions");
    const target = $("#transactions");
    if (!data.transactions.length) {
      target.innerHTML = '<p class="muted">No transactions yet. Try a demo transfer.</p>';
      return;
    }
    target.innerHTML = data.transactions.map(tx => {
      const incoming = tx.type === "transfer_in" || tx.type === "demo_credit";
      const title = tx.type === "demo_credit" ? "Welcome demo credits" : incoming ? `From ${escapeHtml(tx.sender || "user")}` : `To ${escapeHtml(tx.recipient || "user")}`;
      const date = new Date(tx.date.replace(" ", "T") + "Z").toLocaleString();
      return `<div class="transaction"><div class="tx-left"><span class="tx-icon">${incoming ? "↓" : "↑"}</span><div><div class="tx-title">${title}</div><div class="tx-date">${escapeHtml(date)} · ${escapeHtml(tx.note || "Transfer")}</div></div></div><div class="tx-amount ${incoming ? "positive" : "negative"}">${incoming ? "+" : "−"}${money(tx.amount)}</div></div>`;
    }).join("");
  } catch (error) { $("#transactions").textContent = error.message; }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
}
$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try { setSession(await api("/api/auth/login", { method:"POST", body:JSON.stringify(Object.fromEntries(form)) })); }
  catch (error) { showMessage($("#authMessage"), error.message); }
});
$("#registerForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try { setSession(await api("/api/auth/register", { method:"POST", body:JSON.stringify(Object.fromEntries(form)) })); }
  catch (error) { showMessage($("#authMessage"), error.message); }
});
$("#transferForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form);
  payload.amount = Number(payload.amount);
  if (!confirm(`Send NPR ${payload.amount.toFixed(2)} in DEMO credits to ${payload.recipientEmail}? No real money will move.`)) return;
  try {
    const data = await api("/api/transfers", { method:"POST", body:JSON.stringify(payload) });
    currentUser = data.user;
    $("#balance").textContent = money(currentUser.balance);
    event.currentTarget.reset();
    showMessage($("#transferMessage"), data.message, true);
    loadTransactions();
  } catch (error) { showMessage($("#transferMessage"), error.message); }
});
$("#logoutBtn").addEventListener("click", () => {
  token = ""; currentUser = null; sessionStorage.removeItem("wallet_demo_token");
  $("#dashboardView").classList.add("hidden"); $("#authView").classList.remove("hidden"); $("#logoutBtn").classList.add("hidden");
  setTab("login");
});
$("#sendAction").addEventListener("click", () => $("#transferPanel").scrollIntoView({ behavior:"smooth", block:"center" }));
["qrAction","topupAction","billsAction"].forEach(id => $("#" + id).addEventListener("click", () => alert("This feature is a UI preview only. No payment provider is connected.")));

if (token) {
  api("/api/me").then(data => { currentUser = data.user; renderDashboard(); }).catch(() => {
    token = ""; sessionStorage.removeItem("wallet_demo_token");
  });
}
