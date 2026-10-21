import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installSoundUI} from '../dist/sound-ui.js';

class Element extends EventTarget{constructor(){super();this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.textContent='';}}
test('event picker: slot 71 uploads without confirmation, 72/73 and manual slots need it, mode toggle writes only 0x1F',async t=>{
 const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
 const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 assert.match(html,/<option value="71" selected>/);
 const nodes=new Map(ids.map(id=>[id,new Element()]));nodes.get('snd-event').value='71';
 const old={document:globalThis.document,window:globalThis.window,URL:globalThis.URL};
 globalThis.document={getElementById:id=>nodes.get(id)};globalThis.window=new EventTarget();
 globalThis.URL=class extends URL{static createObjectURL(){return 'blob:x';}static revokeObjectURL(){}};
 t.after(()=>Object.assign(globalThis,old));
 const regs=new Map([[0x1f,0x0000]]),writes=[];
 const client={authenticated:true,async read(b,i){return regs.get(i)??0;},async writeNoReply(b,i,v){writes.push([b,i,v]);regs.set(i,v);},
  async sendUnacknowledged(){},async request(b,cmd){return {index:0,payload:cmd===0x76?Uint8Array.of(0x40,0,0,0):new Uint8Array()};}};
 let busy=false;installSoundUI({getClient:()=>client,isBusy:()=>busy,setBusy:v=>{busy=v;},log(){},writable:()=>true});
 const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
 const pick=v=>{nodes.get('snd-event').value=v;nodes.get('snd-event').dispatchEvent(new Event('change'));};
 nodes.get('snd-tone').dispatchEvent(new Event('click'));
 assert.equal(nodes.get('snd-confirm-row').hidden,true);assert.equal(nodes.get('snd-upload').disabled,false,'slot 71 is confirmed');
 assert.match(nodes.get('snd-slot-info').textContent,/Custom-Taste: Slot 71.*bestätigt/);
 pick('72');assert.equal(nodes.get('snd-confirm-row').hidden,false);assert.equal(nodes.get('snd-upload').disabled,true);
 nodes.get('snd-confirm').checked=true;nodes.get('snd-confirm').dispatchEvent(new Event('change'));assert.equal(nodes.get('snd-upload').disabled,false);
 pick('other');assert.equal(nodes.get('snd-slot-field').hidden,false);assert.equal(nodes.get('snd-confirm').checked,false,'confirmation resets on change');
 assert.equal(nodes.get('snd-upload').disabled,true);assert.equal(nodes.get('snd-mode-on').disabled,true,'no mask for a manual slot');
 pick('73');nodes.get('snd-mode-on').dispatchEvent(new Event('click'));await flush();
 assert.deepEqual(writes,[[0x16,0x1f,0x4000]]);assert.match(nodes.get('snd-mode-state').textContent,/Einschaltton eigener Sound/);
 nodes.get('snd-dry').dispatchEvent(new Event('click'));
 assert.match(nodes.get('snd-status').textContent,/Trockenlauf Slot 73 \(Einschaltton\): Register 0x1F Bit 0x4000 löschen.*Nichts gesendet/);
 // Upload for the custom button also assigns the button action; the previous action (e.g. hazard lights) can be restored.
 regs.set(0x4a,5);writes.length=0;pick('71');
 nodes.get('snd-upload').dispatchEvent(new Event('click'));await new Promise(r=>setTimeout(r,50));await flush();
 assert.deepEqual(writes.filter(w=>w[1]===0x4a),[[0x16,0x4a,8]]);assert.equal(regs.get(0x1f)&0x1000,0x1000);
 assert.match(nodes.get('snd-status').textContent,/Upload abgeschlossen.*von Aktion 5 auf Soundeffekt umgestellt/);
 assert.equal(nodes.get('snd-key-restore').disabled,false);
 nodes.get('snd-key-restore').dispatchEvent(new Event('click'));await flush();
 assert.equal(regs.get(0x4a),5);assert.match(nodes.get('snd-status').textContent,/zurückgesetzt/);
});
