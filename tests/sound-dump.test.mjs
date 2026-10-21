import test from 'node:test';
import assert from 'node:assert/strict';
import {analyse,dumpSounds,makeZip,crc32} from '../dist/sound-dump.js';

const RATE=8000;
const clip=(tone,noise=0.002)=>{const a=new Float32Array(RATE*1.3);for(let i=0;i<a.length;i++)a[i]=(i%2?noise:-noise)+(tone&&i>RATE*0.5&&i<RATE?0.3*Math.sin(i/3):0);return a;};

test('analyse: a tone well above the background is heard, background noise alone is not',()=>{
 const tone=analyse(clip(true),RATE);assert.equal(tone.heard,true);assert.equal(tone.sound.length,clip(true).length-RATE*0.3,'lead is cut off');
 assert.equal(analyse(clip(false),RATE).heard,false);
 assert.equal(analyse(clip(false,0.2),RATE).heard,false,'loud but constant background is not a tone');
});

test('dumper plays each number once, records around it and only writes playSound through play()',async()=>{
 const played=[],items=[];let recording=false;
 const mic={rate:RATE,start(){assert.equal(recording,false);recording=true;},stop(){recording=false;return clip(played.at(-1)===7);}};
 await dumpSounds({numbers:[5,6,7],mic,seconds:1,sleep:async()=>{},play:async n=>{assert.equal(recording,true,'recording runs before playSound');played.push(n);},onItem:r=>items.push(r)});
 assert.deepEqual(played,[5,6,7]);assert.deepEqual(items.map(r=>[r.number,r.heard,r.index,r.total]),[[5,false,0,3],[6,false,1,3],[7,true,2,3]]);
 const c=new AbortController();c.abort();
 await assert.rejects(dumpSounds({numbers:[1],mic,signal:c.signal,sleep:async()=>{},play:async()=>assert.fail()}),/abgebrochen/);
 await assert.rejects(dumpSounds({numbers:[1],mic,sleep:async()=>{},play:async()=>{throw new Error('Verbindung getrennt.');}}),/getrennt/);
 assert.equal(recording,false,'recording stopped after a failed playSound');
});

test('ZIP: stored entries with correct CRC, sizes and central directory',()=>{
 assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
 const a=Uint8Array.of(1,2,3),b=new Uint8Array(1000).fill(7),zip=makeZip([{name:'a.wav',data:a},{name:'b.wav',data:b}]),v=new DataView(zip.buffer);
 assert.equal(v.getUint32(0,true),0x04034b50);assert.equal(v.getUint32(14,true),crc32(a));assert.equal(v.getUint32(18,true),3);
 const end=zip.length-22;assert.equal(v.getUint32(end,true),0x06054b50);assert.equal(v.getUint16(end+10,true),2);
 const dir=v.getUint32(end+16,true);assert.equal(v.getUint32(dir,true),0x02014b50);assert.equal(dir,30+5+3+30+5+1000);
 const second=v.getUint32(dir+46+5+42,true);assert.equal(v.getUint32(second,true),0x04034b50);assert.equal(v.getUint32(second+18,true),1000);
});
