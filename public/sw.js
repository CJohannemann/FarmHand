// Registered from src/lib/push.ts. Kept deliberately tiny, the same as
// PropertyManagement's: it only receives a notification while the app
// isn't open and shows it. It caches nothing and takes no part in serving
// the app, so it can never leave a phone running an old build.
//
// The payload comes from deploy/selfhost/send-notifications.ts:
// { title, body, link, tag }.

// Take over straight away: subscribing needs an active worker, and one
// left waiting behind an older one made "Turn on alerts" fail on iPhones.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // An unreadable payload still gets a notification rather than nothing.
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'FarmHand', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // The same alert sent twice replaces itself instead of stacking.
      tag: data.tag,
      data: { link: data.link || '/' },
    }),
  )
})

// Tapping it opens the app — the one already open if there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'
  const url = new URL(link, self.location.origin).href
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          return client.focus().then((c) => (c && 'navigate' in c ? c.navigate(url) : c))
        }
      }
      return clients.openWindow ? clients.openWindow(url) : undefined
    }),
  )
})
