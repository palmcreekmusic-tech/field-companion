/* Field Companion service worker: works offline, and picks up new versions the next time you open the app. */
var VERSION="1.0.3",CACHE="fc-"+VERSION;
var SHELL=["./","index.html","shim.js","seed.json","version.json","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png","icon-maskable-512.png","favicon.png"];
self.addEventListener("install",function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(SHELL)}).then(function(){return self.skipWaiting()}))});
self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k.indexOf("fc-")===0&&k!==CACHE}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener("fetch",function(e){
  var req=e.request,url=new URL(req.url);
  if(req.method!=="GET"||url.origin!==location.origin)return;   /* API calls and fonts go straight to the network */
  e.respondWith(fetch(req,{cache:"no-cache"}).then(function(res){if(res&&res.status===200){var copy=res.clone();e.waitUntil(caches.open(CACHE).then(function(c){return c.put(req,copy)}).catch(function(){}))}return res}).catch(function(){return caches.match(req,{ignoreSearch:true}).then(function(m){return m||caches.match("index.html")})}));
});
