const CACHE_NAME = 'lifeos-v17-learning-center';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './sw.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// 安装：缓存核心文件
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 拦截请求：网络优先（确保拿到最新版本），网络失败时用缓存兜底
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // CDN 资源走网络优先 + 缓存兜底
  if (url.origin !== location.origin) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  // 本地文件走网络优先，拿到后更新缓存
  e.respondWith(
    fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      return resp;
    }).catch(() => caches.match(e.request).then(cached => cached || caches.match('./index.html')))
  );
});
