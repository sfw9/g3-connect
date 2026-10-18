import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseManual,sweepConfig,manualState,installManualSender,DIRECTIONS} from '../dist/manual.js';

const form={'man-direction':'3','man-icon':'','man-next-road':' Teststraße ','man-current-road':'','man-step':'250','man-remaining':'1,5','man-total':'','man-minutes':'4','man-duration':'0','man-approach':'0','man-gps':true,'man-countdown':false};

test('test values are validated and converted to display units',()=>{
 const c=parseManual(form,true);
 assert.deepEqual({icon:c.icon,step:c.step,remaining:c.remaining,total:c.total,seconds:c.seconds,gps:c.gps,nextRoad:c.nextRoad,repeat:c.repeat},{icon:3,step:250,remaining:1500,total:1500,seconds:240,gps:1,nextRoad:'Teststraße',repeat:true});
 assert.equal(parseManual({...form,'man-direction':'custom','man-icon':'4711'}).icon,4711,'any icon code can be sent');
 assert.equal(parseManual({...form,'man-total':'9'}).total,9000);
 for(const bad of [{'man-step':'-1'},{'man-step':'abc'},{'man-remaining':'1.2345'},{'man-direction':'custom','man-icon':'70000'},{'man-duration':'90000'}])
  assert.throws(()=>parseManual({...form,...bad}),/eingeben|groß/,JSON.stringify(bad));
});

test('countdown and approach change the values every second',()=>{
 const c=parseManual({...form,'man-countdown':true,'man-approach':'10','man-duration':'5'},true);
 const s=manualState(c,3500).state;assert.equal(s.stepRemaining,220);assert.equal(s.remaining,1470);assert.equal(s.seconds,237);
 assert.equal(manualState(c,4999).done,false);assert.equal(manualState(c,5000).done,true);
 assert.equal(manualState(parseManual({...form,'man-approach':'1000'},true),9000).state.stepRemaining,0,'never negative');
});

test('direction sweep covers every known direction or all codes 0–31',()=>{
 const known=sweepConfig(parseManual(form,false),'known','2');
 assert.equal(known.repeat,true);assert.equal(known.duration,DIRECTIONS.length*2);
 assert.deepEqual(DIRECTIONS.map((_,i)=>manualState(known,i*2000+500).state.icon),DIRECTIONS.map(d=>d[0]));
 assert.equal(manualState(known,2500).state.nextRoad,'2/11 LINKS');
 const codes=sweepConfig(parseManual(form,false),'codes','1');
 assert.equal(codes.sweep.items.length,32);assert.equal(manualState(codes,31500).state.icon,31);
 assert.throws(()=>sweepConfig(parseManual(form,false),'known','0'),/mindestens 1/);
});

class Element extends EventTarget{constructor(){super();this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.textContent='';}}
async function harness(t){
 t.mock.timers.enable({apis:['Date','setInterval']});
 const ids=[...(await readFile(new URL('../dist/index.html',import.meta.url),'utf8')).matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 const nodes=new Map(ids.map(id=>[id,new Element()])),store=new Map();
 const old={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage};
 globalThis.document={getElementById:id=>nodes.get(id)};globalThis.window=new EventTarget();
 globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 t.after(()=>{Object.assign(globalThis,old);t.mock.timers.reset();});
 const calls=[],client={authenticated:true,device:{id:'d'},navigationStarted:false,
  async startNavigation(){calls.push(['start']);this.navigationStarted=true;},
  async updateNavigation(state,o){calls.push(['data',state,o]);},
  async stopNavigation(){calls.push(['stop']);this.navigationStarted=false;}};
 let busy=false;const logs=[];
 const ui=installManualSender({getClient:()=>client,isBusy:()=>busy,setBusy:v=>{busy=v;},log:s=>logs.push(s)});
 const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
 const click=async id=>{nodes.get(id).dispatchEvent(new Event('click'));await flush();};
 const tick=async ms=>{t.mock.timers.tick(ms);await flush();};
 return {nodes,store,calls,client,ui,click,tick,logs};
}

test('continuous sending starts the display once, repeats every second and can change values',async t=>{
 const {nodes,store,calls,ui,click,tick}=await harness(t);
 assert.equal(nodes.get('man-step').value,'100','defaults are filled in');
 nodes.get('man-step').value='300';
 await click('man-repeat');
 assert.deepEqual(calls.map(c=>c[0]),['start','data']);assert.equal(calls[1][1].stepRemaining,300);assert.equal(calls[1][2].initial,true);
 assert.equal(ui.active(),true);assert.ok(store.has('g3-manual'),'values are remembered');
 for(let i=0;i<3;i++)await tick(1000);assert.equal(calls.filter(c=>c[0]==='data').length,4);assert.equal(calls.at(-1)[2].initial,false,'later sends are incremental');
 nodes.get('man-step').value='50';await click('man-repeat');
 assert.equal(calls.filter(c=>c[0]==='start').length,1,'changing values does not restart the display');
 assert.equal(calls.at(-1)[1].stepRemaining,50);assert.equal(calls.at(-1)[2].initial,true);
 await click('man-stop');assert.equal(calls.at(-1)[0],'stop');assert.equal(ui.active(),false);
 const n=calls.length;await tick(5000);assert.equal(calls.length,n,'nothing is sent after stop');
});

test('"Alle Richtungen testen" shows every direction in order and then ends the display navigation',async t=>{
 const {nodes,calls,click,tick,logs}=await harness(t);
 nodes.get('man-sweep-seconds').value='2';
 await click('man-sweep');
 for(let i=0;i<DIRECTIONS.length*2+1;i++)await tick(1000);
 const shown=[...new Set(calls.filter(c=>c[0]==='data').map(c=>c[1].icon))];
 assert.deepEqual(shown,DIRECTIONS.map(d=>d[0]));
 assert.equal(calls.at(-1)[0],'stop');assert.match(nodes.get('man-status').textContent,/Richtungstest fertig/);
 assert.ok(logs.some(s=>s.includes('Richtungstest 3/11: Symbol 3 (Rechts)')));
});

test('a refused display start sends no data',async t=>{
 const {calls,client,ui,click,nodes}=await harness(t);
 client.startNavigation=async()=>{throw new Error('Navigation im Stillstand starten.');};
 await click('man-repeat');
 assert.equal(calls.length,0);assert.equal(ui.active(),false);assert.match(nodes.get('man-status').textContent,/Stillstand/);
});
