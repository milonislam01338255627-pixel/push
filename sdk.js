(function () {
  var s = document.currentScript;
  var appId = s.getAttribute("data-app-id");
  var host = new URL(s.src).origin;
  function toKey(v) {
    var p = "=".repeat((4 - (v.length % 4)) % 4);
    var raw = atob((v + p).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw.split("").map(function (c) { return c.charCodeAt(0); }));
  }
  async function subscribe() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window))
      throw new Error("এই ব্রাউজারে পুশ সাপোর্ট নেই");
    var perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("অনুমতি দেওয়া হয়নি");
    var cfg = await (await fetch(host + "/v1/config/" + appId)).json();
    var reg = await navigator.serviceWorker.register(s.getAttribute("data-sw") || "/pushsaas-sw.js");
    await navigator.serviceWorker.ready;
    var sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(cfg.publicKey) }));
    await fetch(host + "/v1/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, subscription: sub.toJSON() }),
    });
    return sub;
  }
  window.PushSaaS = { subscribe: subscribe };
})();
