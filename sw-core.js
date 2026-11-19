self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data.json(); } catch (_) { d = { title: "নোটিফিকেশন", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "নোটিফিকেশন", {
    body: d.body, icon: d.icon, badge: d.icon, image: d.image,
    data: { url: d.url || self.registration.scope, track: d.track },
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var data = e.notification.data || {};
  var jobs = [];
  if (data.track) jobs.push(fetch(data.track, { method: "POST", mode: "no-cors" }).catch(function () {}));
  jobs.push(clients.openWindow(data.url || self.registration.scope));
  e.waitUntil(Promise.all(jobs));
});
