import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeInfo,encodeDistance,encodeRoad,parseCoordinates,makeRoute,locate,maneuver} from '../dist/navigation.js';
import {Ninebot} from '../dist/ninebot.js';
import {hex} from '../dist/crypto.js';
const fixture={code:'Ok',routes:[{duration:100,legs:[{steps:[
 {name:'Startweg',duration:50,maneuver:{type:'depart'},geometry:{coordinates:[[13,52],[13.001,52]]}},
 {name:'Zielstraße',duration:50,maneuver:{type:'turn',modifier:'left'},geometry:{coordinates:[[13.001,52],[13.001,52.001]]}},
 {name:'Zielstraße',duration:0,maneuver:{type:'arrive'},geometry:{coordinates:[[13.001,52.001]]}}
]}]}]};
test('navigation info matches the independently published 18-byte reference vector',()=>{
 // NinebotEnhance NaviTestTests: 2440 m / 305 s / left / 440 m / 3 lights / GPS 1.
 // We do not know real traffic-light counts, so our field is explicitly zero.
 assert.equal(hex(encodeInfo({remaining:2440,seconds:305,icon:2,stepRemaining:440,gps:1})),'88090000310100000200b801000000000100');
 assert.equal(hex(encodeDistance(3000)),'b80b0000');
 assert.throws(()=>encodeDistance(NaN));assert.throws(()=>encodeInfo({remaining:1,seconds:1,icon:-1,stepRemaining:1}));
});
test('road names are bounded UTF-8, NUL terminated, without splitting multibyte characters',()=>{
 const b=encodeRoad('ä'.repeat(30)+'\0end');assert.equal(b.length,39);assert.equal(b.at(-1),0);
 assert.equal(new TextDecoder('utf-8',{fatal:true}).decode(b.slice(0,-1)),'ä'.repeat(19));
 assert.equal(new TextDecoder().decode(encodeRoad('A\0B')),'AB\0');
});
test('coordinate input is latitude,longitude; external routing uses longitude,latitude',()=>{
 assert.deepEqual(parseCoordinates('52.52, 13.40'),[13.4,52.52]);assert.equal(parseCoordinates('Berlin'),null);
 assert.throws(()=>parseCoordinates('100, 13'));
});
test('route tracker shows upcoming left turn, then arrival approach, and only announces arrival at destination',()=>{
 const r=makeRoute(fixture);assert.equal(r.segments.length,2);
 const a=locate(r,[13.0005,52]);assert.equal(a.icon,2);assert.ok(a.stepRemaining>20);assert.equal(a.nextRoad,'Zielstraße');
 const b=locate(r,[13.001,52.0005],a.progress);assert.equal(b.icon,9);assert.equal(b.arrived,false);assert.ok(b.remaining>40);
 const c=locate(r,[13.001,52.001],b.progress);assert.equal(c.icon,15);assert.equal(c.arrived,true);
});
test('GPS jitter cannot rewind route progress; an off-route fix remains identifiable',()=>{
 const r=makeRoute(fixture),a=locate(r,[13.0006,52]);
 const b=locate(r,[13.0005,52],a.progress);assert.equal(b.progress,a.progress);
 assert.ok(locate(r,[13.01,52.01],a.progress).offset>45);
});
test('loop tracking does not jump to a later lap outside its progress window',()=>{
 const r={segments:[{a:[13,52],b:[13.001,52],start:0,length:70},{a:[13,52],b:[13.001,52],start:1000,length:70}],
 instructions:[{at:0,name:'A',maneuver:{}},{at:1070,name:'B',maneuver:{type:'arrive'}}],points:[[13,52],[13.001,52]],length:1070,duration:200};
 assert.ok(locate(r,[13.0005,52],0).progress<100);
});
test('missing, invalid and unsuitable routing responses are rejected',()=>{
 assert.throws(()=>makeRoute({code:'NoRoute'}));
 const bad=structuredClone(fixture);bad.routes[0].legs[0].steps[0].geometry.coordinates[0]=[200,100];assert.throws(()=>makeRoute(bad));
 assert.equal(maneuver({modifier:'uturn'}).icon,8);assert.equal(maneuver({type:'arrive'}).icon,15);
});
test('navigation writes only known display fields to TFT, never VCU, and omits unsupported drive info',async()=>{
 const c=new Ninebot();c.authenticated=true;c.navigationStarted=true;const writes=[];
 c.sendUnacknowledged=async(b,cmd,i,data)=>writes.push([b,cmd,i,Array.from(data)]);
 const state={remaining:300,seconds:60,icon:2,stepRemaining:100,gps:1,currentRoad:'A',nextRoad:'B'};
 await c.updateNavigation(state,{total:300,initial:true});
 assert.deepEqual(writes.map(p=>p.slice(0,3)),[[0x23,0x71,1],[0x23,0x71,0x10],[0x23,0x71,0x24],[0x23,0x71,3]]);
 assert.equal(writes[3][3].length,18);writes.length=0;
 await c.updateNavigation(state,{total:300});assert.deepEqual(writes.map(p=>p[2]),[3]);
 c.request=async(...args)=>{assert.deepEqual(args,[0x23,0x71,0,[0],0x71,0,4000]);return {payload:[]};};
 await c.stopNavigation();assert.equal(c.navigationStarted,false);assert.deepEqual(writes.map(p=>p[2]),[3]);
});
test('display start requires stationary authenticated scooter and exact command response; timeout stops before updates',async()=>{
 const c=new Ninebot();await assert.rejects(c.startNavigation(),/verbinden/);
 c.authenticated=true;c.read=async()=>1;c.request=async()=>assert.fail('must not send');await assert.rejects(c.startNavigation(),/Stillstand/);
 c.read=async()=>0;c.request=async(board,cmd,index,payload,reply,match)=>{
  assert.deepEqual([board,cmd,index,reply,match],[0x23,0x71,0,0x71,0]);assert.deepEqual(payload,[1]);throw new Error('Keine Antwort');
 };
 await assert.rejects(c.startNavigation(),/Keine Antwort/);assert.equal(c.navigationStarted,undefined);
 await assert.rejects(c.updateNavigation({}),/nicht gestartet/);
});
