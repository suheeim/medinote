/* わたしの薬ノート — Service Worker
   - アプリ本体のオフラインキャッシュ
   - 通知のクリック処理
   - プッシュ通知（push）の受信（要・プッシュ配信サーバー）
   - 定刻通知（Notification Triggers / 対応ブラウザのみ）
*/
const CACHE = 'medinote-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=> c.addAll(ASSETS)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

// ネット優先・失敗時キャッシュ（GETのみ）
self.addEventListener('fetch', (e)=>{
  const req = e.request;
  if(req.method!=='GET' || !req.url.startsWith('http')) return;
  e.respondWith(
    fetch(req).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(c=> c.put(req, copy)).catch(()=>{});
      return res;
    }).catch(()=> caches.match(req).then(r=> r || caches.match('./index.html')))
  );
});

// 通知をタップしたらアプリを前面に
self.addEventListener('notificationclick', (e)=>{
  e.notification.close();
  e.waitUntil((async ()=>{
    const all = await clients.matchAll({type:'window', includeUncontrolled:true});
    for(const c of all){ if('focus' in c){ c.postMessage({type:'open-today'}); return c.focus(); } }
    if(clients.openWindow) return clients.openWindow('./index.html');
  })());
});

// プッシュ通知の受信（サーバーから送られてきた場合）
self.addEventListener('push', (e)=>{
  let data = { title:'💊 わたしの薬ノート', body:'お薬の時間です' };
  try{ if(e.data) data = Object.assign(data, e.data.json()); }catch(_){ if(e.data) data.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'medinote',
    data: { url: './index.html' }
  }));
});

// ページからのメッセージ（通知の予約・取り消し）
self.addEventListener('message', (e)=>{
  const msg = e.data || {};
  if(msg.type==='schedule'){ scheduleTriggers(msg.items||[]); }
});

// Notification Triggers（対応ブラウザのみ：定刻にバックグラウンド通知）
async function scheduleTriggers(items){
  if(!('showTrigger' in Notification.prototype)) return;
  // 既存の予約済み通知をクリア
  const existing = await self.registration.getNotifications({ includeTriggered:true });
  existing.forEach(n=>{ if((n.tag||'').startsWith('rem-')) n.close(); });
  for(const it of items){
    try{
      await self.registration.showNotification(it.title, {
        body: it.body,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: it.tag,
        showTrigger: new TimestampTrigger(it.at),
        data: { url: './index.html' }
      });
    }catch(_){}
  }
}
