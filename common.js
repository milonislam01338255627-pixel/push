document.documentElement.classList.add("js");
var $ = function (i) { return document.getElementById(i); };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
var TOK = function () { return localStorage.getItem("t"); };
var BELL = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15L6 17z" fill="#0b6b5c"/><path d="M10 20a2 2 0 0 0 4 0" stroke="#0b6b5c" stroke-width="2" stroke-linecap="round"/><circle cx="18" cy="5" r="3.2" fill="#ffb020" stroke="#f7f9f8" stroke-width="1.5"/></svg>';
window.CFG_P = fetch("/api/config").then(function (r) { return r.json(); }).catch(function () { return { plans: [], trial: { days: 2, limit: 500 } }; });

function toast(m, bad) {
  var t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.className = "toast show" + (bad ? " e" : ""); t.textContent = m;
  clearTimeout(t._t); t._t = setTimeout(function () { t.className = "toast" + (bad ? " e" : ""); }, 3300);
}
function logout() { localStorage.removeItem("t"); location.href = "/"; }
async function api(p, m, b) {
  var r = await fetch(p, { method: m || "GET", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOK() }, body: b ? JSON.stringify(b) : undefined });
  var j = await r.json().catch(function () { return {}; });
  if (r.status === 401) { localStorage.removeItem("t"); location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search); throw new Error("লগইন করুন"); }
  if (!r.ok) throw new Error(j.error || "সমস্যা হয়েছে");
  return j;
}
function pubNav() {
  var el = $("nav"); if (!el) return;
  var L = [["/features", "ফিচার"], ["/pricing", "প্রাইসিং"], ["/docs", "গাইড"]], p = location.pathname;
  el.innerHTML = '<header class="nav"><div class="nav-in"><a class="brand" href="/">' + BELL + 'MPNS</a><nav>' +
    L.map(function (l) { return '<a href="' + l[0] + '"' + (p === l[0] ? ' class="on"' : "") + ">" + l[1] + "</a>"; }).join("") +
    '</nav><div class="nav-cta">' + (TOK() ? '<a class="btn" href="/dashboard">ড্যাশবোর্ড</a>' : '<a class="btn ghost" href="/login">লগইন</a><a class="btn" href="/signup">ফ্রি শুরু করুন</a>') +
    '</div><button class="burger" aria-label="মেনু">☰</button></div></header>';
  var n = el.firstChild; el.querySelector(".burger").onclick = function () { n.classList.toggle("open"); };
}
function pubFoot() {
  var el = $("foot"); if (!el) return;
  el.innerHTML = '<footer class="foot"><div class="wrap"><div class="foot-grid"><div><a class="brand" href="/">' + BELL + 'MPNS</a><p>মিলন পুশ নোটিফিকেশন সার্ভার। আপনার ওয়েবসাইটের ভিজিটরের ফোনে সরাসরি নোটিফিকেশন পাঠান।</p></div>' +
    '<div><h4>প্রোডাক্ট</h4><a href="/features">ফিচার</a><a href="/pricing">প্রাইসিং</a><a href="/docs">গাইড</a></div>' +
    '<div><h4>অ্যাকাউন্ট</h4><a href="/login">লগইন</a><a href="/signup">ফ্রি ট্রায়াল</a><a href="/dashboard">ড্যাশবোর্ড</a></div>' +
    '<div><h4>আইনি</h4><a href="/privacy">প্রাইভেসি পলিসি</a><a href="/terms">শর্তাবলী</a><a id="sup" href="#"></a></div></div>' +
    '<div class="cp">© ' + new Date().getFullYear() + ' M.P.N.S — সর্বস্বত্ব সংরক্ষিত</div></div></footer>';
  CFG_P.then(function (c) { var a = $("sup"); if (c.support) { a.href = "mailto:" + c.support; a.textContent = c.support; } else a.remove(); });
}
function appShell(active) {
  if (!TOK()) { location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search); return false; }
  var L = [["dash", "/dashboard", "ড্যাশবোর্ড", "📊"], ["bill", "/billing", "বিলিং", "💳"], ["doc", "/docs", "গাইড", "📖"]];
  $("top").innerHTML = '<div class="ap-top"><div class="ap-in"><a class="brand" href="/">' + BELL + 'MPNS</a><div class="ap-links">' +
    L.map(function (l) { return '<a href="' + l[1] + '"' + (active === l[0] ? ' class="on"' : "") + ">" + l[2] + "</a>"; }).join("") +
    '</div><button class="btn ghost s" onclick="logout()">বের হন</button></div></div>';
  $("bar").innerHTML = '<div class="ap-bar">' + L.map(function (l) { return '<a href="' + l[1] + '"' + (active === l[0] ? ' class="on"' : "") + "><b>" + l[3] + "</b>" + l[2] + "</a>"; }).join("") + "</div>";
  return true;
}
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
  return new Promise(function (ok, no) { var a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); ok(); } catch (e) { no(); } a.remove(); });
}
document.addEventListener("click", function (e) {
  var b = e.target.closest("[data-copy]"); if (!b) return;
  copyText($(b.getAttribute("data-copy")).textContent).then(function () { toast("কপি হয়েছে ✅"); }).catch(function () { toast("হাতে সিলেক্ট করে কপি করুন", true); });
});
function reveal() {
  var els = document.querySelectorAll(".rv"); if (!els.length) return;
  if (!("IntersectionObserver" in window)) { els.forEach(function (e) { e.classList.add("in"); }); return; }
  var io = new IntersectionObserver(function (en) { en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } }); }, { threshold: .12 });
  els.forEach(function (e, i) { e.style.transitionDelay = (i % 4) * 90 + "ms"; io.observe(e); });
}
function bn(n) { return String(n).replace(/\d/g, function (d) { return "০১২৩৪৫৬৭৮৯"[d]; }); }
function plansHtml(plans, opts) {
  opts = opts || {};
  var best = plans.reduce(function (a, p) { return p.days / p.price > a ? p.days / p.price : a; }, 0);
  return plans.map(function (p) {
    var pop = p.id === "m1", bv = p.days / p.price === best && plans.length > 1 && !pop;
    return '<div class="plan rv' + (pop ? " pop" : "") + '">' + (pop ? '<span class="badge">সবচেয়ে জনপ্রিয়</span>' : bv ? '<span class="badge">সেরা মূল্য</span>' : "") +
      "<h3>" + esc(p.name) + '</h3><div class="pr">৳' + bn(p.price) + '</div><div class="m sm">প্রতিদিন প্রায় ৳' + bn((p.price / p.days).toFixed(1)) + "</div>" +
      "<ul><li>মাসে " + bn(p.limit) + " নোটিফিকেশন</li><li>ছবি ও লিংক সহ পাঠান</li><li>ক্লিক রিপোর্ট</li><li>API ও ড্যাশবোর্ড</li></ul>" +
      '<a class="btn' + (pop ? " amber" : " ghost") + ' block" href="/billing?plan=' + esc(p.id) + '">এই প্ল্যান নিন</a></div>';
  }).join("");
}
