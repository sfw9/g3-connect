import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ninebot} from '../dist/ninebot.js?v=15';

class Element extends EventTarget {
 constructor(){super();this.value='';this.dataset={};this.disabled=false;this.hidden=false;this.checked=false;this.textContent='';this.children=[];}
 setAttribute(k,v){this[k]=v;}
 appendChild(c){this.children.push(c);return c;}
 replaceChildren(...n){this.children=n;}
}

test('an invalid typed key is refused without connecting; normal connect reuses the saved key',async()=>{
 const ids=[...(await readFile(new URL('../dist/index.html',import.meta.url),'utf8')).matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 const nodes=new Map(ids.map(id=>[id,new Element()])),doc=new EventTarget();
 doc.getElementById=id=>nodes.get(id);doc.querySelectorAll=()=>[];doc.querySelector=()=>null;doc.createElement=()=>new Element();
 const names=['document','window','navigator','localStorage','sessionStorage'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 const methods=['connect','readAcceleration','readRangeDisplay'],original=new Map(methods.map(n=>[n,Ninebot.prototype[n]]));
 const stored='00112233445566778899aabbccddeeff',storage=new Map([['g3-pairing:ui-device',stored]]),calls=[];
 let clicking=false,selections=0;
 const device={id:'ui-device',name:'1CGBC2510C0000',gatt:{disconnect(){}},removeEventListener(){}};
 const win=Object.assign(new EventTarget(),{isSecureContext:true,location:{hash:'',pathname:'/',search:''}});
 try{
  for(const [name,value]of Object.entries({document:doc,window:win,navigator:{userAgent:'test',bluetooth:{requestDevice(){assert.equal(clicking,true,'device chooser must retain click activation');selections++;return Promise.resolve(device);}}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:()=>null}}))
   Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  Ninebot.prototype.connect=async function(key,name){
   calls.push({key,name});
   this.authenticated=true;
  };
  Ninebot.prototype.readAcceleration=async()=>2;
  Ninebot.prototype.readRangeDisplay=async()=>({enabled:true,advertised:false,preference:16,capabilities:0});
  nodes.get('remember-pairing').checked=true;nodes.get('pairing-key').value='kein gültiger Schlüssel';
  await import('../dist/app.js?connection-test');
  const click=async id=>{
   clicking=true;nodes.get(id).dispatchEvent(new Event('click'));clicking=false;
   for(let i=0;i<20&&nodes.get('connect').disabled;i++)await new Promise(r=>setImmediate(r));
   assert.equal(nodes.get('connect').disabled,false,'connection action must finish');
  };
  await click('connect');
  assert.deepEqual(calls,[],'an invalid typed key must not reach a connection attempt');
  assert.equal(selections,0,'a refused key must not open the device chooser');
  assert.equal(storage.get('g3-pairing:ui-device'),stored,'a refused key must preserve the previous key');
  assert.equal(nodes.get('pairing-key').value,'kein gültiger Schlüssel');
  nodes.get('pairing-key').value='';
  await click('connect');
  assert.deepEqual(calls[0],{key:stored,name:''});
  assert.equal(selections,1);assert.equal(nodes.get('connect').textContent,'Trennen');
  assert.equal(nodes.get('current-level').textContent,'Stufe 2');
  assert.equal(nodes.get('log').value.includes(stored),false);
  assert.equal(nodes.get('pairing-key').value,stored,'the saved key in use can be revealed after connecting');
  assert.equal(nodes.get('save-key').hidden,false,'and saved');
 }finally{
  win.dispatchEvent(new Event('pagehide'));
  for(const [name,method]of original)Ninebot.prototype[name]=method;
  for(const [name,descriptor]of old)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
 }
});
