/**
 * @file TLRphotos Service Worker
 * @description
 *  仅做静态资源 cache-first 缓存：
 *  - 仅处理 GET 且同源请求
 *  - 仅缓存 /assets/ 构建产物与图片/字体扩展名资源
 *  - /api/ 等动态接口一律放行，不缓存
 */

const CACHE_NAME = 'tlr-static-v1';
const CACHEABLE_PATH = /^\/assets\//;
const CACHEABLE_EXT = /\.(?:png|jpe?g|webp|gif|svg|ico|woff2?)$/i;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (!CACHEABLE_PATH.test(url.pathname) && !CACHEABLE_EXT.test(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
