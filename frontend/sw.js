'use strict'

const CACHE_NAME = 'signaly-v1'
const ASSETS = ['./', './app.js', './style.css', './manifest.json', './icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // API・SSE リクエストはキャッシュしない
  if (
    request.method !== 'GET' ||
    url.pathname.includes('/api/') ||
    url.pathname.includes('/webhook/')
  ) {
    return
  }

  // アプリシェルはキャッシュ優先
  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request))
  )
})
