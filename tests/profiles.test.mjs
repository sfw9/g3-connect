import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {encodeSequence,decodeSequence,encodeSettings,decodeSettings,readProfiles,writeProfiles,profileHex,PROFILE_EVENTS} from '../dist/profiles.js';
const firmware=JSON.parse(await readFile(new URL('./profiles-firmware.json',import.meta.url)));
const originalClient=JSON.parse(await readFile(new URL('./profiles-original-client.json',import.meta.url)));
const raw=name=>Uint8Array.from(Buffer.from(firmware.vectors.find(x=>x.name===name).replyClear,'hex')).slice(7);
function scooter(options={}){
 const c={authenticated:true,session:1,device:{id:'profile-device'},version:0xaa03,active:0,speed:0,log:[],blocks:[raw('read-sequence'),raw('read-settings')],...options};
 c.read=async(b,i)=>{c.log.push(['read',b,i]);assert.equal(b,0x16);return i===0x17?c.version:i===0x57?c.speed:c.active?2:0;};
 c.request=async(b,cmd,i,p,expect,match)=>{
  c.log.push(['request',b,cmd,i,Array.from(p)]);assert.equal(b,0x16);assert.equal(match,i);
  if(cmd===0xf1){assert.equal(expect,0xf4);assert.equal(p.length,0);return {board:0x16,index:i,payload:c.blocks[i].slice()};}
  assert.equal(cmd,0xf2);assert.equal(expect,0xf5);c.blocks[i]=Uint8Array.from(p);
  if(c.ignoreWrite)c.blocks[i][0]^=1;
  if(c.dropAck)throw new Error('Keine Antwort auf Befehl 0xf2.');
  return {board:0x16,index:i,payload:new Uint8Array()};
 };return c;
}
const writes=c=>c.log.filter(x=>x[0]==='request'&&x[2]===0xf2);
test('profile fields match bytes returned by the actual emulated firmware',()=>{
 assert.deepEqual(decodeSequence(raw('read-sequence')),[1,1,1,1,1,2,2,2,2,2]);
 assert.deepEqual(decodeSettings(raw('read-settings')),{normal:{low:22,high:22,flag4:false,flag800:false,cruise:false},alternate:{low:0,high:45,flag4:true,flag800:true,cruise:true},limits:[{low:22,high:22},{low:0,high:45}],autoReturn:true,beep:true});
 assert.equal(profileHex(encodeSequence('1, 2; 4 5 6 7 8')),'01 02 04 05 06 07 08 00 00 00 00 00 00 00 00 00 00 00 00 00');
});
test('semantic labels match the sanitized original-client capture',()=>{
 const s=decodeSettings(raw('read-settings')),c=originalClient.deviceConfig;
 assert.equal(s.normal.low,c.speed.normal.race);assert.equal(s.normal.high,c.speed.normal.sport);
 assert.equal(s.alternate.low,c.speed.tuned.race);assert.equal(s.alternate.high,c.speed.tuned.sport);
 assert.equal(s.normal.flag4,c.underglow_lights.normal);assert.equal(s.alternate.flag4,c.underglow_lights.tuned);
 assert.equal(s.normal.flag800,c.front_light_bar.normal);assert.equal(s.alternate.flag800,c.front_light_bar.tuned);
 assert.equal(s.normal.cruise,c.cruise_control.normal);assert.equal(s.alternate.cruise,c.cruise_control.tuned);
 assert.equal(s.autoReturn,c.panic_button);assert.equal(s.beep,c.beep_on_profile_switch);
 assert.deepEqual(PROFILE_EVENTS.map(x=>x[0]),Object.keys(originalClient.g3InputMap).map(Number));
});
test('sequence limits, terminator and unsupported input codes are explicit',()=>{
 assert.equal(encodeSequence(Array(19).fill(1))[19],0);
 for(const v of ['',[],[0],[3],[9],Array(20).fill(1),'1 0 2','1foo2','NaN'])assert.throws(()=>encodeSequence(v));
 assert.throws(()=>decodeSequence(new Uint8Array(20)));assert.throws(()=>decodeSequence(new Uint8Array(20).fill(1)));
});
test('settings preserve live limit bytes and unchanged noncanonical true flag bytes',()=>{
 const r=raw('read-settings');r[8]=7;const p=encodeSettings(r,{normal:{low:10,flag4:true},alternate:{high:42}});
 assert.deepEqual(p.slice(4,8),r.slice(4,8));assert.equal(p[8],7);assert.equal(p[0],10);assert.equal(p[3],42);
 for(const patch of [{normal:{low:23}},{alternate:{low:1}},{alternate:{high:46}},{normal:{high:NaN}},{normal:{low:-1}},{normal:{flag4:1}},{beep:1},{limits:[]},{normal:{unknown:true}}])assert.throws(()=>encodeSettings(r,patch));
});
test('probe reads both exact F1 blocks, version and active status without writes',async()=>{
 const c=scooter({active:1});const s=await readProfiles(c);assert.equal(s.activeProfile,1);assert.equal(s.version,0xaa03);assert.equal(s.writable,true);
 assert.equal(writes(c).length,0);assert.equal(c.log.filter(x=>x[0]==='request').length,2);
});
test('both blocks are written once with F5 then F1 RAM verification',async()=>{
 const c=scooter(),s=await readProfiles(c);
 const result=await writeProfiles(c,s,{sequence:'1 2 4 5 6 7 8',settings:{normal:{low:10,flag4:true},alternate:{high:42,flag800:false}}});
 assert.deepEqual(writes(c).map(x=>[x[2],x[3],x[4].length]),[[0xf2,0,20],[0xf2,1,16]]);
 assert.deepEqual(result.confirmedBlocks,[0,1]);assert.equal(result.persistenceVerified,false);
 assert.deepEqual(c.blocks[1],raw('read-settings-after-write'));assert.deepEqual(result.sequence,[1,2,4,5,6,7,8]);
});
test('an unchanged form emits no F2 and retains original bytes',async()=>{
 const c=scooter(),s=await readProfiles(c);const r=await writeProfiles(c,s,{sequence:s.sequence,settings:s.settings.normal?{normal:s.settings.normal,alternate:s.settings.alternate,autoReturn:true,beep:true}:{}});
 assert.equal(r.changed,false);assert.equal(writes(c).length,0);
});
test('moving, a stock-looking version, foreign snapshot and no authentication behave correctly',async()=>{
 const c=scooter(),s=await readProfiles(c);c.speed=1;await assert.rejects(writeProfiles(c,s,{sequence:'1 2'}),/Stillstand/);assert.equal(writes(c).length,0);
 // The firmware now advertises a stock version (0x162); CFW is detected by the F1 profile protocol, not the version word.
 c.speed=0;c.version=0x162;const stock=await readProfiles(c);assert.equal(stock.version,0x162);assert.equal(stock.writable,true);
 await assert.rejects(writeProfiles(scooter(),s,{sequence:'1 2'}),/dieses Geräts/);
 c.authenticated=false;await assert.rejects(readProfiles(c),/verbinden/);
});
test('stale edits, active-profile changes, session changes and device changes stop before F2',async()=>{
 for(const change of [c=>{c.blocks[0][0]=2;},c=>{c.blocks[1][15]=0;},c=>{c.active=1;},c=>{c.session++;},c=>{c.device={id:'other'};}]){
  const c=scooter(),s=await readProfiles(c);change(c);await assert.rejects(writeProfiles(c,s,{sequence:'1 2'}));assert.equal(writes(c).length,0);
 }
});
test('live read-only limits can change without clobbering them on write',async()=>{
 const c=scooter(),s=await readProfiles(c);c.blocks[1][4]=21;
 await writeProfiles(c,s,{settings:{normal:{low:10}}});assert.equal(c.blocks[1][4],21);assert.equal(c.blocks[1][0],10);
});
test('a missing F5 is checked with F1, never retried as another flash write',async()=>{
 const c=scooter({dropAck:true}),s=await readProfiles(c);const r=await writeProfiles(c,s,{sequence:'1 2'});
 assert.deepEqual(r.missingAcknowledgements,[0]);assert.deepEqual(r.confirmedBlocks,[0]);assert.equal(writes(c).length,1);assert.equal(r.persistenceVerified,false);
});
test('a strict (flag) readback mismatch reports partial results and does not retry or compensate',async()=>{
 const c=scooter(),s=await readProfiles(c);const req=c.request;
 c.request=async(...a)=>{const r=await req(...a);if(a[1]===0xf2&&a[2]===1)c.blocks[1][8]^=1;return r;};
 await assert.rejects(writeProfiles(c,s,{sequence:'1 2',settings:{normal:{high:20,flag4:true}}}),e=>{assert.deepEqual(e.confirmedBlocks,[0]);return /Rücklesen stimmt nicht.*Byte 8/.test(e.message);});
 assert.equal(writes(c).length,2);
});
test('a clamped Sport set-point is advisory, not a write failure',async()=>{
 const c=scooter(),s=await readProfiles(c);const req=c.request;
 c.request=async(...a)=>{const r=await req(...a);if(a[1]===0xf2&&a[2]===1)c.blocks[1][3]=20;return r;};
 const result=await writeProfiles(c,s,{settings:{alternate:{high:30}}});
 assert.deepEqual(result.confirmedBlocks,[1]);
 assert.deepEqual(result.clampedBytes,[{byte:3,profile:'alternate',wanted:30,got:20}]);
});
test('a firmware-rewritten read-only Race byte does not fail a valid Sport write',async()=>{
 const c=scooter(),s=await readProfiles(c);const req=c.request;
 c.request=async(...a)=>{const r=await req(...a);if(a[1]===0xf2&&a[2]===1)c.blocks[1][2]=99;return r;};
 const result=await writeProfiles(c,s,{settings:{alternate:{high:44}}});
 assert.deepEqual(result.confirmedBlocks,[1]);assert.equal(result.settings.alternate.high,44);
});
test('malformed or wrong-board replies and a disappearing connection are rejected',async()=>{
 for(const reply of [{board:0x23,index:0,payload:new Uint8Array(20)},{board:0x16,index:0,payload:new Uint8Array(19)}]){
  const c=scooter();c.request=async()=>reply;await assert.rejects(readProfiles(c));assert.equal(writes(c).length,0);
 }
 const c=scooter(),req=c.request;c.request=async(...a)=>{const r=await req(...a);c.session++;return r;};await assert.rejects(readProfiles(c),/Verbindung/);
});
test('a changed active status retries a snapshot, then fails closed if unstable',async()=>{
 const c=scooter();let count=0;c.read=async(_b,i)=>i===0x17?0xaa03:(count++%2?2:0);
 await assert.rejects(readProfiles(c),/wechselte/);assert.equal(writes(c).length,0);
});
test('whole profile operations serialize, not just individual BLE frames',async()=>{
 const c=scooter();let release;const read=c.read;c.read=async(...a)=>{if(!release)await new Promise(r=>{release=r;});return read(...a);};
 const first=readProfiles(c);await assert.rejects(readProfiles(c),/läuft bereits/);release();await first;
});
