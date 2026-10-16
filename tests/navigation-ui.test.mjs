import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installNavigation} from '../dist/navigation-ui.js';
class Element extends EventTarget{
 constructor(){super();this.value='';this.disabled=false;this.hidden=false;this.textContent='';this.children=[];}
 append(x){this.children.push(x);if(!this.value)this.value=x.value;}
 replaceChildren(){this.children=[];this.value='';}
 setAttribute(k,v){this[k]=v;}
}
const route={code:'Ok',routes:[{duration:100,legs:[{steps:[
 {name:'Weg',maneuver:{type:'depart'},geometry:{coordinates:[[13,52],[13.001,52]]}},
 {name:'Ziel',maneuver:{type:'turn',modifier:'left'},geometry:{coordinates:[[13.001,52],[13.001,52.001]]}},
 {name:'Ziel',maneuver:{type:'arrive'},geometry:{coordinates:[[13.001,52.001]]}}
]}]}]};
test('phone route can be planned, started and stopped without any Bluetooth connection',async()=>{
 const ids=[...(await readFile(new URL('../dist/index.html',import.meta.url),'utf8')).matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 const nodes=new Map(ids.map(id=>[id,new Element()])),doc=new EventTarget();doc.getElementById=id=>nodes.get(id);doc.createElement=()=>new Element();
 const old={document:globalThis.document,window:globalThis.window,sessionStorage:globalThis.sessionStorage,history:globalThis.history,fetch:globalThis.fetch};const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const position={coords:{latitude:52,longitude:13,accuracy:5}};let watcher,cleared=false;
 globalThis.document=doc;globalThis.window=Object.assign(new EventTarget(),{location:{hash:'',pathname:'/',search:''}});
 globalThis.sessionStorage={getItem:()=>null};globalThis.history={replaceState(){}};
 Object.defineProperty(globalThis,'navigator',{value:{geolocation:{getCurrentPosition:cb=>cb(position),watchPosition:cb=>{watcher=cb;return 7;},clearWatch:id=>{assert.equal(id,7);cleared=true;}}},configurable:true});
 globalThis.fetch=async()=>({ok:true,json:async()=>route});const flush=()=>new Promise(r=>setImmediate(r));let component;
 try{
  component=installNavigation({getClient:()=>null,isBusy:()=>false,setBusy(){},log(){}});
  nodes.get('nav-location').dispatchEvent(new Event('click'));await flush();
  nodes.get('nav-query').value='52.001,13.001';nodes.get('nav-find').dispatchEvent(new Event('click'));await flush();
  assert.equal(nodes.get('nav-plan').disabled,false);
  nodes.get('nav-plan').dispatchEvent(new Event('click'));await flush();assert.equal(nodes.get('nav-phone').disabled,false);
  nodes.get('nav-phone').dispatchEvent(new Event('click'));await flush();assert.equal(nodes.get('nav-stop').disabled,false);
  watcher(position);assert.match(nodes.get('nav-instruction').textContent,/Links abbiegen/);
  component.update();assert.equal(nodes.get('nav-stop').disabled,false,'offline phone navigation must not be stopped by UI refresh');
  await component.stop();assert.equal(cleared,true);assert.equal(nodes.get('nav-stop').disabled,true);
 }finally{await component?.stop();Object.assign(globalThis,old);if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;}
});

test('display test repeats for 15 seconds without GPS or a route, ends, and loses confirmation on disconnect',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval']});
 const ids=[...(await readFile(new URL('../dist/index.html',import.meta.url),'utf8')).matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 const nodes=new Map(ids.map(id=>[id,new Element()])),doc=new EventTarget();doc.getElementById=id=>nodes.get(id);
 const old={document:globalThis.document,window:globalThis.window,sessionStorage:globalThis.sessionStorage};const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 globalThis.document=doc;globalThis.window=Object.assign(new EventTarget(),{location:{hash:'',pathname:'/',search:''}});globalThis.sessionStorage={getItem:()=>null};
 Object.defineProperty(globalThis,'navigator',{value:{geolocation:{getCurrentPosition(){assert.fail('synthetic display test must not require GPS');}}},configurable:true});
 const calls=[],logs=[];let busy=false,component;
 const c={device:{id:'display-test'},authenticated:true,navigationStarted:false,
  async startNavigation(){calls.push('start');this.navigationStarted=true;},
  async updateNavigation(state,options){assert.equal(this.navigationStarted,true);assert.equal(state.icon,2);assert.equal(state.stepRemaining,100);assert.deepEqual(options,{total:300,initial:true});calls.push('data');},
  async stopNavigation(){this.navigationStarted=false;calls.push('end');}
 };
 const flush=()=>new Promise(r=>setImmediate(r));
 try{
  component=installNavigation({getClient:()=>c,isBusy:()=>busy,setBusy:v=>{busy=v;},log:s=>logs.push(s)});
  nodes.get('nav-test').dispatchEvent(new Event('click'));await flush();
  assert.deepEqual(calls,['start','data']);assert.equal(nodes.get('nav-stop').disabled,false);assert.equal(nodes.get('nav-verified').disabled,true);
  for(let i=0;i<14;i++){t.mock.timers.tick(1000);await flush();}
  assert.equal(calls.filter(s=>s==='data').length,15);assert.equal(calls.includes('end'),false);
  t.mock.timers.tick(1000);await flush();
  assert.equal(calls.at(-1),'end');assert.equal(nodes.get('nav-verified').disabled,false);assert.match(nodes.get('nav-status').textContent,/15 Sekunden beendet/);
  t.mock.timers.tick(5000);await flush();assert.equal(calls.filter(s=>s==='data').length,15);
  nodes.get('nav-verified').checked=true;nodes.get('nav-verified').dispatchEvent(new Event('change'));
  c.authenticated=false;component.update();assert.equal(nodes.get('nav-verified').checked,false);
  c.authenticated=true;component.update();assert.equal(nodes.get('nav-verified').disabled,true,'reconnected session requires a new visible test');
  assert.ok(logs.some(s=>s.includes('Startton allein')));
  nodes.get('nav-test').dispatchEvent(new Event('click'));await flush();
  t.mock.timers.tick(1000);await flush();
  nodes.get('nav-stop').dispatchEvent(new Event('click'));await flush();
  const stoppedCount=calls.length;t.mock.timers.tick(20000);await flush();
  assert.equal(calls.length,stoppedCount,'manual stop must cancel every later test write');
  nodes.get('nav-test').dispatchEvent(new Event('click'));await flush();
  doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));await flush();
  const backgroundCount=calls.length;t.mock.timers.tick(20000);await flush();
  assert.equal(calls.length,backgroundCount,'backgrounding must stop the synthetic test');
 }finally{await component?.stop();Object.assign(globalThis,old);if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;t.mock.timers.reset();}
});

test('missing display start ACK never sends test data or enables confirmation',async()=>{
 const ids=[...(await readFile(new URL('../dist/index.html',import.meta.url),'utf8')).matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 const nodes=new Map(ids.map(id=>[id,new Element()])),doc=new EventTarget();doc.getElementById=id=>nodes.get(id);
 const old={document:globalThis.document,window:globalThis.window,sessionStorage:globalThis.sessionStorage};
 globalThis.document=doc;globalThis.window=Object.assign(new EventTarget(),{location:{hash:'',pathname:'/',search:''}});globalThis.sessionStorage={getItem:()=>null};
 let busy=false,component;
 const c={device:{id:'silent-display'},authenticated:true,async startNavigation(){throw new Error('Start nicht bestätigt');},async updateNavigation(){assert.fail('must wait for start ACK');}};
 try{
  component=installNavigation({getClient:()=>c,isBusy:()=>busy,setBusy:v=>{busy=v;},log(){}});
  nodes.get('nav-test').dispatchEvent(new Event('click'));await new Promise(r=>setImmediate(r));
  assert.equal(busy,false);assert.equal(nodes.get('nav-verified').disabled,true);assert.equal(nodes.get('nav-stop').disabled,true);
  assert.match(nodes.get('nav-status').textContent,/Start nicht bestätigt/);
 }finally{await component?.stop();Object.assign(globalThis,old);}
});
