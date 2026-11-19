require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const webpush = require("web-push");
const { Pool } = require("pg");
const PLANS = require("./plans");
const TRIAL_DAYS = 2, TRIAL_LIMIT = 500;

const dbUrl = process.env.DATABASE_URL || "";
const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl && !dbUrl.includes("localhost") ? { rejectUnauthorized: false } : false,
});
const SUBJECT = "mailto:" + (process.env.SUPPORT_EMAIL || "admin@example.com");

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "100kb" }));
["sdk.js", "sw-core.js", "style.css", "common.js"].forEach((f) =>
  app.get("/" + f, (req, res) => res.sendFile(path.join(__dirname, f)))
);
["features", "pricing", "docs", "login", "signup", "dashboard", "billing", "privacy", "terms", "admin"].forEach((p) =>
  app.get("/" + p, (req, res) => res.sendFile(path.join(__dirname, p + ".html")))
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
    "insert into customers(email,password_hash,session_token,plan,monthly_limit,plan_expires_at) values($1,$2,$3,'trial',$4, now() + make_interval(days => $5))",
    [email.toLowerCase(), await bcrypt.hash(password, 10), token, TRIAL_LIMIT, TRIAL_DAYS]
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
  const month = new Date().toISOString().slice(0, 7);
  const p = PLANS.find((x) => x.id === c.plan);
  res.json({
    email: c.email, plan: c.plan, planName: c.plan === "trial" ? "ফ্রি ট্রায়াল" : p ? p.name : c.plan,
    limit: c.monthly_limit, sent: c.count_month === month ? c.sent_count : 0, expires: c.plan_expires_at,
  });
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

app.get("/api/apps/:id/history", auth, wrap(async (req, res) => {
  const r = await pool.query(
    `select n.id, n.title, n.body, n.url, n.image, n.sent, n.failed, n.clicks, n.created_at
     from notifications n join apps a on a.id=n.app_id
     where a.id=$1 and a.customer_id=$2 order by n.id desc limit 20`,
    [req.params.id, req.customer.id]
  );
  res.json(r.rows);
}));

app.delete("/api/apps/:id", auth, wrap(async (req, res) => {
  await pool.query("delete from apps where id=$1 and customer_id=$2", [req.params.id, req.customer.id]);
  res.json({ ok: true });
}));

app.post("/v1/click/:id", wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isInteger(id)) await pool.query("update notifications set clicks=clicks+1 where id=$1", [id]);
  res.json({ ok: true });
}));

app.get("/api/config", (req, res) => {
  res.json({
    nagad: process.env.NAGAD_NUMBER || "", video: process.env.VIDEO_URL || "",
    support: process.env.SUPPORT_EMAIL || "", trial: { days: TRIAL_DAYS, limit: TRIAL_LIMIT },
    imageHost: process.env.IMAGE_HOST_URL || "", plans: PLANS,
  });
});

app.post("/api/payments", auth, wrap(async (req, res) => {
  const { plan_id, sender, trx_id } = req.body || {};
  const plan = PLANS.find((x) => x.id === plan_id);
  const trx = String(trx_id || "").trim().toUpperCase();
  if (!plan) return res.status(400).json({ error: "প্ল্যান বেছে নিন" });
  if (!/^01\d{9}$/.test(String(sender || "").trim())) return res.status(400).json({ error: "সঠিক নগদ নম্বর দিন (01XXXXXXXXX)" });
  if (!/^[A-Z0-9]{6,20}$/.test(trx)) return res.status(400).json({ error: "সঠিক TrxID দিন" });
  const pend = await pool.query("select count(*)::int n from payments where customer_id=$1 and status='pending'", [req.customer.id]);
  if (pend.rows[0].n >= 3) return res.status(429).json({ error: "আগের পেমেন্টগুলো ভেরিফাইয়ের অপেক্ষায় আছে" });
  try {
    await pool.query("insert into payments(customer_id,plan_id,amount,sender,trx_id) values($1,$2,$3,$4,$5)",
      [req.customer.id, plan.id, plan.price, sender.trim(), trx]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "এই TrxID আগে জমা দেওয়া হয়েছে" });
    throw e;
  }
  res.json({ ok: true });
}));

app.get("/api/payments", auth, wrap(async (req, res) => {
  const r = await pool.query("select id, plan_id, amount, trx_id, status, created_at from payments where customer_id=$1 order by id desc limit 10", [req.customer.id]);
  res.json(r.rows);
}));

// ---------- অ্যাডমিন (শুধু আপনার জন্য) ----------
const adminAuth = (req, res, next) => {
  const k = process.env.ADMIN_KEY || "";
  if (!k) return res.status(503).json({ error: "ADMIN_KEY সেট করা নেই" });
  const a = Buffer.from(k), b = Buffer.from(String(req.headers["x-admin-key"] || ""));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "ভুল অ্যাডমিন কী" });
  next();
};

app.get("/admin/payments", adminAuth, wrap(async (req, res) => {
  const r = await pool.query(
    `select p.id, p.plan_id, p.amount, p.sender, p.trx_id, p.status, p.created_at, c.email
     from payments p join customers c on c.id=p.customer_id
     order by (p.status='pending') desc, p.id desc limit 50`);
  res.json(r.rows);
}));

app.post("/admin/payments/:id/approve", adminAuth, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = await pool.query("update payments set status='approved' where id=$1 and status='pending' returning *", [id]);
  const p = c.rows[0];
  if (!p) return res.status(404).json({ error: "পেন্ডিং পেমেন্ট পাওয়া যায়নি" });
  const plan = PLANS.find((x) => x.id === p.plan_id);
  if (!plan) {
    await pool.query("update payments set status='pending' where id=$1", [id]);
    return res.status(400).json({ error: "প্ল্যান পাওয়া যায়নি" });
  }
  await pool.query(
    `update customers set plan=$1, monthly_limit=$2,
     plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + make_interval(days => $3) where id=$4`,
    [plan.id, plan.limit, plan.days, p.customer_id]);
  res.json({ ok: true });
}));

app.post("/admin/payments/:id/reject", adminAuth, wrap(async (req, res) => {
  await pool.query("update payments set status='rejected' where id=$1 and status='pending'", [parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

app.get("/admin/customers", adminAuth, wrap(async (req, res) => {
  const r = await pool.query(
    `select c.id, c.email, c.plan, c.plan_expires_at, c.sent_count,
      (select count(*) from devices d join apps a on a.id=d.app_id where a.customer_id=c.id)::int as devices
     from customers c order by c.id desc limit 100`);
  res.json(r.rows);
}));

app.post("/admin/customers/:id/grant", adminAuth, wrap(async (req, res) => {
  const days = parseInt((req.body || {}).days, 10);
  if (!days || days < 1 || days > 3650) return res.status(400).json({ error: "দিন সংখ্যা দিন" });
  await pool.query(
    "update customers set plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + make_interval(days => $1) where id=$2",
    [days, parseInt(req.params.id, 10)]);
  res.json({ ok: true });
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
    `select a.*, c.id as cid, c.monthly_limit, c.sent_count, c.count_month, c.plan_expires_at
     from apps a join customers c on c.id=a.customer_id where a.api_key=$1`,
    [key]
  );
  const a = r.rows[0];
  if (!a) return res.status(401).json({ error: "API key ভুল" });
  if (!a.plan_expires_at || new Date(a.plan_expires_at) < new Date())
    return res.status(402).json({ error: "ট্রায়াল/প্ল্যানের মেয়াদ শেষ। MPNS ড্যাশবোর্ড থেকে প্ল্যান নিন" });

  const b = req.body || {};
  const clean = (u) => {
    try { const x = new URL(u); return ["http:", "https:"].includes(x.protocol) ? x.href : undefined; }
    catch (_) { return undefined; }
  };
  const title = String(b.title || "").slice(0, 100);
  const body = String(b.body || "").slice(0, 300);
  if (!title || !body) return res.status(400).json({ error: "title ও body দিন" });
  const url = clean(b.url), image = clean(b.image), icon = clean(b.icon);

  const month = new Date().toISOString().slice(0, 7);
  const used = a.count_month === month ? a.sent_count : 0;
  const devs = (await pool.query("select * from devices where app_id=$1", [a.id])).rows;
  if (used + devs.length > a.monthly_limit)
    return res.status(402).json({ error: "মাসিক লিমিট শেষ, প্ল্যান আপগ্রেড করুন" });

  const nid = (await pool.query(
    "insert into notifications(app_id,title,body,url,image,sent,failed) values($1,$2,$3,$4,$5,0,0) returning id",
    [a.id, title, body, url || null, image || null]
  )).rows[0].id;
  const track = req.protocol + "://" + req.get("host") + "/v1/click/" + nid;
  const payload = JSON.stringify({ title, body, url, icon, image, track });
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
  await pool.query("update notifications set sent=$1, failed=$2 where id=$3", [sent, failed, nid]);
  res.json({ sent, failed });
}));

(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log("চালু হয়েছে: http://localhost:" + port));
})().catch((e) => { console.error("শুরু করা যায়নি:", e.message); process.exit(1); });
