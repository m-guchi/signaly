'use strict'

// キャッシュを全て削除して再起動する
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

// ── Web Push（アプリ終了中も通知）────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = { title: 'Signaly', body: '', url: './' }
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() }
    } catch {
      data.body = event.data.text()
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Signaly', {
      body: data.body || '',
      icon: 'icon-192.png?v=1.0.7',
      badge: 'icon-192.png?v=1.0.7',
      tag: data.id || undefined,
      data: { url: data.url || './', channel: data.channel || '' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || './'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})

// キャッシュしない：HTML / JS / CSS は常にネットワークから取得
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request))
})

// キャッシュしない：全リクエストをネットワークから取得
