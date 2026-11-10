// オフラインでも開けるように、アプリのファイルを取っておく（ノートの中身はアプリ側の IndexedDB）
// ファイルを変えたら VERSION を上げる
const VERSION = 'ws-notes-v24';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'parser.js', 'daily.js', 'icons.js', 'manifest.webmanifest',
  'vendor/marked.js', 'vendor/purify.js', 'vendor/fonts/fonts.css', 'desk.css', 'ws/notes.css', 'ws/ui.js', 'ws/keys.js', 'ws/notes.js', 'graph.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  // ブラウザの HTTP キャッシュ（GitHub Pages は 10 分）を通さずに、新しいファイルを取る
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 先に取っておいたものを返し、裏で新しいものに入れかえる（フォントは使った分だけ取っておく）
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
