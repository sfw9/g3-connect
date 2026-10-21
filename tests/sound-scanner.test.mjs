import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installSoundUI} from '../dist/sound-ui.js';

class Element extends EventTarget{constructor(){super();this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.textContent='';}}
test('player plays numbers one by one, marks heard numbers and only ever writes playSound',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const ids=[...(await readFile(new URL('../dist/index.html',import.meta.url),'utf8')).matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 const nodes=new Map(ids.map(id=>[id,new Element()]));
 for(const [id,v]of Object.entries({'snd-scan-from':'5','snd-scan-to':'8','snd-scan-pause':'2'}))nodes.get(id).value=v;
 const old={document:globalThis.document,window:globalThis.window};
 globalThis.document={getElementById:id=>nodes.get(id)};globalThis.window=new EventTarget();
 t.after(()=>{Object.assign(globalThis,old);t.mock.timers.reset();});
 const writes=[],client={authenticated:true,async writeNoReply(board,index,value){writes.push([board,index,value]);}};
 let busy=false;const ui=installSoundUI({getClient:()=>client,isBusy:()=>busy,setBusy:v=>{busy=v;},log(){},writable:()=>true});
 const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
 nodes.get('snd-scan-start').dispatchEvent(new Event('click'));await flush();
 assert.deepEqual(writes,[[0x16,0x77,5]]);assert.equal(nodes.get('snd-scan-current').textContent,'5');
 assert.equal(nodes.get('snd-upload').disabled,true,'no upload while scanning');
 t.mock.timers.tick(2000);await flush();
 nodes.get('snd-scan-hit').dispatchEvent(new Event('click'));
 assert.match(nodes.get('snd-scan-hits').textContent,/Ton gehört bei: 6/);
  for(let i=0;i<4;i++){t.mock.timers.tick(2000);await flush();}
 assert.deepEqual(writes.map(w=>w[2]),[5,6,7,8]);assert.ok(writes.every(w=>w[0]===0x16&&w[1]===0x77),'only playSound is written');
 assert.match(nodes.get('snd-scan-status').textContent,/Fertig. Markiert: 6/);
 nodes.get('snd-scan-prev').dispatchEvent(new Event('click'));await flush();assert.equal(writes.at(-1)[2],7,'manual stepping');
 ui.update();
});
