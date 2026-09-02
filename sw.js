/* Pocket Aquarium — offline shell service worker (PAIOS-02).
   Dependency-free, no build step, no network runtime beyond same-origin caching.

   Design rules:
   - VERSIONED cache: bump CACHE_VERSION to ship a new shell; activate() deletes
     every older Pocket Aquarium cache so a stale shell can never pin the app.
   - RELATIVE allowlist: every precached URL is relative to this worker's scope, so
     the same file works at "/", at a localhost server, and under the GitHub Pages
     subpath "/pocket-aquarium/". No leading-slash / absolute origin paths.
   - CONSERVATIVE fetch: only same-origin GETs are handled. Navigations fall back to
     the cached shell when the network is unavailable (offline launch); other shell
     assets are cache-first with a network fallback. Cross-origin and non-GET requests
     are left entirely to the browser — nothing opaque is cached.
   - The worker never caches itself; the browser updates sw.js on its own byte-diff. */
"use strict";

// v3: ship the PAR5 dark aquarium-instrument shell — index.html, styles.css, js/app.js and
// js/render.js all changed, so this bump retires the v2 cache and stops an already-controlled
// client from continuing to serve the pre-fix app on next activate.
var CACHE_VERSION = "v3";
var CACHE_NAME = "pocket-aquarium-shell-" + CACHE_VERSION;

/* Relative to the worker scope — subpath-safe under /pocket-aquarium/. */
var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/data.js",
  "./js/sim.js",
  "./js/render.js",
  "./js/app.js",
  // Renderer-critical art: two habitat plates + three validated species sprites.
  // These are what the Canvas draws (js/render.js); without them a cold offline
  // launch falls back to the procedural look after HTTP-cache eviction.
  "./assets/habitats/reef-lagoon-v1.png",
  "./assets/habitats/amazon-blackwater-v1.png",
  "./assets/animals/ocellaris-clownfish-v2.png",
  "./assets/animals/neon-tetra-v1.png",
  "./assets/animals/yellow-watchman-goby-v1.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECACHE_URLS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        // Drop any prior Pocket Aquarium shell cache; leave unrelated caches alone.
        if (key !== CACHE_NAME && key.indexOf("pocket-aquarium-shell-") === 0) {
          return caches.delete(key);
        }
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") { return; }

  var url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) { return; } // same-origin only

  // Navigations: network-first, fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(function () {
        return caches.match("./index.html").then(function (hit) {
          return hit || caches.match("./");
        });
      })
    );
    return;
  }

  // Other same-origin assets: cache-first, then network.
  event.respondWith(
    caches.match(request).then(function (hit) {
      return hit || fetch(request);
    })
  );
});
