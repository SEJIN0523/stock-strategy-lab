const CACHE='kr-strategy-lab-v6';
const ASSETS=['./','./index.html','./daily.html','./daily-ui.js','./daily-decision.js','./style.css','./app.js','./research-ui.js','./engine.js','./taxes.js','./market-data.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('kr-strategy-lab-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||!ASSETS.some(path=>new URL(path,self.registration.scope).href===u.href))return;event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request)));});
