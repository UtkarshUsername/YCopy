# Service Worker Cache Refresh Policy

Use this policy for this repository's vanilla JavaScript PWA service worker.

1. Define a `CACHE_VERSION` constant and derive the cache name from it.
2. On each production deploy, bump `CACHE_VERSION` so a new cache name is created automatically.
3. In `install`:
   - Precache core app assets.
   - Call `self.skipWaiting()` so the new service worker activates immediately.
4. In `activate`:
   - Delete old caches that do not match the current cache name.
   - Call `self.clients.claim()` so all open tabs are controlled by the new worker.
5. In `fetch` handling:
   - Use network-first for HTML/document requests.
   - Use cache-first for static assets (CSS, JS, images, fonts).
6. In client app registration logic:
   - Add a `controllerchange` listener.
   - Reload once when a new service worker takes control so users immediately run the latest assets.

Do not add unrelated agent instructions in this file.
