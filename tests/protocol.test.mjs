import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Encryption2,FW,unhex,hex,frame,FrameBuffer,bytes} from '../dist/crypto.js';
import {Ninebot} from '../dist/ninebot.js';
const vectors=JSON.parse(await readFile(new URL('./vectors.json',import.meta.url)));
for(const v of vectors) {
 test(`Python cross-reference encryption Gen${v.gen2?2:3}`,async()=>{
  const c=new Encryption2(v.gen2);await c.setKey(new TextEncoder().encode('1CGBC2510C0000'),v.gen2?FW:undefined);
  assert.equal(hex(await c.encrypt(unhex(v.pre))),v.preEncrypted);
  assert.equal(hex(await c.decrypt(unhex(v.preEncrypted))),v.pre);
  c.auth=unhex('00112233445566778899aabbccddeeff');c.sn=true;c.counter=1;
  await c.setKey(unhex('ffeeddccbbaa99887766554433221100'),c.auth);
  assert.equal(hex(await c.encrypt(unhex(v.plain))),v.encrypted);
  assert.equal(hex(await c.encrypt(unhex(v.multi))),v.multiEncrypted);
  assert.equal(hex(await c.decrypt(unhex(v.encrypted))),v.plain);
  assert.equal(hex(await c.decrypt(unhex(v.multiEncrypted))),v.multi);
  await assert.rejects(c.decrypt(unhex(v.encrypted)),/Wiederholter/);
 });
 test(`Tag tampering Gen${v.gen2?2:3}`,async()=>{
  const c=new Encryption2(v.gen2);c.auth=unhex('00112233445566778899aabbccddeeff');c.sn=true;
  await c.setKey(unhex('ffeeddccbbaa99887766554433221100'),c.auth);
  const bad=unhex(v.encrypted);bad[7]^=1;
  await assert.rejects(c.decrypt(bad),/authentifiziert/);
  assert.equal(c.lastRx,-1);
  assert.equal(hex(await c.decrypt(unhex(v.encrypted))),v.plain);
 });
}
test('fragmented and combined notifications retain complete frames',()=>{
 const b=new FrameBuffer(),a=unhex(vectors[0].encrypted),c=unhex(vectors[0].multiEncrypted);
 assert.equal(b.push(bytes([0,5,0x5a])).length,0);
 assert.equal(b.push(a.slice(1,8)).length,0);
 const got=b.push(bytes(a.slice(8),c));
 assert.deepEqual(got,[a,c]);assert.equal(b.buffer.length,0);
});
test('write acceleration only when stationary, ACK then readback',async()=>{
 const c=new Ninebot();c.authenticated=true;const calls=[];
 c.read=async(board,index)=>{calls.push(['read',board,index]);return index===0x57?0:1;};
 c.request=async(...args)=>{calls.push(['request',...args]);c.readAcceleration=async()=>{calls.push(['readback']);return 3;};return {payload:[]};};
 assert.equal(await c.setAcceleration(3),3);
 assert.deepEqual(calls,[['read',0x16,0x57],['read',0x16,0x6e],['request',0x16,2,0x6e,[3,0],5],['readback']]);
});
test('moving, unsupported register and no auth never write',async()=>{
 for(const [speed,level]of [[1,1],[0,0],[0,256]]) {
  const c=new Ninebot();c.authenticated=true;c.read=async(_b,i)=>i===0x57?speed:level;
  c.request=async()=>assert.fail('must not write');
  await assert.rejects(c.setAcceleration(3));
 }
 const c=new Ninebot();await assert.rejects(c.setAcceleration(3),/verbinden/);await assert.rejects(c.setAcceleration(4),/Stufen/);
});
test('readback mismatch never reports success',async()=>{
 const c=new Ninebot();c.authenticated=true;c.read=async(_b,index)=>index===0x57?0:1;c.request=async()=>({});
 await assert.rejects(c.setAcceleration(3),/nicht bestätigt/);
});
test('counter exhaustion requires reconnect',async()=>{
 const c=new Encryption2();c.sn=true;c.counter=65535;await assert.rejects(c.encrypt(frame(0x16,2,0x6e,[3,0])),/erschöpft/);
});

function simulatedGatt({stored=1,confirm=true,delayedAck=0,confirmAfter=1,ignoreAuth=0,board=4,storedKey=null,disconnectInvalid=false,navigation=false}={}) {
 const name='1CGBC2510C0000';let auth,cipher,ready,connections=0;
 const sn=new TextEncoder().encode(name);const writes=[],wireCounters=[],attempts=[],disconnectListeners=new Set();let receiver,key,stage='initial',pairRequests=0,authRequests=0;
 const notify={uuid:'6e400003-b5a3-f393-e0a9-e50e24dcca9e',properties:{notify:true},addEventListener(_n,fn){receiver=fn;},removeEventListener(){receiver=null;},async startNotifications(){}};
 const reply=async(cmd,index,payload=[],source=board)=>{
  const raw=await cipher.encrypt(bytes([0x5a,0xa5,payload.length,source,0x3e,cmd,index],payload));
  if(receiver)receiver({target:{value:new DataView(raw.buffer)}});
 };
 const write={uuid:'6e400002-b5a3-f393-e0a9-e50e24dcca9e',properties:{writeWithoutResponse:true},async writeValueWithoutResponse(raw){
  await ready;const ctr=(raw.at(-2)<<8)|raw.at(-1),cmd=stage==='initial'?0x5b:stage==='ready'&&navigation?null:raw[2]===14?0x5d:0x5c;
  // Only the length is public on the encrypted wire. Classify handshake
  // attempts here, then record verified navigation commands after decryption.
  attempts.push({connection:connections,cmd,counter:ctr});
  if(stage!=='initial')assert.ok(ctr>cipher.counter,`TX counter ${ctr} must exceed last peer counter ${cipher.counter}`);
  if(stage==='pairing'&&cmd===0x5d&&storedKey){await cipher.setKey(storedKey,auth);stage='auth';}
  wireCounters.push(ctr);let plain;
  try{plain=await cipher.decrypt(raw);}catch(e){
   if(stage!=='auth'||cmd!==0x5d)throw e;
   if(disconnectInvalid){device.gatt.disconnect();return;}
   // An AUTH reply signed by the actual vehicle key must fail verification at
   // the client using its obsolete browser key, just as in the reported log.
   cipher.counter=ctr;await reply(0x5d,0);return;
  }
  writes.push(plain);attempts.at(-1).cmd=plain[5];
  if(stage==='initial') {
   assert.equal(plain[5],0x5b);await reply(0x5b,stored,bytes(auth,sn));
   cipher.auth=auth;cipher.sn=true;cipher.counter=1;await cipher.setKey(sn,auth);stage='pairing';
  } else if(stage==='pairing') {
   assert.equal(plain[5],0x5c);key=plain.slice(7);assert.equal(key.length,16);
   pairRequests++;
   if(confirm && pairRequests>=confirmAfter){
    if(delayedAck){await reply(0x5c,0);setTimeout(async()=>{await reply(0x5c,1);await cipher.setKey(key,auth);stage='auth';},delayedAck);}
    else {await reply(0x5c,1);await cipher.setKey(key,auth);stage='auth';}
   } else await reply(0x5c,0);
  } else if(stage==='ready'&&navigation){
   if(plain[5]===1){assert.deepEqual(plain.slice(3),Uint8Array.of(0x3e,0x16,1,0x57,2));await reply(4,0x57,[0,0],0x16);}
   else {assert.ok(['5aa5013e23710001','5aa5013e23710000'].includes(hex(plain)),'manufacturer SimpleNavi start/stop: one byte 01/00');assert.equal(raw.length,14);await reply(0x71,0,[],0x23);}
  } else {
   assert.equal(plain[5],0x5d);assert.deepEqual(plain.slice(7),sn);authRequests++;if(authRequests>ignoreAuth){await reply(0x5d,1);stage='ready';}
  }
 }};
 const server={connected:true,async getPrimaryServices(){return [{uuid:'6e400001-b5a3-f393-e0a9-e50e24dcca9e',async getCharacteristics(){return [write,notify];}}];},async getPrimaryService(){throw new Error('GAP unavailable');}};
 const device={name,id:'simulated-device',addEventListener(n,fn){if(n==='gattserverdisconnected')disconnectListeners.add(fn);},removeEventListener(n,fn){if(n==='gattserverdisconnected')disconnectListeners.delete(fn);},gatt:{
  get connected(){return server.connected;},
  async connect(){connections++;server.connected=true;stage='initial';cipher=new Encryption2();auth=unhex('00112233445566778899aabbccddeeff');auth[0]=connections;ready=cipher.setKey(sn,FW);return server;},
  disconnect(){if(!server.connected)return;server.connected=false;for(const fn of [...disconnectListeners])fn();}
 }};
 return {device,writes,wireCounters,attempts,get connections(){return connections;},get key(){return key;}};
}
test('complete encrypted GATT pairing creates own key even when already paired',async()=>{
 for(const stored of [0,1]) {
  const simulated=simulatedGatt({stored}),statuses=[];let saved;
  const c=new Ninebot(()=>{},s=>statuses.push(s),key=>{saved=key.slice();});c.device=simulated.device;
  await c.connect();
  assert.equal(c.authenticated,true);
  assert.deepEqual(simulated.writes.map(p=>p[5]),[0x5b,0x5c,0x5d]);
  assert.deepEqual(saved,simulated.key);assert.deepEqual(c.newPassword,saved);
  assert.ok(statuses.some(s=>s.startsWith('Power-Taste')));c.disconnect();
 }
});
test('delayed Power ACK between TX attempts is retained',async()=>{
 const simulated=simulatedGatt({delayedAck:30});let saved=false;
 const c=new Ninebot(()=>{},()=>{},()=>{saved=true;});c.device=simulated.device;
 await c.connect();assert.equal(c.authenticated,true);assert.equal(saved,true);
 assert.deepEqual(simulated.wireCounters,[0,2,5]);c.disconnect();
});
test('pending Power confirmation keeps same key and follows vehicle counter',async()=>{
 const simulated=simulatedGatt({confirmAfter:3});const c=new Ninebot();c.device=simulated.device;
 await c.connect();const pair=simulated.writes.filter(p=>p[5]===0x5c);
 assert.equal(pair.length,3);pair.forEach(p=>assert.deepEqual(p.slice(7),c.newPassword));
 assert.deepEqual(simulated.wireCounters,[0,2,4,6,8]);c.disconnect();
});
test('missing Power confirmation never saves a key or authenticates',async()=>{
 const simulated=simulatedGatt({confirm:false});let saved=false;
 const c=new Ninebot(()=>{},()=>{},()=>{saved=true;});c.device=simulated.device;
 const register=c.registerPassword.bind(c);c.registerPassword=(name,epoch)=>register(name,epoch,{timeout:30,retryDelay:5});
 await assert.rejects(c.connect(),/Power-Bestätigung/);
 assert.equal(saved,false);assert.equal(c.authenticated,false);assert.equal(c.newPassword,undefined);
 assert.equal(simulated.writes.some(p=>p[5]===0x5d),false);c.disconnect();
});
test('AUTH retries complete when first two confirmation requests are ignored',async()=>{
 const simulated=simulatedGatt({ignoreAuth:2});const c=new Ninebot();c.device=simulated.device;
 await c.connect();assert.equal(c.authenticated,true);
 assert.equal(simulated.writes.filter(p=>p[5]===0x5d).length,3);c.disconnect();
});
test('PRE_COMM source board is used for subsequent pairing and AUTH',async()=>{
 const simulated=simulatedGatt({board:0x21});const c=new Ninebot();c.device=simulated.device;
 await c.connect();assert.equal(c.bleBoard,0x21);assert.equal(c.authenticated,true);
 assert.deepEqual(simulated.writes.slice(1).map(p=>p[4]),[0x21,0x21]);c.disconnect();
});
test('valid remembered key completes encrypted AUTH without changing pairing',async()=>{
 const storedKey=unhex('00112233445566778899aabbccddeeff'),simulated=simulatedGatt({storedKey});
 const c=new Ninebot(()=>{},()=>{},()=>assert.fail('valid key must not be replaced'));c.device=simulated.device;
 await c.connect(hex(storedKey));assert.equal(c.authenticated,true);assert.equal(simulated.connections,1);
 assert.deepEqual(simulated.writes.map(p=>p[5]),[0x5b,0x5d]);c.disconnect();
});
test('authenticated GATT starts manufacturer SimpleNavi with one byte 01 and verifies the TFT ACK',async()=>{
 const storedKey=unhex('00112233445566778899aabbccddeeff'),simulated=simulatedGatt({storedKey,navigation:true});
 const c=new Ninebot();c.device=simulated.device;await c.connect(hex(storedKey));await c.startNavigation();
 assert.equal(c.navigationStarted,true);assert.equal(c.cipher.lastRx,7);
 assert.deepEqual(simulated.writes.map(p=>[p[4],p[5],p[6],Array.from(p.slice(7))]).slice(-2),[[0x16,1,0x57,[2]],[0x23,0x71,0,[1]]]);
 await c.stopNavigation();assert.equal(c.navigationStarted,false);assert.equal(c.cipher.lastRx,9);assert.equal(hex(simulated.writes.at(-1)),'5aa5013e23710000');
 c.disconnect();
});
test('obsolete key recovers with a new GATT connection, challenge and counter, including peer disconnect',async()=>{
 for(const disconnectInvalid of [false,true]){
  const simulated=simulatedGatt({storedKey:new Uint8Array(16).fill(7),disconnectInvalid}),logs=[];let saved;
  const c=new Ninebot(s=>logs.push(s),()=>{},key=>{saved=key.slice();});c.device=simulated.device;
  const request=c.request.bind(c);c.request=(b,cmd,i,p,e,mi,t,o)=>request(b,cmd,i,p,e,mi,cmd===0x5d?35:t,o);
  await c.connect('00112233445566778899aabbccddeeff');
  assert.equal(c.authenticated,true);assert.equal(simulated.connections,2);assert.deepEqual(saved,simulated.key);
  assert.deepEqual(simulated.attempts.map(({connection,cmd,counter})=>[connection,cmd,counter]),[[1,0x5b,0],[1,0x5d,2],[2,0x5b,0],[2,0x5c,2],[2,0x5d,4]]);
  if(!disconnectInvalid)assert.ok(logs.some(s=>s.includes('Antwort konnte nicht authentifiziert')));
  c.disconnect();
 }
});
test('explicit new pairing skips obsolete key and still requires physical confirmation',async()=>{
 const simulated=simulatedGatt({storedKey:new Uint8Array(16).fill(7),confirm:false});let saved=false;
 const c=new Ninebot(()=>{},()=>{},()=>{saved=true;});c.device=simulated.device;
 const register=c.registerPassword.bind(c);c.registerPassword=(n,e)=>register(n,e,{timeout:30,retryDelay:5});
 await assert.rejects(c.connect('00112233445566778899aabbccddeeff','',{forcePairing:true}),/Power-Bestätigung/);
 assert.equal(simulated.connections,1);assert.equal(saved,false);assert.equal(c.authenticated,false);
 assert.equal(simulated.attempts.some(p=>p.cmd===0x5d),false);c.disconnect();
});
test('cancelled stored-key AUTH never reconnects or replaces the saved key',{timeout:2000},async()=>{
 const simulated=simulatedGatt({storedKey:new Uint8Array(16).fill(7)}),statuses=[];
 const c=new Ninebot(()=>{},s=>statuses.push(s),()=>assert.fail('must not save'));c.device=simulated.device;
 const pending=c.connect('00112233445566778899aabbccddeeff');
 while(!simulated.attempts.some(p=>p.cmd===0x5d))await new Promise(r=>setTimeout(r,1));
 c.disconnect();await assert.rejects(pending,/getrennt|abgebrochen/);c.disconnect();
 assert.equal(simulated.connections,1);assert.equal(statuses.filter(s=>s==='Getrennt').length,1);
});
test('failed recovery stops after one fresh connection without saving an unconfirmed key',async()=>{
 const simulated=simulatedGatt({storedKey:new Uint8Array(16).fill(7),disconnectInvalid:true,confirm:false});
 const c=new Ninebot(()=>{},()=>{},()=>assert.fail('unconfirmed key must not replace the old key'));c.device=simulated.device;
 const register=c.registerPassword.bind(c);c.registerPassword=(n,e)=>register(n,e,{timeout:30,retryDelay:5});
 await assert.rejects(c.connect('00112233445566778899aabbccddeeff'),/Power-Bestätigung/);
 assert.equal(c.authenticated,false);assert.equal(simulated.connections,2);assert.equal(c.newPassword,undefined);
 assert.equal(simulated.attempts.filter(p=>p.connection===2).some(p=>p.cmd===0x5d),false);c.disconnect();
});
test('cancel during pairing prevents saving or authenticating',async()=>{
 const c=new Ninebot();c.server={connected:true};c.cipher=new Encryption2();c.cipher.auth=new Uint8Array(16);
 c.request=async()=>{c.cleanup();throw new Error('Bluetooth-Verbindung getrennt.');};
 await assert.rejects(c.registerPassword('1CGBC2510C0000'),/getrennt/);
 assert.equal(c.newPassword,undefined);assert.equal(c.authenticated,false);
});
test('G3 Python reference: received counter 7 produces next AUTH counter 8',async()=>{
 const v=JSON.parse(await readFile(new URL('./chained-counter.json',import.meta.url)));
 const c=new Encryption2();c.auth=unhex('00112233445566778899aabbccddeeff');c.sn=true;c.counter=2;
 await c.setKey(unhex('ffeeddccbbaa99887766554433221100'),c.auth);
 await c.decrypt(unhex(v.incoming));
 assert.equal(c.counter,7);
 assert.equal(hex(await c.encrypt(unhex(v.outgoingPlain))),v.expectedOutgoing);
});
test('display diagnostics only reads known preference and firmware registers',async()=>{
 const c=new Ninebot();c.authenticated=true;c.generation='Encryption2';c.bleBoard=4;const calls=[];
 c.request=async(board,cmd,index,payload,expect)=>{
  assert.equal(cmd,1,'diagnostics must never send a write');assert.equal(expect,4);assert.deepEqual(payload,[2]);
  assert.ok(![0x61,0x71].includes(index),'must not read PIN registers');
  calls.push({board,index});if(index===0x2e)throw new Error('Keine Antwort');return {payload:Uint8Array.of(0x34,0x12)};
 };
 const result=await c.readDisplayDiagnostics();
 assert.equal(calls.length,13);assert.equal(result.firmware.vcu.hex,'0x1234');
 assert.equal(result.registers.rFunBool.hex,'0x1234');assert.equal(result.registers.rFunDisplayBool5.value,0x1234);
 assert.equal(result.errors.length,1);assert.equal(result.errors[0].name,'rInstumentKey');
});

test('G3 range setting uses preference bit 4; the independent visibility gate is bit 6',async()=>{
 const c=new Ninebot();c.authenticated=true;const calls=[];
 c.read=async(b,i)=>{calls.push([b,i]);return i===0x32?0:0x10;};
 assert.deepEqual(await c.readRangeDisplay(),{enabled:true,advertised:false,preference:0x10,capabilities:0});
 assert.deepEqual(calls,[[0x16,0x32],[0x16,0x2f]]);
 c.read=async(_b,i)=>i===0x32?0x40:0;
 assert.deepEqual(await c.readRangeDisplay(),{enabled:false,advertised:true,preference:0,capabilities:0x40});
});
test('G3 range toggle fresh-reads, preserves other bits, and works with hidden official switch',async()=>{
 for(const enabled of [false,true]) {
  const c=new Ninebot();c.authenticated=true;let preference=enabled?0xa5a5:0xa5b5;const original=preference;const writes=[];
  c.read=async(board,index)=>{assert.equal(board,0x16);assert.ok([0x57,0x32,0x2f].includes(index));return index===0x2f?preference:0;};
  c.writeNoReply=async(board,index,value)=>{writes.push([board,index,value]);preference=value;};
  const result=await c.setRangeDisplay(enabled);
  assert.equal(result.enabled,enabled);assert.equal(result.advertised,false);
  assert.equal(preference^original,0x10);assert.deepEqual(writes,[[0x16,0x2f,preference]]);
 }
});
test('unchanged, moving and unauthenticated range requests never write',async()=>{
 const c=new Ninebot();c.writeNoReply=async()=>assert.fail('must not write');
 await assert.rejects(c.setRangeDisplay(false),/verbinden/);
 c.authenticated=true;c.read=async(_b,i)=>i===0x57?1:0;
 await assert.rejects(c.setRangeDisplay(false),/stillstehen/);
 c.read=async()=>0;assert.equal((await c.setRangeDisplay(false)).enabled,false);
 await assert.rejects(c.setRangeDisplay(0),/Ein oder Aus/);
});
test('range firmware ignoring or changing other bits is not reported as confirmed',async()=>{
 for(const readback of [0x10,0x04]) {
  const c=new Ninebot();c.authenticated=true;let writes=0;
  c.read=async(_b,i)=>i===0x2f?(writes?readback:0x10):0;
  c.writeNoReply=async()=>{writes++;};
  await assert.rejects(c.setRangeDisplay(false),/nicht bestätigt/);
  assert.equal(writes,1,'retry reads only, never blindly rewrite firmware settings');
 }
});
test('range readback tolerates a delayed apply without repeating the write',async()=>{
 const c=new Ninebot();c.authenticated=true;let wrote=false,readbacks=0;
 c.read=async(_b,i)=>i===0x2f?(wrote&&++readbacks>=2?0:0x10):0;
 c.writeNoReply=async()=>{assert.equal(wrote,false);wrote=true;};
 assert.equal((await c.setRangeDisplay(false)).enabled,false);assert.equal(readbacks,2);
});
test('writeNR emits one encrypted command 3 word without waiting for nonexistent protocol ACK',async()=>{
 const c=new Ninebot();c.authenticated=true;c.server={connected:true};c.sync=0xa5;c.response=false;
 const key=unhex('00112233445566778899aabbccddeeff'),auth=new Uint8Array(16);
 c.cipher=new Encryption2();c.cipher.auth=auth;c.cipher.sn=true;c.cipher.counter=4;await c.cipher.setKey(key,auth);
 const peer=new Encryption2();peer.auth=auth;peer.sn=true;await peer.setKey(key,auth);let wrote=false;
 c.writeChar={async writeValueWithoutResponse(wire){
  assert.equal(c.requestBusy,true);assert.equal(c.pending,null);assert.equal(wrote,false);wrote=true;
  const p=await peer.decrypt(wire);assert.deepEqual(p,frame(0x16,3,0x2f,[0xa5,0x12],0xa5));
 }};
 await c.writeNoReply(0x16,0x2f,0x12a5);
 assert.equal(wrote,true);assert.equal(c.pending,null);assert.equal(c.requestBusy,false);
 c.requestBusy=true;await assert.rejects(c.writeNoReply(0x16,0x2f,0),/Anfrage/);
});
test('writeNR aborts after a disconnect while queued RX drains',async()=>{
 const c=new Ninebot();c.authenticated=true;c.server={connected:true};
 c.writeChar={async writeValueWithoutResponse(){assert.fail('must not write after disconnect');}};
 c.rxChain=Promise.resolve().then(()=>c.cleanup());
 await assert.rejects(c.writeNoReply(0x16,0x2f,0),/getrennt/);assert.equal(c.requestBusy,false);
});
