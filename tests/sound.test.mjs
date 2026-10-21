import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeWav,buildPayload,checksum,beginData,parseBegin,planChunks,uploadSound,CHUNK} from '../dist/sound.js';

const silence=()=>buildPayload(encodeWav(new Float32Array(8000)));
const hex=a=>[...a].map(b=>b.toString(16).padStart(2,'0')).join(' ');

test('one second of silence reproduces the reference example from the analysis',()=>{
 const wav=encodeWav(new Float32Array(8000)),p=buildPayload(wav);
 assert.equal(wav.length,16044);assert.equal(p.length,16056);
 assert.equal(hex(p.subarray(0,32)),'0c 00 00 00 b8 3e 00 00 40 1f 10 01 52 49 46 46 a4 3e 00 00 57 41 56 45 66 6d 74 20 10 00 00 00');
 assert.equal(hex(beginData(p.length)),'b8 3e 00 00 01');
 assert.equal(checksum(p),0xfffff651);
 assert.equal(createHash('sha256').update(p).digest('hex'),'6a4feafdd95a073eda173fa262ace670fcc14d69e5fb0277f8ac195f64aa098c');
 assert.deepEqual(planChunks(p.length),{count:126,lastLength:56});
 assert.equal((checksum(p)+p.reduce((a,b)=>a+b,0))%2**32,0xffffffff);
});

test('begin reply: legacy, extended, 5000 ms compatibility case and default',()=>{
 assert.deepEqual(parseBegin([0x40,0,0,0]),{format:'legacy',protocol:0,group:64,last:-1,wait:0});
 assert.equal(parseBegin([0x40,0,0x88,0x13]).wait,0,'5000 ms becomes 0');
 assert.equal(parseBegin([0x40,0,20,0]).wait,20);
 assert.deepEqual(parseBegin([1,32,0,69,0,0,0,5,0,0,0]),{format:'extended',protocol:1,group:32,last:69,wait:5});
 assert.deepEqual(parseBegin([]),{format:'default',protocol:0,group:8,last:-1,wait:0});
});

function scooter({begin=[0x40,0,0,0],beginStatus=0,ackStatus=()=>0,finishStatus=0,speed=0,dropAcks=0}={}){
 const log=[];let drops=dropAcks;
 return {log,
  async read(board,index){log.push(['read',board,index]);return index===0x57?speed:0;},
  async sendUnacknowledged(board,cmd,index,data){log.push(['tx',cmd,index,data.length]);},
  async request(board,cmd,index,data,expect,match){
   log.push(['req',cmd,index,cmd===0x77?data.length:hex(data)]);assert.equal(board,0x16);assert.equal(expect,cmd);assert.equal(match,null,'any status is accepted and evaluated');
   if(cmd===0x76)return {index:beginStatus,payload:Uint8Array.from(begin)};
   if(cmd===0x77){if(drops-->0)throw new Error('Keine Antwort auf Befehl 0x77, Register 0x3f.');return {index:ackStatus(index),payload:new Uint8Array()};}
   return {index:finishStatus,payload:new Uint8Array()};
  }};
}
const quick={begin:1,ack:1,finish:1};

test('upload sends begin, 126 chunks in groups of 64 and the checksum with index 0',async()=>{
 const s=scooter(),progress=[];
 const r=await uploadSound(s,{slot:5,payload:silence(),onProgress:(n,c)=>progress.push(n),timeouts:quick});
 assert.deepEqual(s.log[0],['read',0x16,0x57]);
 assert.deepEqual(s.log[1],['req',0x76,5,'b8 3e 00 00 01']);
 const data=s.log.filter(e=>e[1]===0x77);assert.equal(data.length,126);
 assert.deepEqual(data.filter(e=>e[0]==='req').map(e=>e[2]),[63,61],'only the last packet of each group waits for a reply');
 assert.deepEqual(data.slice(0,64).map(e=>e[2]),[...Array(64).keys()]);assert.deepEqual(data.slice(64).map(e=>e[2]),[...Array(62).keys()]);
 assert.equal(data.at(-1)[3],56,'last chunk is not padded');assert.ok(data.slice(0,-1).every(e=>e[3]===CHUNK));
 assert.deepEqual(s.log.at(-1),['req',0x78,0,'51 f6 ff ff']);
 assert.equal(progress.at(-1),126);assert.equal(r.checksum,0xfffff651);
});

test('extended reply with protocol 1 resumes after the last stored packet',async()=>{
 const s=scooter({begin:[1,64,0,69,0,0,0,0,0,0,0]});
 await uploadSound(s,{slot:5,payload:silence(),timeouts:quick});
 const data=s.log.filter(e=>e[1]===0x77);assert.equal(data.length,126-70);assert.equal(data[0][2],6,'packet 70 is index 6 of group 1');
});

test('refusals and error statuses stop the upload without sending further data',async()=>{
 await assert.rejects(uploadSound(scooter({speed:3}),{slot:1,payload:silence(),timeouts:quick}),/Stillstand/);
 const refused=scooter({beginStatus:1});
 await assert.rejects(uploadSound(refused,{slot:1,payload:silence(),timeouts:quick}),/lehnt den Upload ab: Status 1/);
 assert.equal(refused.log.filter(e=>e[1]===0x77).length,0);
 const indexError=scooter({ackStatus:i=>i===63?2:0});
 await assert.rejects(uploadSound(indexError,{slot:1,payload:silence(),timeouts:quick}),/Paket 64\/126 abgebrochen: Status 2 \(Indexfehler\)/);
 assert.equal(indexError.log.some(e=>e[1]===0x78),false,'no checksum after a failed group');
 await assert.rejects(uploadSound(scooter({finishStatus:3}),{slot:1,payload:silence(),timeouts:quick}),/Status 3 \(Speichern fehlgeschlagen\)/);
 for(const slot of [-1,256,1.5,undefined])await assert.rejects(uploadSound(scooter(),{slot,payload:silence()}),/Slot/);
});

test('a missing group reply is retried up to five times, then the upload fails',async()=>{
 const ok=scooter({dropAcks:2});await uploadSound(ok,{slot:1,payload:silence(),timeouts:quick});
 assert.equal(ok.log.filter(e=>e[0]==='req'&&e[1]===0x77).length,4);
 await assert.rejects(uploadSound(scooter({dropAcks:6}),{slot:1,payload:silence(),timeouts:quick}),/Keine Antwort/);
});

test('cancel stops before the next chunk',async()=>{
 const c=new AbortController(),s=scooter();
 await assert.rejects(uploadSound(s,{slot:1,payload:silence(),signal:c.signal,onProgress:n=>{if(n===10)c.abort();},timeouts:quick}),/abgebrochen/);
 assert.equal(s.log.filter(e=>e[1]===0x77).length,10);assert.equal(s.log.some(e=>e[1]===0x78),false);
});
