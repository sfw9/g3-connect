import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {installProfilesUI} from '../dist/profiles-ui.js';
class Element extends EventTarget{
 constructor(tag='div'){super();this.tagName=tag;this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';this.className='';this.children=[];this._attr={};}
 appendChild(c){this.children.push(c);return c;}
 replaceChildren(...n){this.children=n;}
 setAttribute(k,v){this._attr[k]=v;}
 getAttribute(k){return this._attr[k];}
}
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
const vectors=JSON.parse(await readFile(new URL('./profiles-firmware.json',import.meta.url)));
const raw=name=>Uint8Array.from(Buffer.from(vectors.vectors.find(x=>x.name===name).replyClear,'hex')).slice(7);
async function setup(t,{model=true,version=0xaa03,fail=false}={}){
 const nodes=new Map(ids.map(id=>[id,new Element()])),old=globalThis.document;globalThis.document={getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag)};t.after(()=>{globalThis.document=old;});
 const c={authenticated:true,session:1,device:{id:'ui-profile'},blocks:[raw('read-sequence'),raw('read-settings')],writes:[],speed:0,
  async read(_b,i){return i===0x17?version:i===0x57?this.speed:0;},
  async request(_b,cmd,i,p){if(cmd===0xf1)return {index:i,payload:this.blocks[i].slice()};this.writes.push([i,Array.from(p)]);if(!fail)this.blocks[i]=Uint8Array.from(p);return {index:i,payload:new Uint8Array()};}
 };
 let busy=false,component;const logs=[];component=installProfilesUI({getClient:()=>c,isBusy:()=>busy,setBusy:v=>{busy=v;component?.update();},log:s=>logs.push(s),writable:()=>model});
 const flush=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};
 const click=async id=>{nodes.get(id).dispatchEvent(new Event('click'));await flush();};
 return {c,nodes,component,logs,click,flush};
}
test('profiles tab exposes read-first configuration, explicit raw bytes and no imaginary switch command',()=>{
 assert.equal(new Set(ids).size,ids.length);assert.match(html,/id="tab-profiles".*aria-controls="panel-profiles"/);
 assert.match(html,/id="panel-profiles".*aria-labelledby="tab-profiles"/);assert.match(html,/kein.*Fernbefehl|keinen Fernbefehl/);
 assert.match(html,/Byte 0 \(Race\) wird nur gelesen/);assert.match(html,/Zuordnung aus dem originalen G3-Client/);
});
test('read populates fields; edits send F2 only on explicit save and confirm RAM, not flash',async t=>{
 const {c,nodes,component,click}=await setup(t);
 assert.equal(nodes.get('profiles-save').disabled,true);assert.equal(nodes.get('profiles-fields').disabled,true);
 await click('profiles-read');assert.equal(nodes.get('profiles-fields').disabled,false);assert.equal(nodes.get('profiles-normal-high').value,'22');assert.equal(nodes.get('profiles-alternate-high').value,'45');
 assert.equal(nodes.get('profiles-normal-high').max,'22');assert.equal(nodes.get('profiles-save').disabled,true);
 nodes.get('profiles-normal-high').value='20';nodes.get('profiles-normal-high').dispatchEvent(new Event('input'));
 assert.equal(c.writes.length,0);assert.equal(nodes.get('profiles-save').disabled,false);
 await click('profiles-save');assert.equal(c.writes.length,1);assert.equal(c.writes[0][0],1);
 assert.match(nodes.get('profiles-status').textContent,/RAM.*Rücklesen.*Neustart/);assert.equal(nodes.get('profiles-save').disabled,true);
 assert.equal(component.snapshot().settings.normal.high,20);assert.equal(component.snapshot().settings.normal.low,22);
});
test('defaults are offline form edits only; a stock-looking version still edits, non-G3 stays read-only',async t=>{
 const a=await setup(t);await a.click('profiles-read');await a.click('profiles-defaults');assert.equal(a.c.writes.length,0);assert.match(a.nodes.get('profiles-status').textContent,/Noch nichts geschrieben/);
 // The firmware advertises a stock version (0x162); CFW is detected by the F1 profile protocol, so the fields stay editable.
 const b=await setup(t,{version:0x162});await b.click('profiles-read');assert.equal(b.nodes.get('profiles-fields').disabled,false);
 const c=await setup(t,{model:false});assert.equal(c.nodes.get('profiles-read').disabled,true);await c.click('profiles-read');assert.equal(c.component.snapshot(),null);
});
test('disconnect invalidates the snapshot and pending edits before a later connection',async t=>{
 const {c,nodes,component,click}=await setup(t);await click('profiles-read');nodes.get('profiles-sequence').value='1 2';nodes.get('profiles-sequence').dispatchEvent(new Event('input'));
 c.authenticated=false;component.update();assert.equal(component.snapshot(),null);assert.equal(nodes.get('profiles-export').disabled,true);
 c.authenticated=true;c.session++;component.update();assert.equal(nodes.get('profiles-fields').disabled,true);assert.equal(nodes.get('profiles-save').disabled,true);
});
test('unconfirmed writes and blank numeric fields never produce a success message',async t=>{
 const {c,nodes,component,click}=await setup(t,{fail:true});await click('profiles-read');nodes.get('profiles-normal-flag4').checked=true;nodes.get('profiles-normal-flag4').dispatchEvent(new Event('change'));await click('profiles-save');
 assert.match(nodes.get('profiles-status').textContent,/Rücklesen stimmt nicht/);assert.equal(component.snapshot(),null);assert.equal(c.writes.length,1);
 await click('profiles-read');nodes.get('profiles-normal-high').value='';nodes.get('profiles-normal-high').dispatchEvent(new Event('input'));await click('profiles-save');assert.match(nodes.get('profiles-status').textContent,/nicht leer/);assert.equal(c.writes.length,1);
});
test('a Sport limit below the 15 km/h minimum is rejected before any F2',async t=>{
 const {c,nodes,component,click}=await setup(t);await click('profiles-read');
 nodes.get('profiles-normal-high').value='10';nodes.get('profiles-normal-high').dispatchEvent(new Event('input'));
 await click('profiles-save');assert.match(nodes.get('profiles-status').textContent,/Mindestgeschwindigkeit/);assert.equal(c.writes.length,0);assert.equal(component.snapshot(),null);
});
