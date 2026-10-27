import {readProfiles,writeProfiles,PROFILE_EVENTS,profileHex} from './profiles.js?v=1';

export function installProfilesUI({getClient,isBusy,setBusy,log,writable}){
 const $=id=>document.getElementById(id);let current=null,owner=null,dirty=false;
 const say=t=>{$('profiles-status').textContent=t;};
 const same=()=>current&&getClient()?.authenticated&&owner?.client===getClient()&&owner?.session===getClient()?.session&&owner?.device===getClient()?.device?.id;
 const ready=()=>!!getClient()?.authenticated&&writable()&&!isBusy();
 const ids=['normal-high','normal-flag4','normal-flag800','normal-cruise','alternate-high','alternate-flag4','alternate-flag800','alternate-cruise','return','beep'];
 // Unlock sequence as a tap-to-build button list instead of raw numbers. Labels come from PROFILE_EVENTS (LC-dashboard names).
 const EVENT_NAME=new Map(PROFILE_EVENTS.map(([id,,name])=>[id,name||('#'+id)]));
 const canEdit=()=>!!current&&same()&&current.writable&&!isBusy();
 const seqArr=()=>{const v=$('profiles-sequence').value.trim();return v?v.split(/[\s,;]+/).filter(Boolean).map(Number):[];};
 function renderSeq(){
  const arr=seqArr(),box=$('profiles-sequence-chips');box.replaceChildren();
  if(!arr.length){const e=document.createElement('span');e.className='seq-empty';e.textContent='Noch keine Schritte – Bedienelemente unten antippen.';box.appendChild(e);}
  arr.forEach((n,i)=>{
   const b=document.createElement('button');b.setAttribute('type','button');b.className='seq-chip';
   b.textContent=`${i+1}. ${EVENT_NAME.get(n)||('#'+n)} ✕`;b.setAttribute('aria-label',`Schritt ${i+1} ${EVENT_NAME.get(n)||n} entfernen`);
   b.addEventListener('click',()=>{if(!canEdit())return;const a=seqArr();a.splice(i,1);commitSeq(a);});
   box.appendChild(b);
  });
  $('profiles-sequence-count').textContent=`${arr.length}/19`;
 }
 function commitSeq(arr){$('profiles-sequence').value=arr.join(' ');renderSeq();dirty=true;update();}
 function clear(){current=null;owner=null;dirty=false;$('profiles-active').textContent='—';$('profiles-version').textContent='—';$('profiles-raw').textContent='';$('profiles-sequence').value='';renderSeq();}
 function update(){
  if(current&&!same()){clear();say('Verbindung oder Gerät gewechselt. Profile erneut auslesen.');}
  $('profiles-read').disabled=!ready();
  const edit=ready()&&same()&&current.writable;
  $('profiles-fields').disabled=!edit;$('profiles-save').disabled=!edit||!dirty;
  $('profiles-defaults').disabled=!edit;$('profiles-export').disabled=!same();
 }
 function show(snapshot){
  current=snapshot;const c=getClient();owner={client:c,session:c.session,device:c.device?.id};dirty=false;
  $('profiles-sequence').value=snapshot.sequence.join(' ');renderSeq();
  for(const name of ['normal','alternate']){
   // The G3 has no race mode: byte 0/2 (low/Race) is read-only and written back unchanged; only byte 1/3 (high/Sport) is editable.
   const p=snapshot.settings[name],limit=snapshot.settings.limits[name==='normal'?0:1];
   $(`profiles-${name}-high`).value=String(p.high);$(`profiles-${name}-high`).max=String(limit.high);
   for(const field of ['flag4','flag800','cruise'])$(`profiles-${name}-${field}`).checked=p[field];
  }
  $('profiles-return').checked=snapshot.settings.autoReturn;$('profiles-beep').checked=snapshot.settings.beep;
  $('profiles-active').textContent=snapshot.activeProfile?'Alternativprofil':'Normalprofil';
  $('profiles-version').textContent='0x'+snapshot.version.toString(16).padStart(4,'0');
  const [a,b]=snapshot.settings.limits;
  $('profiles-limits').textContent=`VCU-Sport-Obergrenzen: Normal ${a.high} km/h, Tuning ${b.high} km/h. Mindestens 15 km/h. Byte 0/2 (Race) wird nur gelesen.`;
  $('profiles-raw').textContent=`Block 0 (20 B): ${profileHex(snapshot.rawSequence)}\nBlock 1 (16 B): ${profileHex(snapshot.rawSettings)}`;
  say('Beide Profilblöcke gelesen. Änderungen erst mit „Schreiben + prüfen“ übertragen.');update();
 }
 async function action(fn){if(!ready())return;setBusy(true);try{await fn();}catch(e){
  const partial=e.confirmedBlocks?.length?` Bereits im RAM bestätigt: Block ${e.confirmedBlocks.join(', ')}.`:'';
  clear();say(`${e.message}${partial} Vor weiteren Änderungen neu auslesen.`);log(`CFW-Profile: ${e.message}${partial}`,'ERROR');
 }finally{setBusy(false);update();}}
 $('profiles-read').addEventListener('click',()=>action(async()=>{say('VCU-Version, Status und Profilblöcke werden gelesen …');show(await readProfiles(getClient()));log('CFW-Profile aus dem VCU gelesen.');}));
 $('profiles-save').addEventListener('click',()=>action(async()=>{
  const number=id=>{if(!$(id).value.trim())throw new Error('Profil-Bytes dürfen nicht leer sein.');return Number($(id).value);};
  const sequence=$('profiles-sequence').value.trim().split(/[\s,;]+/).filter(Boolean);
  if(sequence.length<3)throw new Error('Die Eingabefolge braucht wie im originalen G3-Client mindestens 3 Ereignisse.');
  const settings={autoReturn:$('profiles-return').checked,beep:$('profiles-beep').checked};
  for(const name of ['normal','alternate']){
   // Only the Sport limit (byte 1/3) is sent; the read-back Race byte (byte 0/2) is preserved by encodeSettings.
   const high=number(`profiles-${name}-high`);
   if(high<15)throw new Error('Die Mindestgeschwindigkeit beträgt 15 km/h.');
   settings[name]={high};
   for(const key of ['flag4','flag800','cruise'])settings[name][key]=$(`profiles-${name}-${key}`).checked;
  }
  const result=await writeProfiles(getClient(),current,{sequence:$('profiles-sequence').value,settings},{onProgress:say});show(result);
  const clamp=(result.clampedBytes||[]).map(c=>`${c.profile==='normal'?'Normal':'Tuning'}-Sport ${c.wanted}→${c.got} km/h: Der VCU begrenzt die Sollgeschwindigkeit des Profils und hat diesen Wert nicht übernommen.`).join(' ');
  const base=result.changed?`RAM durch Rücklesen bestätigt.${result.missingAcknowledgements.length?' F5-Antwort fehlte; F1-Rücklesen war erfolgreich.':''} Dauerhafte Speicherung nach einem normalen Neustart erneut auslesen.`:'Bereits so eingestellt. Kein F2-Schreibbefehl gesendet.';
  say(clamp?`${base} ${clamp}`:base);
  log('CFW-Profile: '+(result.changed?'RAM-Rücklesen bestätigt; Neustartprüfung offen.':'Keine Änderung.')+(clamp?' '+clamp:''),clamp?'WARN':'INFO');
 }));
 for(const name of ids)for(const event of ['input','change'])$(`profiles-${name}`).addEventListener(event,()=>{dirty=true;update();});
 for(const [id] of PROFILE_EVENTS)$('profiles-seq-add-'+id)?.addEventListener('click',()=>{if(!canEdit())return;const a=seqArr();if(a.length>=19)return;a.push(id);commitSeq(a);});
 $('profiles-seq-undo').addEventListener('click',()=>{if(!canEdit())return;const a=seqArr();a.pop();commitSeq(a);});
 $('profiles-seq-clear').addEventListener('click',()=>{if(!canEdit())return;commitSeq([]);});
 $('profiles-sequence').addEventListener('input',()=>{dirty=true;renderSeq();update();});
 $('profiles-defaults').addEventListener('click',()=>{
  if(!same())return;
  $('profiles-sequence').value='1 1 1 1 1 2 2 2 2 2';renderSeq();
  for(const [n,name]of ['normal','alternate'].entries()){
   $(`profiles-${name}-high`).value=String(current.settings.limits[n].high);
   for(const field of ['flag4','flag800','cruise'])$(`profiles-${name}-${field}`).checked=n===1;
  }
  $('profiles-return').checked=$('profiles-beep').checked=true;dirty=true;say('Standardwerte nur ins Formular geladen. Noch nichts geschrieben.');update();
 });
 $('profiles-export').addEventListener('click',()=>{
  if(!same())return;
  const data={schema:'g3-cfw-profiles-v1',version:current.version,activeProfile:current.activeProfile,sequence:current.sequence,settings:current.settings,rawSequence:profileHex(current.rawSequence),rawSettings:profileHex(current.rawSettings)};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='g3-cfw-profile-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 // Event controls are descriptive only: no synthetic button/input commands.
 $('profiles-events').textContent=PROFILE_EVENTS.map(([id,label,name])=>`${name} (#${id}) — ${label}`).join('\n');
 renderSeq();update();return {update,reset:()=>{clear();update();},snapshot:()=>current};
}
