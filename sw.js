const CACHE = "benchday-v1.0.1";
const FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./src/app.mjs",
  "./src/model.mjs",
  "./src/dispatch.mjs",
  "./src/storage.mjs",
  "./manifest.webmanifest",
];
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("benchday-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const saved = await caches.match(event.request, { ignoreSearch: true });
      if (saved) return saved;
      return new Response("This resource is not available offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      });
    }),
  );
});
