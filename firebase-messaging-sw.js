/* Service worker de Firebase Cloud Messaging.
   Recibe los push cuando la app está cerrada o en segundo plano.
   Debe vivir en la raíz del sitio (/firebase-messaging-sw.js).
   Copia aquí la MISMA configuración que pusiste en js/firebase-config.js. */

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyA1KVzxatxOxQ3xppVfUifg7V0mvcFi_nY",
  authDomain: "recuerdame-d56ed.firebaseapp.com",
  projectId: "recuerdame-d56ed",
  storageBucket: "recuerdame-d56ed.firebasestorage.app",
  messagingSenderId: "757167369055",
  appId: "1:757167369055:web:67b7f2091522f08341e4ea"
});

const messaging = firebase.messaging();

// Mensajes que llegan en segundo plano. Como la función de Netlify envía el
// bloque "notification", el navegador suele mostrarlos solo; este handler
// cubre los que vienen únicamente con "data".
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  if (payload.notification) return; // ya lo muestra el navegador
  self.registration.showNotification(d.title || "Recuérdame", {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: d.tag || undefined,
    data: { url: d.url || "/" }
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if ("focus" in c) { c.navigate(url); return c.focus(); }
      }
      return clients.openWindow(url);
    })
  );
});

// Cache mínimo para que la PWA abra sin red (shell de la app).
const CACHE = "recuerdame-v1";
const SHELL = ["/", "/index.html", "/css/styles.css", "/js/app.js", "/js/firebase-config.js", "/data/pico-y-placa.json", "/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Red primero, cache de respaldo: así los cambios se ven de inmediato.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html")))
  );
});
