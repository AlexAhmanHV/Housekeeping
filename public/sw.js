self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Hushåll";
  const options = {
    body: data.body || "",
    data: { url: data.url || "/app/important" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/app/important";
  event.waitUntil(clients.openWindow(url));
});
