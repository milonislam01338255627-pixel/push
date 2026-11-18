self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data.json(); } catch (_) { d = { title: "নোটিফিকেশন", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "নোটিফিকেশন", {
    body: d.body, icon: d.icon, data: { url: d.url || "/" },
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data.url));
});
