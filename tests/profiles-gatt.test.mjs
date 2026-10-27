import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {Ninebot} from '../dist/ninebot.js';
import {Encryption2,FW,unhex,hex,bytes} from '../dist/crypto.js';
import {readProfiles,writeProfiles} from '../dist/profiles.js';
const v=JSON.parse(await readFile(new URL('./profiles-firmware.json',import.meta.url)));
const byName=n=>v.vectors.find(x=>x.name===n);
async function connection({noisy=false}={}){
 const name='1CGBC2510C0000',sn=new TextEncoder().encode(name),key=unhex('ffeeddccbbaa99887766554433221100'),auth=unhex('00112233445566778899aabbccddeeff');
 const peer=new Encryption2();await peer.setKey(sn,FW);let receiver,stage='pre',seqWritten=false,settingsWritten=false;const writes=[],lengths=[],counters=[];
 const notify={uuid:'6e400003-b5a3-f393-e0a9-e50e24dcca9e',properties:{notify:true},addEventListener(_e,fn){receiver=fn;},removeEventListener(){receiver=null;},async startNotifications(){}};
 async function emit(clear){
  const wire=await peer.encrypt(clear);
  // A 33-byte encrypted F4 read reply arrives across several notifications.
  for(const chunk of [wire.slice(0,1),wire.slice(1,18),wire.slice(18)])if(chunk.length)receiver?.({target:{value:new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength)}});
 }
 const write={uuid:'6e400002-b5a3-f393-e0a9-e50e24dcca9e',properties:{writeWithoutResponse:true},async writeValueWithoutResponse(wire){
  const clear=await peer.decrypt(wire);writes.push(clear);lengths.push(wire.length);counters.push((wire.at(-2)<<8)|wire.at(-1));
  if(stage==='pre'){
   assert.equal(clear[5],0x5b);await emit(bytes([0x5a,0xa5,30,4,0x3e,0x5b,1],auth,sn));
   peer.auth=auth;peer.sn=true;peer.counter=1;await peer.setKey(key,auth);stage='auth';return;
  }
  if(stage==='auth'){assert.equal(clear[5],0x5d);await emit(bytes([0x5a,0xa5,0,4,0x3e,0x5d,1]));stage='ready';return;}
  assert.equal(clear[3],0x3e);assert.equal(clear[4],0x16);let response;
  if(clear[5]===1){const i=clear[6];response=i===0x17?unhex(byName('version').replyClear):bytes([0x5a,0xa5,2,0x16,0x3e,4,i,0,0]);}
  else if(clear[5]===0xf1){
   assert.equal(clear[2],0);const slot=clear[6];response=unhex(byName(slot===0?(seqWritten?'read-sequence-after-write':'read-sequence'):(settingsWritten?'read-settings-after-write':'read-settings')).replyClear);
   if(noisy&&slot===1){const wrong=response.slice();wrong[3]=0x23;await emit(wrong);const other=response.slice();other[6]=2;await emit(other);}
  }else{
   assert.equal(clear[5],0xf2);const which=clear[6]===0?'write-sequence':'write-settings';
   assert.equal(hex(clear),byName(which).clear,'outbound command must exactly match the executed ARM/UART fixture');
   if(clear[6]===0)seqWritten=true;else settingsWritten=true;response=unhex(byName(which).replyClear);
  }
  await emit(response);
 }};
 const server={connected:true,async getPrimaryServices(){return [{uuid:'6e400001-b5a3-f393-e0a9-e50e24dcca9e',async getCharacteristics(){return [write,notify];}}];},async getPrimaryService(){throw new Error('no GAP');}};
 const c=new Ninebot();c.device={name,id:'gatt-profiles',addEventListener(){},removeEventListener(){},gatt:{async connect(){return server;},disconnect(){server.connected=false;}}};
 await c.connect(hex(key));return {c,writes,lengths,counters};
}
test('actual firmware vectors work through remembered pairing, Encryption2 and fragmented F4/F5 notifications',async()=>{
 const {c,writes,lengths,counters}=await connection();try{
  const s=await readProfiles(c);const r=await writeProfiles(c,s,{sequence:'1 2 4 5 6 7 8',settings:{normal:{low:10,flag4:true},alternate:{high:42,flag800:false}}});
  assert.deepEqual(r.confirmedBlocks,[0,1]);assert.equal(r.settings.alternate.high,42);
  for(const name of ['read-sequence','read-settings','write-sequence','write-settings'])assert.ok(writes.some(p=>hex(p)===byName(name).clear));
  assert.ok(writes.some((p,i)=>p[5]===0xf2&&p[6]===0&&lengths[i]===33));assert.ok(writes.some((p,i)=>p[5]===0xf2&&p[6]===1&&lengths[i]===29));
  assert.ok(counters.slice(2).every((n,i)=>n>counters[i+1]));assert.equal(c.requestBusy,false);
 }finally{c.disconnect();}
});
test('authenticated wrong-source and wrong-selector F4 messages cannot satisfy the pending profile read',async()=>{
 const {c}=await connection({noisy:true});try{const s=await readProfiles(c);assert.equal(s.rawSettings.length,16);assert.equal(s.settings.alternate.high,45);}finally{c.disconnect();}
});
