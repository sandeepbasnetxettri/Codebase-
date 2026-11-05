require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("Set JWT_SECRET in .env to a random value at least 32 characters long.");
  process.exit(1);
}

const dbFile = process.env.DATABASE_FILE || "./data/wallet.sqlite";
fs.mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true });
const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    balance_cents INTEGER NOT NULL DEFAULT 100000,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    recipient_id INTEGER,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    note TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL CHECK(type IN ('transfer_in','transfer_out','demo_credit')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sender_id) REFERENCES users(id),
    FOREIGN KEY(recipient_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_transactions_sender ON transactions(sender_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_recipient ON transactions(recipient_id, id DESC);
`);

app.use(helmet());
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false }));

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT id, name, email, balance_cents FROM users WHERE id = ?").get(payload.sub);
    if (!user) return res.status(401).json({ error: "Account not found." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Please sign in again." });
  }
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, balance: user.balance_cents / 100 };
}
function issueToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: "2h" });
}

app.post("/api/auth/register", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2 || name.length > 70) return res.status(400).json({ error: "Name must be 2–70 characters." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 10 || password.length > 72) return res.status(400).json({ error: "Password must be 10–72 characters." });
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) return res.status(409).json({ error: "An account with this email already exists." });

  const passwordHash = bcrypt.hashSync(password, 12);
  const result = db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)").run(name, email, passwordHash);
  const user = db.prepare("SELECT id, name, email, balance_cents FROM users WHERE id = ?").get(result.lastInsertRowid);
  db.prepare("INSERT INTO transactions (recipient_id, amount_cents, note, type) VALUES (?, ?, ?, 'demo_credit')").run(user.id, 100000, "Welcome demo credits");
  res.status(201).json({ token: issueToken(user), user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: "Email or password is incorrect." });
  res.json({ token: issueToken(user), user: publicUser(user) });
});

app.get("/api/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get("/api/transactions", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT t.id, t.amount_cents, t.note, t.type, t.created_at,
      s.name AS sender_name, r.name AS recipient_name
    FROM transactions t
    LEFT JOIN users s ON s.id = t.sender_id
    LEFT JOIN users r ON r.id = t.recipient_id
    WHERE t.sender_id = ? OR t.recipient_id = ?
    ORDER BY t.id DESC LIMIT 50
  `).all(req.user.id, req.user.id);
  res.json({ transactions: rows.map(t => ({
    id: t.id, amount: t.amount_cents / 100, note: t.note, type: t.type,
    date: t.created_at, sender: t.sender_name, recipient: t.recipient_name
  })) });
});

const transfer = db.transaction((senderId, recipientId, amountCents, note) => {
  const sender = db.prepare("SELECT id, balance_cents FROM users WHERE id = ?").get(senderId);
  const recipient = db.prepare("SELECT id FROM users WHERE id = ?").get(recipientId);
  if (!sender || !recipient) throw new Error("ACCOUNT_NOT_FOUND");
  if (sender.balance_cents < amountCents) throw new Error("INSUFFICIENT_FUNDS");
  db.prepare("UPDATE users SET balance_cents = balance_cents - ? WHERE id = ?").run(amountCents, senderId);
  db.prepare("UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?").run(amountCents, recipientId);
  db.prepare("INSERT INTO transactions (sender_id, recipient_id, amount_cents, note, type) VALUES (?, ?, ?, ?, 'transfer_out')").run(senderId, recipientId, amountCents, note);
  db.prepare("INSERT INTO transactions (sender_id, recipient_id, amount_cents, note, type) VALUES (?, ?, ?, ?, 'transfer_in')").run(senderId, recipientId, amountCents, note);
});

app.post("/api/transfers", auth, (req, res) => {
  const recipientEmail = String(req.body.recipientEmail || "").trim().toLowerCase();
  const note = String(req.body.note || "").trim().slice(0, 120);
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return res.status(400).json({ error: "Enter an amount between NPR 0.01 and NPR 100,000." });
  const amountCents = Math.round(amount * 100);
  if (Math.abs(amountCents / 100 - amount) > 0.000001) return res.status(400).json({ error: "Amount can have at most two decimal places." });
  const recipient = db.prepare("SELECT id FROM users WHERE email = ?").get(recipientEmail);
  if (!recipient) return res.status(404).json({ error: "Recipient account was not found." });
  if (recipient.id === req.user.id) return res.status(400).json({ error: "You cannot transfer to yourself." });
  try {
    transfer(req.user.id, recipient.id, amountCents, note);
    const updated = db.prepare("SELECT id, name, email, balance_cents FROM users WHERE id = ?").get(req.user.id);
    res.json({ message: "Demo transfer completed.", user: publicUser(updated) });
  } catch (error) {
    if (error.message === "INSUFFICIENT_FUNDS") return res.status(400).json({ error: "Insufficient demo balance." });
    return res.status(500).json({ error: "Transfer could not be completed." });
  }
});

app.get("/api/health", (_req, res) => res.json({ status: "ok", mode: "demo-only" }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Nepal Wallet Demo running at http://localhost:${PORT}`));
