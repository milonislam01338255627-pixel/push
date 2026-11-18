require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const webpush = require("web-push");
const { Pool } = require("pg");

const dbUrl = process.env.DATABASE_URL || "";
const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl && !dbUrl.includes("localhost") ? { rejectUnauthorized: false } : false,
});
const SUBJECT = "mailto:" + (process.env.SUPPORT_EMAIL || "admin@example.com");

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));
["sdk.js", "sw-core.js"].forEach((f) =>
  app.get("/" + f, (req, res) => res.sendFile(path.join(__dirname, f)))
);
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const rid = (n) => crypto.randomBytes(n).toString("hex");
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: "সার্ভারে সমস্যা হয়েছে" });
  });

// ---------- ড্যাশবোর্ড লগইন ----------
const auth = wrap(async (req, res, next) => {
  const t = (req.headers.authorization || "").replace("Bearer ", "");
  if (!t) return res.status(401).json({ error: "লগইন করুন" });
  const r = await pool.query("select * from customers where session_token=$1", [t]);
  if (!r.rows[0]) return res.status(401).json({ error: "লগইন করুন" });
  req.customer = r.rows[0];
  next();
});

app.post("/api/signup", wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !password || password.length < 6)
    return res.status(400).json({ error: "সঠিক ইমেইল ও কমপক্ষে ৬ অক্ষরের পাসওয়ার্ড দিন" });
  const exists = await pool.query("select 1 from customers where email=$1", [email.toLowerCase()]);
  if (exists.rows[0]) return res.status(409).json({ error: "এই ইমেইল আগে থেকেই আছে" });
  const token = rid(24);
  await pool.query(
    "insert into customers(email,password_hash,session_token) values($1,$2,$3)",
    [email.toLowerCase(), await bcrypt.hash(password, 10), token]
  );
  res.json({ token });
}));

app.post("/api/login", wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const r = await pool.query("select * from customers where email=$1", [(email || "").toLowerCase()]);
  const c = r.rows[0];
  if (!c || !(await bcrypt.compare(password || "", c.password_hash)))
    return res.status(401).json({ error: "ইমেইল বা পাসওয়ার্ড ভুল" });
  const token = rid(24);
  await pool.query("update customers set session_token=$1 where id=$2", [token, c.id]);
  res.json({ token });
}));

app.get("/api/me", auth, wrap(async (req, res) => {
  const c = req.customer;
  res.json({ email: c.email, plan: c.plan, limit: c.monthly_limit, sent: c.sent_count });
}));

app.get("/api/apps", auth, wrap(async (req, res) => {
  const r = await pool.query(
    `select a.id, a.name, a.api_key,
      (select count(*) from devices d where d.app_id=a.id)::int as devices
     from apps a where a.customer_id=$1 order by a.created_at desc`,
    [req.customer.id]
  );
  res.json(r.rows);
}));

app.post("/api/apps", auth, wrap(async (req, res) => {
  const name = ((req.body || {}).name || "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "অ্যাপের নাম দিন" });
  const keys = webpush.generateVAPIDKeys();
  const id = rid(8);
  const apiKey = "sk_" + rid(24);
  await pool.query(
    "insert into apps(id,customer_id,name,api_key,vapid_public,vapid_private) values($1,$2,$3,$4,$5,$6)",
    [id, req.customer.id, name, apiKey, keys.publicKey, keys.privateKey]
  );
  res.json({ id, name, api_key: apiKey });
}));

// ---------- পাবলিক API (SDK ব্যবহার করে) ----------
app.get("/v1/config/:appId", wrap(async (req, res) => {
  const r = await pool.query("select vapid_public from apps where id=$1", [req.params.appId]);
  if (!r.rows[0]) return res.status(404).json({ error: "অ্যাপ পাওয়া যায়নি" });
  res.json({ publicKey: r.rows[0].vapid_public });
}));

app.post("/v1/subscribe", wrap(async (req, res) => {
  const { app_id, subscription } = req.body || {};
  const k = subscription && subscription.keys;
  if (!app_id || !subscription || !subscription.endpoint || !k || !k.p256dh || !k.auth)
    return res.status(400).json({ error: "ভুল ডাটা" });
  const a = await pool.query("select 1 from apps where id=$1", [app_id]);
  if (!a.rows[0]) return res.status(404).json({ error: "অ্যাপ পাওয়া যায়নি" });
  await pool.query(
    `insert into devices(app_id,endpoint,p256dh,auth) values($1,$2,$3,$4)
     on conflict (app_id,endpoint) do update set p256dh=excluded.p256dh, auth=excluded.auth`,
    [app_id, subscription.endpoint, k.p256dh, k.auth]
  );
  res.json({ ok: true });
}));

// ---------- নোটিফিকেশন পাঠানো (গ্রাহকের সার্ভার থেকে) ----------
app.post("/v1/send", wrap(async (req, res) => {
  const key = (req.headers.authorization || "").replace("Bearer ", "");
  if (!key) return res.status(401).json({ error: "API key দিন" });
  const r = await pool.query(
    `select a.*, c.id as cid, c.monthly_limit, c.sent_count, c.count_month
     from apps a join customers c on c.id=a.customer_id where a.api_key=$1`,
    [key]
  );
  const a = r.rows[0];
  if (!a) return res.status(401).json({ error: "API key ভুল" });

  const { title, body, url, icon } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: "title ও body দিন" });

  const month = new Date().toISOString().slice(0, 7);
  const used = a.count_month === month ? a.sent_count : 0;
  const devs = (await pool.query("select * from devices where app_id=$1", [a.id])).rows;
  if (used + devs.length > a.monthly_limit)
    return res.status(402).json({ error: "মাসিক লিমিট শেষ, প্ল্যান আপগ্রেড করুন" });

  const payload = JSON.stringify({ title, body, url, icon });
  const opts = { vapidDetails: { subject: SUBJECT, publicKey: a.vapid_public, privateKey: a.vapid_private } };
  let sent = 0, failed = 0;
  const gone = [];

  for (let i = 0; i < devs.length; i += 50) {
    const batch = devs.slice(i, i + 50);
    const results = await Promise.allSettled(
      batch.map((d) =>
        webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, opts)
      )
    );
    results.forEach((x, j) => {
      if (x.status === "fulfilled") sent++;
      else {
        failed++;
        const code = x.reason && x.reason.statusCode;
        if (code === 404 || code === 410) gone.push(batch[j].id);
      }
    });
  }
  if (gone.length) await pool.query("delete from devices where id = any($1::int[])", [gone]);
  await pool.query("update customers set sent_count=$1, count_month=$2 where id=$3", [used + sent, month, a.cid]);
  await pool.query("insert into notifications(app_id,title,body,sent,failed) values($1,$2,$3,$4,$5)", [a.id, title, body, sent, failed]);
  res.json({ sent, failed });
}));

(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log("চালু হয়েছে: http://localhost:" + port));
})().catch((e) => { console.error("শুরু করা যায়নি:", e.message); process.exit(1); });
