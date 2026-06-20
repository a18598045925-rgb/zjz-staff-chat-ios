/* 轻量 Service Worker，便于 Android 安装为 PWA；iOS 主要依赖「添加到主屏幕」 */
self.addEventListener('install', function (e) {
  e.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});
