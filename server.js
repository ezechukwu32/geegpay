require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const db = new Database(process.env.DB_PATH || "bank.db");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL, balance_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tx(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL,
  note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

const app = express();
app.use(express.json({ limit: "10kb" }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

const usd = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const sign = (u) => jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: "2h" });

async function sendEmail(to, subject, text) {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
    });
    if (!r.ok) console.error("Email failed:", r.status, await r.text());
  } catch (e) { console.error("Email error:", e.message); }
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  try { req.uid = jwt.verify(h.replace("Bearer ", ""), process.env.JWT_SECRET).id; next(); }
  catch { res.status(401).json({ error: "Please sign in again." }); }
}

app.post("/api/register", authLimit, async (req, res) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== "string" || name.trim().length < 2) return res.status(400).json({ error: "Enter your full name." });
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (typeof password !== "string" || password.length < 8) return res.status(400).json({ error: "Password must be 8+ characters." });
  const hash = await bcrypt.hash(password, 12);
  try {
    const info = db.prepare("INSERT INTO users(name,email,pass_hash) VALUES(?,?,?)").run(name.trim(), email.trim().toLowerCase(), hash);
    sendEmail(email, "Welcome to Kestrel Bank", `Hi ${name.trim().split(" ")[0]}, your account is open. Balance: ${usd(0)}`);
    res.json({ token: sign({ id: info.lastInsertRowid }) });
  } catch { res.status(409).json({ error: "That email is already registered." }); }
});

app.post("/api/login", authLimit, async (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(String(email || "").toLowerCase());
  if (!u || !(await bcrypt.compare(String(password || ""), u.pass_hash))) return res.status(401).json({ error: "Email or password is incorrect." });
  res.json({ token: sign(u) });
});

app.get("/api/me", auth, (req, res) => {
  const u = db.prepare("SELECT name,email,balance_cents FROM users WHERE id=?").get(req.uid);
  const tx = db.prepare("SELECT amount_cents,note,created_at FROM tx WHERE user_id=? ORDER BY id DESC LIMIT 20").all(req.uid);
  res.json({ name: u.name, email: u.email, balance: u.balance_cents / 100, tx });
});

// DEMO ONLY: lets a user credit themselves. In a real bank, credits come from
// a payment provider webhook (e.g. Stripe), never from the user's own request.
app.post("/api/credit", auth, (req, res) => {
  const amount = Math.round(Number(req.body?.amount) * 100);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100000000) return res.status(400).json({ error: "Enter a valid amount." });
  const note = String(req.body?.note || "").slice(0, 40);
  const run = db.transaction(() => {
    db.prepare("UPDATE users SET balance_cents = balance_cents + ? WHERE id=?").run(amount, req.uid);
    db.prepare("INSERT INTO tx(user_id,amount_cents,note) VALUES(?,?,?)").run(req.uid, amount, note);
    return db.prepare("SELECT name,email,balance_cents FROM users WHERE id=?").get(req.uid);
  });
  const u = run();
  sendEmail(u.email, `Credit alert: ${usd(amount)} received`,
    `Hi ${u.name.split(" ")[0]},\nYour account was credited with ${usd(amount)}.\nNew balance: ${usd(u.balance_cents)}`);
  res.json({ balance: u.balance_cents / 100 });
});

app.listen(process.env.PORT || 3000, () => console.log("Kestrel backend running"));
