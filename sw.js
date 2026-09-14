const CACHE="srb-label-cutter-v6";
const CORE=["./","./index.html","./style.css","./app.js","./manifest.webmanifest","./icon-192.png","./icon-512.png"];
self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  const url=new URL(e.request.url);
  // Cache-first once libraries have been fetched successfully.
  e.respondWith(caches.match(e.request).then(hit=>{
    if(hit) return hit;
    return fetch(e.request).then(resp=>{
      if(resp && (resp.ok || resp.type==="opaque")){
        const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));
      }
      return resp;
    }).catch(()=>{
      if(e.request.mode==="navigate") return caches.match("./index.html");
      throw new Error("offline");
    });
  }));
});