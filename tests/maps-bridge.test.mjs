import test from 'node:test';
import assert from 'node:assert/strict';
import {mapsGuidance,createMapsBridge} from '../dist/maps-bridge.js';
const good={version:1,listenerReady:true,guidance:{active:true,complete:true,remaining:1200,seconds:400,stepRemaining:100,icon:2,confidence:0.99,road:'Teststraße',title:'100 m'}};
test('Google Maps bridge accepts only complete, confident, typed guidance',()=>{
 const v=mapsGuidance(good);assert.equal(v.ok,true);assert.equal(v.state.icon,2);assert.equal(v.state.nextRoad,'Teststraße');
 for(const patch of [{remaining:null},{seconds:null},{stepRemaining:-1},{remaining:20},{icon:-1},{icon:999},{complete:'true'},{confidence:0.8},{confidence:NaN},{confidence:2}]){
  assert.equal(mapsGuidance({...good,guidance:{...good.guidance,...patch}}).ok,false,JSON.stringify(patch));
 }
 assert.equal(mapsGuidance({...good,listenerReady:false}).ok,false);
 assert.equal(mapsGuidance({...good,guidance:{active:false}}).ok,false);
});
test('bridge token is stripped from fragment; a stopped request cannot repopulate state',async()=>{
 const previous={window:globalThis.window,history:globalThis.history,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 const seen=[],stored=new Map();let replaced,finish;
 globalThis.window={location:{hash:'#maps_bridge='+('a'.repeat(43)),pathname:'/',search:''}};
 globalThis.history={replaceState(_a,_b,url){replaced=url;}};
 globalThis.sessionStorage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)};
 globalThis.fetch=async(_url,options)=>{assert.equal(options.targetAddressSpace,'loopback');assert.equal(options.headers['X-G3-Token'],'a'.repeat(43));return new Promise(r=>{finish=r;});};
 try{
  const bridge=createMapsBridge(v=>seen.push(v));assert.equal(bridge.available(),true);assert.equal(replaced,'/');
  bridge.start();bridge.stop();finish({ok:true,json:async()=>good});await new Promise(r=>setImmediate(r));
  assert.deepEqual(seen,[]);assert.equal(bridge.latest(),null);assert.equal(bridge.connected(),false);
 }finally{Object.assign(globalThis,previous);}
});
