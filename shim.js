/* Field Companion — standalone runtime.
   Stands in for the Claude artifact runtime: a local database kept on this device,
   optional AI answers with your own Anthropic API key, and web research through the same key. */
(function(){
"use strict";
var APP_VERSION="1.0.1";
var LS="op1db:",SETK="op1c.settings";
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v);return true}catch(e){return false}}
function settings(){try{return Object.assign({ai:false,key:"",model:"claude-sonnet-5-5"},JSON.parse(lsGet(SETK)||"{}"))}catch(e){return {ai:false,key:"",model:"claude-sonnet-5-5"}}}
function saveSettings(s){lsSet(SETK,JSON.stringify(s))}
try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
var LOADED=JSON.stringify(settings());

/* ---------------- local database (same shape the page already uses) ---------------- */
var cache={},listeners=[];
function load(col){if(!cache[col]){try{cache[col]=JSON.parse(lsGet(LS+col)||"{}")}catch(e){cache[col]={}}}return cache[col]}
function persist(col){if(!lsSet(LS+col,JSON.stringify(cache[col]||{}))){var t=document.getElementById("toast");if(t){t.textContent="Storage is full. Export a backup in app settings.";t.classList.add("on")}}}
function rid(){var c="abcdefghijklmnopqrstuvwxyz0123456789",s="";for(var i=0;i<20;i++)s+=c[Math.floor(Math.random()*c.length)];return s}
function clone(o){return o==null?o:JSON.parse(JSON.stringify(o))}
function tombs(){try{return JSON.parse(lsGet(LS+"__deleted")||"[]")}catch(e){return []}}
function notify(col){setTimeout(function(){listeners.forEach(function(l){if(l.col===col)l.fire()})},0)}
function docSnap(col,id){var d=load(col)[id];return {id:id,exists:!!d,data:function(){return clone(d)}}}
function DocRef(col,id){this.col=col;this.id=id||rid();this.path=col+"/"+this.id}
DocRef.prototype.set=function(data){load(this.col)[this.id]=clone(data);persist(this.col);notify(this.col);return Promise.resolve()};
DocRef.prototype.update=function(data){var c=load(this.col),cur=c[this.id];if(!cur)return Promise.reject({code:"not_found"});var nx=Object.assign({},cur,clone(data));if(cur.seed&&this.col==="notes")nx.userEdited=true;c[this.id]=nx;persist(this.col);notify(this.col);return Promise.resolve()};
DocRef.prototype.delete=function(){var c=load(this.col);if(c[this.id]&&c[this.id].seed){var t=tombs();t.push(this.col+"/"+this.id);lsSet(LS+"__deleted",JSON.stringify(t))}delete c[this.id];persist(this.col);notify(this.col);return Promise.resolve()};
DocRef.prototype.get=function(){return Promise.resolve(docSnap(this.col,this.id))};
DocRef.prototype.onSnapshot=function(cb){var self=this,l={col:this.col,fire:function(){try{cb(docSnap(self.col,self.id))}catch(e){console.error(e)}}};listeners.push(l);l.fire();return function(){listeners.splice(listeners.indexOf(l),1)}};
function Query(col,ord,lim){this.col=col;this.ord=ord||null;this.lim=lim||0}
Query.prototype.orderBy=function(f,dir){return new Query(this.col,{f:f,d:dir==="desc"?-1:1},this.lim)};
Query.prototype.limit=function(n){return new Query(this.col,this.ord,n)};
Query.prototype.doc=function(id){return new DocRef(this.col,id)};
Query.prototype._docs=function(){var c=load(this.col),ids=Object.keys(c),o=this.ord;if(o)ids.sort(function(a,b){var x=c[a][o.f],y=c[b][o.f];x=x==null?0:x;y=y==null?0:y;return x<y?-o.d:x>y?o.d:0});if(this.lim)ids=ids.slice(0,this.lim);var col=this.col;return ids.map(function(id){return docSnap(col,id)})};
Query.prototype.get=function(){return Promise.resolve({docs:this._docs()})};
Query.prototype.onSnapshot=function(cb){var self=this,l={col:this.col,fire:function(){try{cb({docs:self._docs()})}catch(e){console.error(e)}}};listeners.push(l);l.fire();return function(){listeners.splice(listeners.indexOf(l),1)}};
var db={collection:function(c){return new Query(c)},doc:function(p){var s=String(p).split("/");return new DocRef(s[0],s[1])}};

/* official notes, controls and status ship with each update and merge in without touching your own notes */
var seedReady=fetch("seed.json",{cache:"no-cache"}).then(function(r){return r.json()}).then(function(seed){
  var have=+(lsGet(LS+"__seedver")||0);if(!(seed.version>have))return;
  var dead=tombs();
  Object.keys(seed.collections).forEach(function(col){
    var c=load(col),docs=seed.collections[col];
    Object.keys(docs).forEach(function(id){var cur=c[id];if(dead.indexOf(col+"/"+id)>=0)return;if(!cur||(cur.seed&&!cur.userEdited)||col==="controls"||col==="meta")c[id]=docs[id]});
    persist(col);notify(col);
  });
  lsSet(LS+"__seedver",String(seed.version));
}).catch(function(){});

/* ---------------- AI with your own key ---------------- */
function aiOn(){var s=settings();return s.ai&&!!s.key}
async function callClaude(prompt,opts){
  opts=opts||{};var s=settings(),body={model:s.model||"claude-sonnet-5-5",max_tokens:opts.max||6000,messages:[{role:"user",content:prompt}]};
  if(opts.tools)body.tools=opts.tools;
  var r;
  try{r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",signal:opts.signal,headers:{"content-type":"application/json","x-api-key":s.key,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify(body)})}
  catch(e){if(e&&e.name==="AbortError")throw {code:"cancelled"};throw {code:"network"}}
  if(!r.ok){var code=r.status===401||r.status===403?"not_granted":r.status===429||r.status===529?"rate_limited":"upstream_error";var msg="";try{msg=(await r.json()).error.message}catch(e){}throw {code:code,message:msg}}
  var j=await r.json(),text="",urls=[];
  (j.content||[]).forEach(function(b){if(b.type==="text"){text+=b.text;(b.citations||[]).forEach(function(c){if(c.url)urls.push({title:c.title||c.url,url:c.url})})}if(b.type==="web_search_tool_result"&&Array.isArray(b.content))b.content.forEach(function(x){if(x.url)urls.push({title:x.title||x.url,url:x.url})})});
  return {text:text,urls:urls};
}
function firstJSON(t){var a=t.indexOf("{"),b=t.lastIndexOf("}");if(a<0||b<a)throw {code:"invalid_json"};try{return JSON.parse(t.slice(a,b+1))}catch(e){throw {code:"invalid_json"}}}
var sample=function(prompt,opts){return callClaude(typeof prompt==="string"?prompt:JSON.stringify(prompt),opts).then(function(r){return {text:r.text,truncated:false}})};
sample.json=function(prompt,opts){return callClaude(prompt,opts).then(function(r){return firstJSON(r.text)})};

/* web research: the page's "search the web" requests are answered here instead of by a scheduled task */
var researching=false;
async function runResearch(){
  if(researching)return;researching=true;
  try{
    var c=load("research"),ids=Object.keys(c).filter(function(id){return c[id].status==="pending"});
    var ctlIds=Object.keys(load("controls")).join(", ");
    for(var i=0;i<ids.length;i++){
      var id=ids[i],r=c[id];await db.doc("research/"+id).update({status:"working"});
      try{
        var p="You research questions about the Teenage Engineering OP-1 Field (the 2022 model, not the original OP-1). Search the web, prefer teenage.engineering, then reputable forums and reviews.\n\nQuestion: "+r.q+(r.ctx?"\nWhat the owner's notes already cover: "+r.ctx:"")+"\n\nReply with only one JSON object: {\"answer\": \"a short plain-language answer in markdown, with steps if it is a how-to\", \"sources\": [{\"title\": \"...\", \"url\": \"https://...\"}], \"confidence\": \"official\" if it comes from teenage engineering, otherwise \"unverified\", \"controls\": [up to 3 key ids from: "+ctlIds+"]}";
        var out=await callClaude(p,{tools:[{type:"web_search_20250305",name:"web_search",max_uses:5}],max:6000});
        var js=firstJSON(out.text),srcs=(Array.isArray(js.sources)&&js.sources.length?js.sources:out.urls).slice(0,8);
        await db.doc("research/"+id).update({status:"done",answer:String(js.answer||""),sources:srcs,confidence:js.confidence==="official"?"official":"unverified",controls:Array.isArray(js.controls)?js.controls.slice(0,3):[],doneAt:Date.now()});
      }catch(e){await db.doc("research/"+id).update({status:"failed",error:e&&e.code==="not_granted"?"The API key was not accepted. Check it in app settings.":"The search did not finish."})}
    }
  }finally{researching=false}
}
var mcp={callTool:function(server,tool){if(tool==="fire_trigger"){runResearch();return Promise.resolve({})}return Promise.reject({code:"not_in_manifest"})}};

window.claude={use:async function(name){
  if(name==="db"){await seedReady;return db}
  if(name==="user")return {can:async function(){return true}};
  if(name==="sample")return aiOn()?sample:null;
  if(name==="mcp")return aiOn()?mcp:null;
  return null;
}};

/* ---------------- app settings panel ---------------- */
function exportData(){
  var out={app:"field-companion",version:APP_VERSION,exportedAt:new Date().toISOString(),collections:{}};
  ["notes","qa","research","recipes"].forEach(function(col){var c=load(col),keep={};Object.keys(c).forEach(function(id){if(col!=="notes"||!c[id].seed||c[id].userEdited)keep[id]=c[id]});out.collections[col]=keep});
  var blob=new Blob([JSON.stringify(out,null,1)],{type:"application/json"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download="field-companion-backup-"+new Date().toISOString().slice(0,10)+".json";document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500);
}
function importData(file,done){
  var fr=new FileReader();fr.onload=function(){try{var j=JSON.parse(fr.result),n=0;Object.keys(j.collections||{}).forEach(function(col){if(["notes","qa","research","recipes"].indexOf(col)<0)return;var c=load(col);Object.keys(j.collections[col]).forEach(function(id){c[id]=j.collections[col][id];n++});persist(col);notify(col)});done("Imported "+n+" items.")}catch(e){done("That file isn't a companion backup.")}};fr.readAsText(file);
}
function panelHTML(){
  var s=settings();
  return '<div class="sx-card" role="dialog" aria-modal="true" aria-labelledby="sx-t"><div class="sx-head"><h2 id="sx-t">app settings</h2><button type="button" class="linkbtn" data-sx="close">close</button></div>'+
  '<section><p class="label">ai answers</p><label class="sx-row"><input type="checkbox" id="sx-ai"'+(s.ai?" checked":"")+'> Answer questions with Claude (uses your own API key)</label>'+
  '<label class="sx-f">Anthropic API key<input type="password" id="sx-key" autocomplete="off" placeholder="sk-ant-…" value="'+(s.key||"").replace(/"/g,"&quot;")+'"></label>'+
  '<label class="sx-f">Model<select id="sx-model"><option value="claude-sonnet-5-5"'+(s.model==="claude-sonnet-5-5"?" selected":"")+'>Claude Sonnet 5.5 (best answers)</option><option value="claude-haiku-4-5-20251001"'+(s.model==="claude-haiku-4-5-20251001"?" selected":"")+'>Claude Haiku 4.5 (cheaper, faster)</option></select></label>'+
  '<p class="hint">Get a key at console.anthropic.com. It is stored only on this device and sent only to Anthropic. Without it, the app works offline and questions search your saved notes.</p>'+
  '<div class="row"><button type="button" class="btn primary" data-sx="save">save</button><button type="button" class="btn small" data-sx="test">test the key</button><span class="hint" id="sx-msg"></span></div></section>'+
  (location.protocol==="app:"?'<section><p class="label">mac app updates</p><label class="sx-f">Your web app address<input type="url" id="sx-url" autocomplete="off" placeholder="https://your-username.github.io/field-companion/" value="'+(lsGet("op1c.updateUrl")||"").replace(/"/g,"&quot;")+'"></label><p class="hint">Paste your GitHub Pages address once. The Mac app checks it when it starts and offers to update.</p></section>':'')+
  '<section><p class="label">your data</p><p class="hint">Your notes, questions and sounds live on this device. Export a backup now and then, or to move them to another device.</p><div class="row"><button type="button" class="btn small" data-sx="export">export backup</button><label class="btn small sx-file">import backup<input type="file" id="sx-imp" accept="application/json,.json" hidden></label><span class="hint" id="sx-imsg"></span></div></section>'+
  '<section><p class="label">updates</p><p class="hint">Version '+APP_VERSION+'. The app updates itself when it starts while online.'+(location.protocol==="app:"?' To check now, use Field Companion → Check for Updates… in the Mac menu bar.</p>':'</p><div class="row"><button type="button" class="btn small" data-sx="update">check for updates now</button><span class="hint" id="sx-umsg"></span></div>')+'</section>'+
  '<p class="hint" style="margin-top:14px">An unofficial learning companion. Not made by or affiliated with teenage engineering.</p></div>';
}
function openPanel(){
  var ov=document.getElementById("sx-ov");if(!ov){ov=document.createElement("div");ov.id="sx-ov";ov.className="sx-ov";document.body.appendChild(ov)}
  ov.innerHTML=panelHTML();ov.hidden=false;var f=ov.querySelector("#sx-key");f&&f.focus();
  ov.querySelector("#sx-imp").addEventListener("change",function(e){var file=e.target.files[0];if(file)importData(file,function(m){ov.querySelector("#sx-imsg").textContent=m})});
}
document.addEventListener("click",async function(e){
  var t=e.target.closest&&e.target.closest("[data-sx]");if(!t){if(e.target.id==="sx-ov")e.target.hidden=true;return}
  var a=t.getAttribute("data-sx"),ov=document.getElementById("sx-ov");
  if(a==="open"){var dr=document.getElementById("drawer"),sc=document.getElementById("scrim");if(dr)dr.hidden=true;if(sc)sc.hidden=true;openPanel();return}
  if(a==="close"){ov.hidden=true;return}
  if(a==="save"||a==="test"){
    var su=ov.querySelector("#sx-url");if(su)lsSet("op1c.updateUrl",su.value.trim());
    var s=settings();s.ai=ov.querySelector("#sx-ai").checked;s.key=ov.querySelector("#sx-key").value.trim();s.model=ov.querySelector("#sx-model").value;saveSettings(s);
    var msg=ov.querySelector("#sx-msg");
    if(a==="test"){if(!s.key){msg.textContent="Paste a key first.";return}msg.textContent="Testing…";try{var r=await callClaude("Reply with the word ok.",{max:300});msg.textContent=r.text?"The key works.":"No reply."}catch(x){msg.textContent=x.code==="not_granted"?"That key was not accepted.":x.code==="network"?"No internet connection.":"Error: "+(x.message||x.code)}return}
    msg.textContent="Saved.";if(JSON.stringify(s)!==LOADED){msg.textContent="Saved. Restarting…";setTimeout(function(){location.reload()},500)}else setTimeout(function(){ov.hidden=true},400);return}
  if(a==="export"){exportData();return}
  if(a==="update"){var um=ov.querySelector("#sx-umsg");um.textContent="Checking…";try{var reg=navigator.serviceWorker&&await navigator.serviceWorker.getRegistration();if(reg)await reg.update();var v=await (await fetch("version.json",{cache:"no-store"})).json();if(v.version!==APP_VERSION){um.textContent="Version "+v.version+" found. Reloading…";setTimeout(function(){location.reload()},800)}else um.textContent="You have the latest version."}catch(x){um.textContent="Couldn't check (offline?)."}}
});
document.addEventListener("keydown",function(e){if(e.key==="Escape"){var ov=document.getElementById("sx-ov");if(ov&&!ov.hidden){ov.hidden=true;e.stopPropagation()}}},true);
document.addEventListener("DOMContentLoaded",function(){
  var dr=document.getElementById("drawer"),help=dr&&dr.querySelector('[data-go="help"]');
  if(help){var b=document.createElement("button");b.type="button";b.className="fold";b.setAttribute("data-sx","open");b.innerHTML='<span class="fi">⚙</span>app settings<small>'+(aiOn()?"ai on":"offline")+'</small>';help.parentNode.insertBefore(b,help.nextSibling)}
});

/* offline + updates on the web (not used inside the Mac app, which updates itself) */
if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="localhost")){
  window.addEventListener("load",function(){navigator.serviceWorker.register("sw.js").then(function(reg){
    reg.addEventListener("updatefound",function(){var w=reg.installing;w&&w.addEventListener("statechange",function(){if(w.state==="installed"&&navigator.serviceWorker.controller){var t=document.getElementById("toast");if(t){t.textContent="Updated. It will use the new version next time you open it.";t.classList.add("on");setTimeout(function(){t.classList.remove("on")},3500)}}})});
  }).catch(function(){})});
}
})();
