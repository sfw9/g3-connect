import test from 'node:test';
import assert from 'node:assert/strict';
import {Ninebot} from '../dist/ninebot.js';

test('readVcuKey reads registers 32-39 on board 0x16 and assembles the 16-byte key',async()=>{
  const c=new Ninebot();c.authenticated=true;
  const key=Uint8Array.from({length:16},(_,i)=>0x31+i);   // distinct bytes 0x31..0x40
  const calls=[];
  c.read=async(board,index)=>{calls.push([board,index]);const o=(index-32)*2;return key[o]|key[o+1]<<8;};
  const got=await c.readVcuKey();
  assert.deepEqual([...got],[...key]);
  assert.deepEqual(calls,[[0x16,32],[0x16,33],[0x16,34],[0x16,35],[0x16,36],[0x16,37],[0x16,38],[0x16,39]]);
});

test('readVcuKey requires an authenticated session',async()=>{
  const c=new Ninebot();
  await assert.rejects(()=>c.readVcuKey(),/authentifiziert/);
});
