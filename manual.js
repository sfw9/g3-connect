// Freely chosen test values for the TFT navigation view (Android: ManualSender). Only TFT packets
// (0x23 / 0x71) are sent; no VCU or motor registers are touched.
export const DIRECTIONS=[[9,'Geradeaus'],[2,'Links'],[3,'Rechts'],[4,'Leicht links'],[5,'Leicht rechts'],[6,'Scharf links'],[7,'Scharf rechts'],[8,'Wenden'],[11,'Kreisverkehr rechts'],[12,'Kreisverkehr links'],[15,'Ziel erreicht']];
const STORE='g3-manual';
const FIELDS=['man-sweep-mode','man-sweep-seconds','man-direction','man-icon','man-next-road','man-current-road','man-step','man-remaining','man-total','man-minutes','man-duration','man-approach'];
const CHECKS=['man-gps','man-countdown'];
const DEFAULTS={'man-sweep-mode':'known','man-sweep-seconds':'3','man-direction':'2','man-icon':'2','man-next-road':'TESTSTRASSE','man-current-road':'','man-step':'100','man-remaining':'1.2','man-total':'','man-minutes':'5','man-duration':'0','man-approach':'0','man-gps':true,'man-countdown':false};

function integer(value,max,field){
  const text=String(value??'').trim();
  if(!/^\d{1,10}$/.test(text)||Number(text)>max)throw new Error(`${field}: ganze Zahl von 0 bis ${max.toLocaleString('de-DE')} eingeben.`);
  return Number(text);
}
function decimal(value,factor,max,field){
  const text=String(value??'').trim().replace(',','.');
  if(!/^\d+(\.\d{1,3})?$/.test(text))throw new Error(`${field}: Zahl ≥ 0 eingeben (bis zu 3 Nachkommastellen).`);
  const n=Math.round(Number(text)*factor);if(n>max)throw new Error(`${field}: Wert zu groß.`);return n;
}
/** Form values (strings/booleans keyed by element id) → validated config. Throws a German message. */
export function parseManual(v,repeat){
  const icon=v['man-direction']==='custom'?integer(v['man-icon'],0xffff,'Symbolcode'):integer(v['man-direction'],0xffff,'Richtung');
  const remaining=decimal(v['man-remaining'],1000,0x7fffffff,'Reststrecke');
  const total=String(v['man-total']??'').trim()===''?remaining:decimal(v['man-total'],1000,0x7fffffff,'Gesamtstrecke');
  return {
    icon,remaining,total,
    step:integer(v['man-step'],0x7fffffff,'Abbiegedistanz'),
    seconds:decimal(v['man-minutes'],60,0x7fffffff,'Restfahrzeit'),
    duration:integer(v['man-duration'],86400,'Sendedauer'),
    approach:integer(v['man-approach'],10000,'Annäherung'),
    nextRoad:String(v['man-next-road']??'').replaceAll('\0','').trim(),
    currentRoad:String(v['man-current-road']??'').replaceAll('\0','').trim(),
    gps:v['man-gps']?1:0,countdown:!!v['man-countdown'],repeat:!!repeat
  };
}
/** Sweep through every direction (or every icon code 0–31), `per` seconds each; the road shows what is being tested. */
export function sweepConfig(base,mode,per){
  const seconds=integer(per,60,'Sekunden pro Schritt');if(seconds<1)throw new Error('Sekunden pro Schritt: mindestens 1.');
  const names=new Map(DIRECTIONS);
  const items=mode==='codes'?Array.from({length:32},(_,i)=>[i,names.get(i)||'unbekannt']):DIRECTIONS;
  return {...base,repeat:true,countdown:false,approach:0,duration:items.length*seconds,sweep:{items,per:seconds}};
}
export function sweepStep(c,elapsed){
  const i=Math.min(c.sweep.items.length-1,Math.floor(Math.max(0,elapsed)/1000/c.sweep.per)),[icon,label]=c.sweep.items[i];
  return {index:i,icon,label,road:`${i+1}/${c.sweep.items.length} ${label}`.toUpperCase()};
}
/** Display state after `elapsed` ms of sending; `done` once the send duration has run out. */
export function manualState(c,elapsed){
  const t=Math.floor(Math.max(0,elapsed)/1000),moved=c.approach*t,step=c.sweep?sweepStep(c,elapsed):null;
  return {
    done:c.duration>0&&elapsed>=c.duration*1000,step,
    state:{icon:step?step.icon:c.icon,stepRemaining:Math.max(0,c.step-moved),remaining:Math.max(0,c.remaining-moved),seconds:c.countdown?Math.max(0,c.seconds-t):c.seconds,gps:c.gps,currentRoad:c.currentRoad,nextRoad:step?step.road:c.nextRoad,offset:0}
  };
}

export function installManualSender({getClient,isBusy,setBusy,log,beforeStart=async()=>{}}){
  const $=id=>document.getElementById(id);
  let config=null,started=0,timer=null,sends=0,sending=false,device=null,lastStep=-1;
  const say=text=>{$('man-status').textContent=text;};
  const active=()=>!!config;
  const values=()=>{const v={};for(const id of FIELDS)v[id]=$(id).value;for(const id of CHECKS)v[id]=!!$(id).checked;return v;};
  try{const saved=JSON.parse(localStorage.getItem(STORE)||'null')||{};for(const [id,value]of Object.entries({...DEFAULTS,...saved})){const el=$(id);if(!el)continue;if(CHECKS.includes(id))el.checked=!!value;else el.value=String(value);}}
  catch{for(const [id,value]of Object.entries(DEFAULTS)){const el=$(id);if(el){if(CHECKS.includes(id))el.checked=value;else el.value=value;}}}
  const customVisible=()=>{$('man-icon-field').hidden=$('man-direction').value!=='custom';};
  function update(){
    const c=getClient(),online=!!c?.authenticated,locked=isBusy()&&!sending;
    if(config&&(!online||c.device?.id!==device)){release();say('Verbindung getrennt. Senden beendet.');}
    $('man-once').disabled=!online||locked;$('man-repeat').disabled=!online||locked;
    $('man-stop').disabled=!config&&!(online&&c?.navigationStarted&&!locked);
    $('man-once').textContent=config&&!config.repeat?'Neue Werte senden':'Einmal senden';
    $('man-repeat').textContent=config?.repeat&&!config.sweep?'Werte übernehmen':'Dauersenden';
    $('man-sweep').disabled=!online||locked||!!config?.sweep;
  }
  function release(){config=null;device=null;clearInterval(timer);timer=null;}
  function describe(s){return `Symbol ${s.icon} · ${s.stepRemaining} m · ${(s.remaining/1000).toLocaleString('de-DE',{maximumFractionDigits:3})} km · ${Math.ceil(s.seconds/60)} min`;}
  async function send(){
    if(!config||sending||isBusy())return;
    const c=getClient(),elapsed=Date.now()-started,{done,state,step}=manualState(config,elapsed);
    if(done){await stop(config.sweep?`Richtungstest fertig: ${config.sweep.items.length} Symbole gezeigt. Display-Navigation beendet.`:`Sendedauer von ${config.duration} s abgelaufen. Display-Navigation beendet.`);return;}
    if(step&&step.index!==lastStep){lastStep=step.index;sends=0;log(`Richtungstest ${step.index+1}/${config.sweep.items.length}: Symbol ${step.icon} (${step.label}).`);}
    if(!c?.navigationStarted){release();say('Display-Navigation wurde beendet. Senden gestoppt.');update();return;}
    sending=true;setBusy(true);
    try{
      // The first sends repeat the complete record so a display that is still opening its view gets every field.
      await c.updateNavigation(state,{total:config.total,initial:sends<3});sends++;
      const rest=config.duration?` · noch ${Math.max(0,config.duration-Math.floor(elapsed/1000))} s`:' · bis Stopp';
      say(step?`Richtungstest ${step.index+1}/${config.sweep.items.length}: Symbol ${step.icon} · ${step.label}${rest}`:`${config.repeat?'Dauersenden':'Gesendet'}: ${describe(state)}${rest}`);
    }catch(e){release();say(`Senden fehlgeschlagen: ${e.message}`);log(`Testwerte: ${e.message}`,'ERROR');}
    finally{sending=false;setBusy(false);}
  }
  async function start(repeat,sweep=false){
    const c=getClient();if(!c?.authenticated||(isBusy()&&!sending))return;
    let next;try{next=parseManual(values(),repeat);if(sweep)next=sweepConfig(next,$('man-sweep-mode').value,$('man-sweep-seconds').value);}catch(e){say(e.message);return;}
    try{localStorage.setItem(STORE,JSON.stringify(values()));}catch{}
    if(config&&device===c.device?.id){
      // Already sending: take the new values and resend the full record.
      clearInterval(timer);timer=null;config=next;started=Date.now();sends=0;lastStep=-1;log(sweep?'Richtungstest gestartet.':'Testwerte geändert.');
    }else{
      await beforeStart();
      if(!c.navigationStarted){
        say('Display-Navigation starten … (nur im Stillstand)');setBusy(true);
        try{await c.startNavigation();}catch(e){say(e.message);log(`Testwerte: ${e.message}`,'ERROR');return;}finally{setBusy(false);}
      }
      config=next;device=c.device.id;started=Date.now();sends=0;lastStep=-1;
      if(sweep)log(`Richtungstest: ${next.sweep.items.length} Symbole, je ${next.sweep.per} s.`);
      else log(`Testwerte: ${repeat?'Dauersenden':'einmal senden'}, Symbol ${next.icon}, Sendedauer ${next.duration||'bis Stopp'}${next.duration?' s':''}.`);
    }
    await send();
    if(config&&(config.repeat||config.duration))timer=setInterval(()=>void(config?.repeat?send():manualState(config,Date.now()-started).done&&stop(`Sendedauer von ${config.duration} s abgelaufen. Display-Navigation beendet.`)),1000);
    update();
  }
  async function stop(message='Senden gestoppt. Display-Navigation beendet.'){
    release();const c=getClient();
    if(c?.navigationStarted){setBusy(true);try{await c.stopNavigation();}catch(e){message+=` Ende nicht bestätigt: ${e.message}`;log(`Testwerte: ${e.message}`,'ERROR');}finally{setBusy(false);}}
    say(message);update();
  }
  $('man-direction').addEventListener('change',customVisible);customVisible();
  $('man-once').addEventListener('click',()=>void start(false));
  $('man-repeat').addEventListener('click',()=>void start(true));
  $('man-stop').addEventListener('click',()=>void stop());
  $('man-sweep').addEventListener('click',()=>void start(true,true));
  window.addEventListener('pagehide',release);
  update();
  return {update,stop,active};
}
