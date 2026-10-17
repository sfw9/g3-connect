import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ninebot,NORDIC,CUSTOM} from '../dist/ninebot.js?v=11';

test('device chooser filters Ninebot services by default and can list every device',async()=>{
 const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),seen=[];
 Object.defineProperty(globalThis,'navigator',{value:{bluetooth:{requestDevice:async o=>{seen.push(o);return {id:'x'};}}},configurable:true});
 try{
  await new Ninebot().choose();await new Ninebot().choose(true);
  assert.deepEqual(seen[0].filters,[{services:[NORDIC]},{services:[CUSTOM]},{namePrefix:'1C'}]);assert.equal(seen[0].acceptAllDevices,undefined);
  assert.equal(seen[1].acceptAllDevices,true);assert.equal(seen[1].filters,undefined);
  for(const o of seen)assert.deepEqual(o.optionalServices,[NORDIC,CUSTOM,'generic_access']);
 }finally{if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;}
});

class Element extends EventTarget {
 constructor(){super();this.value='';this.dataset={};this.disabled=false;this.hidden=false;this.checked=false;this.textContent='';}
 setAttribute(k,v){this[k]=v;}
}
test('a non-G3 scooter (e.g. F3) connects and reads, but settings stay locked',async()=>{
 const ids=[...(await readFile(new URL('../dist/index.html',import.meta.url),'utf8')).matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 const nodes=new Map(ids.map(id=>[id,new Element()])),doc=new EventTarget(),radios=[1,2,3].map(v=>Object.assign(new Element(),{value:String(v)}));
 doc.getElementById=id=>nodes.get(id);doc.querySelectorAll=()=>radios;doc.querySelector=()=>radios.find(r=>r.checked)||null;
 const names=['document','window','navigator','localStorage','sessionStorage'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 const methods=['connect','readAcceleration','readRangeDisplay','choose'],original=new Map(methods.map(n=>[n,Ninebot.prototype[n]]));
 const chooseArgs=[],win=Object.assign(new EventTarget(),{isSecureContext:true,location:{hash:'',pathname:'/',search:''}});
 try{
  for(const [name,value]of Object.entries({document:doc,window:win,navigator:{userAgent:'test',bluetooth:{}},localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null}}))
   Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  Ninebot.prototype.choose=async function(all){chooseArgs.push(all);this.device={id:'f3',name:'N4GSD2510C0000',gatt:{disconnect(){}},removeEventListener(){}};return this.device;};
  Ninebot.prototype.connect=async function(){this.deviceName=this.device.name;this.generation='Encryption2 · Nordic UART';this.authenticated=true;};
  Ninebot.prototype.readAcceleration=async()=>2;
  Ninebot.prototype.readRangeDisplay=async()=>({enabled:true,advertised:true,preference:16,capabilities:0});
  nodes.get('show-all-devices').checked=true;
  await import('../dist/app.js?models-test');
  nodes.get('connect').dispatchEvent(new Event('click'));
  for(let i=0;i<20&&nodes.get('connect').disabled;i++)await new Promise(r=>setImmediate(r));
  assert.deepEqual(chooseArgs,[true],'the "all devices" option reaches the chooser');
  assert.equal(nodes.get('connect').textContent,'Trennen');
  assert.equal(nodes.get('current-level').textContent,'Stufe 2','reading still works');
  assert.match(nodes.get('device-caption').textContent,/F3/);
  assert.equal(nodes.get('levels').disabled,true);assert.equal(nodes.get('range-enabled').disabled,true);
  radios[0].checked=true;nodes.get('levels').dispatchEvent(new Event('change'));
  assert.equal(nodes.get('apply').disabled,true,'acceleration writes are locked');
  nodes.get('range-enabled').checked=false;nodes.get('range-enabled').dispatchEvent(new Event('change'));
  assert.equal(nodes.get('apply-range').disabled,true,'range writes are locked');
  assert.match(nodes.get('range-capability').textContent,/Nur Lesen/);
 }finally{
  win.dispatchEvent(new Event('pagehide'));
  for(const [name,method]of original)Ninebot.prototype[name]=method;
  for(const [name,descriptor]of old)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
 }
});
