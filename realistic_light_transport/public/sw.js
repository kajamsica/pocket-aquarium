/* Pocket Aquarium 3D offline shell. All URLs are relative to this worker's scope so
 * the same build works under the GitHub Pages project path and in a local preview. */
'use strict'

const CACHE_NAME = 'pocket-aquarium-3d-v3'
const PRECACHE = [
  './',
  './index.html',
  './asset-manifest.json',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
]

async function installCompleteRuntime() {
  const cache = await caches.open(CACHE_NAME)
  await cache.addAll(PRECACHE)
  const response = await fetch('./asset-manifest.json', { cache: 'no-store' })
  if (!response.ok) throw new Error(`asset manifest returned ${response.status}`)
  const manifest = await response.json()
  const paths = new Set()
  for (const entry of Object.values(manifest)) {
    if (entry && typeof entry.file === 'string') paths.add(`./${entry.file}`)
    for (const key of ['css', 'assets']) {
      if (Array.isArray(entry?.[key])) for (const file of entry[key]) paths.add(`./${file}`)
    }
  }
  await cache.addAll([...paths])
}

self.addEventListener('install', (event) => {
  event.waitUntil(installCompleteRuntime().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) =>
    key.startsWith('pocket-aquarium-3d-') && key !== CACHE_NAME ? caches.delete(key) : undefined,
  ))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try { url = new URL(request.url) } catch { return }
  if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) await (await caches.open(CACHE_NAME)).put('./index.html', response.clone())
      return response
    }).catch(() => caches.match('./index.html', { ignoreVary: true }).then((cached) => cached || caches.match('./', { ignoreVary: true }))))
    return
  }

  event.respondWith(caches.match(request, { ignoreVary: true }).then((cached) => cached || fetch(request).then(async (response) => {
    if (response.ok && (response.type === 'basic' || response.type === 'cors')) {
      await (await caches.open(CACHE_NAME)).put(request, response.clone())
    }
    return response
  })))
})
