import {convertAudio,testTone,encodeWav,buildPayload,checksum,planChunks,uploadSound,setCustomSound,setCustomKey,setCustomKeySound,keyActionName,writeVerified,slotInfo,SOUND_SLOTS,VCU,REG_CUSTOM_KEY,REG_PLAY_SOUND,REG_FUN_BOOL3,CUSTOM_KEY_SOUND,MAX_SECONDS} from './sound.js?v=5';
import {openMicrophone,dumpSounds,makeZip} from './sound-dump.js?v=1';

const STORE='g3-sound-slots';
const hex4=v=>'0x'+v.toString(16).padStart(4,'0');

export function installSoundUI({getClient,isBusy,setBusy,log,writable}){
  const $=id=>document.getElementById(id);
  let payload=null,previewUrl=null,uploading=null,previousKey=null,source=null,dumping=null;const recordings=[];
  // Player: plays playSound values one after another; numbers where something was heard can be marked.
  let scanTimer=null,scanValue=null,lastPlayed=null;const hits=[];
  const say=t=>{$('snd-status').textContent=t;};
  const online=()=>!!getClient()?.authenticated;
  const manual=()=>$('snd-event').value==='other';
  const parseSlot=t=>{t=String(t).trim();return /^\d{1,3}$/.test(t)&&Number(t)<=255?Number(t):null;};
  // Optional single bit of 0x1F; '' = none (0), anything else invalid = null.
  const parseMask=t=>{t=String(t).trim();if(!t)return 0;const n=/^0x[\da-f]{1,4}$/i.test(t)?parseInt(t,16):/^\d{1,5}$/.test(t)?Number(t):NaN;return n>0&&n<=0x8000&&!(n&(n-1))?n:null;};
  let userSlots=[];
  try{userSlots=(JSON.parse(localStorage.getItem(STORE)||'[]')||[]).filter(u=>parseSlot(u.slot)!==null&&parseMask(String(u.mask))!==null);}catch{}
  const saveSlots=()=>{try{localStorage.setItem(STORE,JSON.stringify(userSlots));}catch{}};
  /** Selected target: a known event slot, a saved own slot or a manual number. */
  function selected(){
    const v=$('snd-event').value;
    if(v==='other'){const n=parseSlot($('snd-slot').value),mask=parseMask($('snd-mask').value);return n===null||mask===null?null:{label:`Slot ${n}`,slot:n,mask,confirmed:false,manual:true};}
    if(v.startsWith('u:')){const u=userSlots.find(x=>`u:${x.slot}`===v);return u?{...u,confirmed:false,user:true}:null;}
    return slotInfo(Number(v));
  }
  const slot=()=>selected()?.slot??null;
  const event=selected;
  const needsConfirm=()=>!selected()?.confirmed;
  function renderUserSlots(){
    const sel=$('snd-event');if(!sel.querySelectorAll)return;
    for(const o of sel.querySelectorAll('option[value^="u:"]'))o.remove();
    const other=sel.querySelector('option[value="other"]');
    for(const u of userSlots){const o=document.createElement('option');o.value=`u:${u.slot}`;o.textContent=`${u.label} (Slot ${u.slot}, eigener)`;sel.insertBefore(o,other);}
  }
  function describe(){
    const e=selected(),v=$('snd-event').value;
    $('snd-slot-field').hidden=!manual();$('snd-own-delete').hidden=!v.startsWith('u:');$('snd-confirm-row').hidden=!needsConfirm();
    const bit=e?.mask?`Bit 0x${e.mask.toString(16)} in Register 0x1F wird vorher gelöscht und danach gesetzt.`:'Register 0x1F wird nicht verändert.';
    const known=e&&(e.manual||e.user)?slotInfo(e.slot):null;
    $('snd-slot-info').textContent=!e?(manual()&&parseMask($('snd-mask').value)===null?'Bit in 0x1F: genau ein Bit, z. B. 0x8000, oder leer lassen.':'Slot-Nummer 0–255 eintragen.')
      :!e.manual&&!e.user?`${e.label}: Slot ${e.slot} (0x${e.slot.toString(16)}), Bit 0x${e.mask.toString(16)} in Register 0x1F. ${e.confirmed?'Upload am Roller bestätigt.':'Vom Segway-Server gemeldet, Upload am Roller noch nicht beobachtet.'}`
      :`${e.user?`Eigener Slot „${e.label}“: `:''}Slot ${e.slot}. ${known?`Das ist ${known.label}; oben direkt auswählen setzt das passende Bit. `:'Unbekannter Slot: kann abgelehnt werden oder einen vorhandenen Sound überschreiben. '}${bit}`;
  }
  function update(){
    const ready=online()&&writable()&&!isBusy()&&!scanTimer;
    $('snd-upload').disabled=!ready||!payload||slot()===null||(needsConfirm()&&!$('snd-confirm').checked);
    $('snd-dry').disabled=!payload||slot()===null;
    $('snd-cancel').hidden=!uploading;
    for(const id of ['snd-key-read','snd-key-set','snd-key-action','snd-mode-read'])$(id).disabled=!ready;
    $('snd-mode-on').disabled=$('snd-mode-off').disabled=!ready||!event()?.mask;
    $('snd-play').disabled=!ready||slot()===null;
    $('snd-own-save').disabled=!manual()||!selected();
    if(scanTimer&&!online())stopScan('Abspielen abgebrochen: Verbindung getrennt.');
    const scanReady=online()&&writable()&&!dumping;
    $('snd-scan-start').disabled=!scanReady||(!scanTimer&&isBusy());
    $('snd-scan-start').textContent=scanTimer?'Stoppen':'Abspielen starten';
    $('snd-scan-prev').disabled=$('snd-scan-next').disabled=!scanReady||!!scanTimer||isBusy();
    $('snd-scan-hit').disabled=lastPlayed===null;
    $('snd-dump-start').disabled=!online()||!writable()||!!scanTimer||(isBusy()&&!dumping);$('snd-dump-start').hidden=!!dumping;$('snd-dump-stop').hidden=!dumping;
    $('snd-dump-zip').disabled=!recordings.length||!!dumping;
    $('snd-key-restore').disabled=!ready||previousKey===null;
    $('snd-lock').hidden=!online()||writable();
  }
  function useSamples(samples,label){
    const wav=encodeWav(samples);payload=buildPayload(wav);
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(new Blob([wav],{type:'audio/wav'}));$('snd-preview').src=previewUrl;$('snd-preview').hidden=false;
    $('snd-info').textContent=`${label} · 8 kHz, 16 Bit, Mono · ${payload.length.toLocaleString('de-DE')} Bytes · ${planChunks(payload.length).count} Pakete`;
  }
  async function convert(){
    if(!source){payload=null;update();return;}
    say('Datei wird umgewandelt …');
    try{
      const start=Math.max(0,Number(String($('snd-start').value).replace(',','.'))||0);
      const seconds=Math.min(MAX_SECONDS,Math.max(0.2,Number(String($('snd-seconds').value).replace(',','.'))||MAX_SECONDS));
      const {samples,seconds:len,sourceSeconds}=await convertAudio(source,{start,seconds,normalize:$('snd-normalize').checked});
      useSamples(samples,`${len.toFixed(2).replace('.',',')} s von ${sourceSeconds.toFixed(1).replace('.',',')} s`);
      say('Bereit. Vorschau anhören, Ereignis wählen und hochladen.');
    }catch(e){payload=null;$('snd-preview').hidden=true;say(e.message);}
    update();
  }
  async function exclusive(fn){if(isBusy())return;setBusy(true);try{return await fn();}finally{setBusy(false);update();}}
  $('snd-tone').addEventListener('click',()=>{source=null;$('snd-file').value='';useSamples(testTone(),'Testton: drei aufsteigende Pieptöne, 1,5 s');say('Testton bereit. Ereignis wählen und hochladen.');update();});
  $('snd-file').addEventListener('change',async()=>{const f=$('snd-file').files?.[0];source=f?await f.arrayBuffer():null;await convert();});
  for(const id of ['snd-start','snd-seconds','snd-normalize'])$(id).addEventListener('change',()=>void convert());
  for(const id of ['snd-event','snd-slot','snd-mask','snd-confirm'])for(const type of ['input','change'])$(id).addEventListener(type,()=>{if(id!=='snd-confirm')$('snd-confirm').checked=false;describe();update();});
  $('snd-dry').addEventListener('click',()=>{
    const e=event();if(!payload||!e)return;const sum=checksum(payload),{count,lastLength}=planChunks(payload.length);
    const text=`Trockenlauf Slot ${e.slot}${e.manual?'':` (${e.label})`}: ${e.mask?`Register 0x1F Bit 0x${e.mask.toString(16)} löschen, `:''}Ankündigung 0x76 mit ${payload.length} Bytes, ${count} Pakete à 128 Bytes (letztes ${lastLength}), Prüfsumme 0x${sum.toString(16).padStart(8,'0')} mit 0x78${e.mask?', danach Bit setzen':''}. Nichts gesendet.`;
    say(text);log(text);
  });
  $('snd-upload').addEventListener('click',()=>exclusive(async()=>{
    const c=getClient(),e=event(),target=e?.slot;if(!payload||!e||!c?.authenticated||!writable())return;
    uploading=new AbortController();update();$('snd-progress').hidden=false;$('snd-progress').value=0;
    const name=e.manual?`Slot ${target}`:`${e.label} (Slot ${target})`;
    try{
      say(`Upload ${name} läuft …`);
      const r=await uploadSound(c,{slot:target,payload,mask:e.mask,signal:uploading.signal,log,onProgress:(n,total)=>{$('snd-progress').value=n/total;say(`Upload ${name}: ${n}/${total} Pakete …`);}});
      let test=e?.type==='power_on_sound'?' Zum Testen den Roller aus- und einschalten.':'';
      if(e?.type==='customize_sound'){
        // The sound only plays if the button's action is "sound effect"; otherwise it keeps e.g. the hazard lights.
        try{test=` ${await assignKey(c)} Zum Testen die Custom-Taste drücken.`;}
        catch(err){test=` Custom-Taste nicht auf Soundeffekt gestellt: ${err.message}`;log(`Custom-Taste: ${err.message}`,'ERROR');}
      }
      say(`Upload abgeschlossen: ${r.packets} Pakete, Prüfsumme vom Roller bestätigt${e.mask?', eigener Sound aktiv':''}.${test}`);
    }catch(err){say(`Upload fehlgeschlagen: ${err.message}`);log(`Sound-Upload: ${err.message}`,'ERROR');}
    finally{uploading=null;$('snd-progress').hidden=true;}
  }));
  $('snd-cancel').addEventListener('click',()=>uploading?.abort());
  function showMode(value){
    const all=[...SOUND_SLOTS,...userSlots.filter(u=>u.mask&&!SOUND_SLOTS.some(s=>s.mask===u.mask))];
    $('snd-mode-state').textContent=`Register 0x1F = ${hex4(value)}: `+all.map(s=>`${s.label} ${value&s.mask?'eigener Sound':'Werkston'}`).join(' · ');
  }
  $('snd-mode-read').addEventListener('click',()=>exclusive(async()=>{try{showMode(await getClient().read(VCU,REG_FUN_BOOL3));}catch(e){say(e.message);}}));
  for(const [id,on] of [['snd-mode-on',true],['snd-mode-off',false]])$(id).addEventListener('click',()=>exclusive(async()=>{
    const e=event();if(!e?.mask)return;
    try{const v=await setCustomSound(getClient(),e.mask,on);showMode(v);log(`${e.label}: ${on?'eigener Sound':'Werkston'} (Register 0x1F = 0x${v.toString(16)}, Rücklesen bestätigt).`);say(`${e.label} spielt jetzt ${on?'den eigenen Sound':'den Werkston'}.`);}
    catch(err){say(`${e.label} nicht umgestellt: ${err.message}`);log(`Register 0x1F: ${err.message}`,'ERROR');}
  }));
  function showKey(v){$('snd-key-state').textContent=`Aktuelle Belegung der Custom-Taste: ${keyActionName(v)}`;if(v>=1&&v<=8)$('snd-key-action').value=String(v);}
  async function readKey(c){const v=await c.read(VCU,REG_CUSTOM_KEY);showKey(v);return v;}
  async function assignKey(c,value=CUSTOM_KEY_SOUND){
    const {before,changed}=value===CUSTOM_KEY_SOUND?await setCustomKeySound(c):await setCustomKey(c,value);
    showKey(value);
    if(!changed)return `Custom-Taste ist bereits belegt mit ${keyActionName(value)}.`;
    previousKey=before;log(`Custom-Taste: ${keyActionName(before)} → ${keyActionName(value)}, Rücklesen bestätigt.`);
    return `Custom-Taste von ${keyActionName(before)} auf ${keyActionName(value)} umgestellt (Zurücksetzen unter „Custom-Taste belegen“).`;
  }
  $('snd-key-read').addEventListener('click',()=>exclusive(async()=>{try{await readKey(getClient());}catch(e){say(e.message);}}));
  $('snd-key-set').addEventListener('click',()=>exclusive(async()=>{
    try{say(await assignKey(getClient(),Number($('snd-key-action').value)));}
    catch(e){say(`Custom-Taste nicht geändert: ${e.message}`);log(`Custom-Taste: ${e.message}`,'ERROR');}
  }));
  $('snd-key-restore').addEventListener('click',()=>exclusive(async()=>{
    const c=getClient();
    try{await writeVerified(c,REG_CUSTOM_KEY,previousKey);await readKey(c);log(`Custom-Taste auf ${previousKey} zurückgesetzt.`);say('Custom-Taste zurückgesetzt.');previousKey=null;}
    catch(e){say(`Zurücksetzen fehlgeschlagen: ${e.message}`);}
  }));
  $('snd-play').addEventListener('click',()=>exclusive(async()=>{
    const target=slot();
    try{await getClient().writeNoReply(VCU,REG_PLAY_SOUND,target);log(`playSound: Wert ${target} gesendet (experimentell).`);say(`Abspielbefehl für ${target} gesendet. Ob der Wert die Slot-Nummer ist, ist nicht bestätigt.`);}
    catch(e){say(e.message);}
  }));
  // Own slots: saved in this browser only.
  $('snd-own-save').addEventListener('click',()=>{
    const e=selected();if(!e?.manual)return;
    const label=String($('snd-own-name').value).trim().slice(0,40)||`Slot ${e.slot}`;
    userSlots=[...userSlots.filter(u=>u.slot!==e.slot),{label,slot:e.slot,mask:e.mask}].sort((a,b)=>a.slot-b.slot);saveSlots();renderUserSlots();
    $('snd-event').value=`u:${e.slot}`;$('snd-confirm').checked=false;log(`Eigener Slot gespeichert: ${label}, Slot ${e.slot}${e.mask?`, Bit ${hex4(e.mask)}`:''}.`);
    describe();update();
  });
  $('snd-own-delete').addEventListener('click',()=>{
    const v=$('snd-event').value;userSlots=userSlots.filter(u=>`u:${u.slot}`!==v);saveSlots();renderUserSlots();
    $('snd-event').value='71';describe();update();
  });
  // Dumper: playSound + microphone. Holds the busy flag so nothing else is sent meanwhile.
  const sayDump=t=>{$('snd-dump-status').textContent=t;};
  const wavOf=r=>encodeWav(r.sound,r.rate);
  function addRecording(r){
    recordings.push(r);
    const li=document.createElement('li'),title=document.createElement('strong'),audio=document.createElement('audio'),row=document.createElement('div');
    const url=URL.createObjectURL(new Blob([wavOf(r)],{type:'audio/wav'}));
    title.textContent=`Nr. ${r.number} · ${r.heard?'Ton erkannt':'kein Ton erkannt'} · Pegel ${r.level.toFixed(3)}`;
    audio.controls=true;audio.src=url;row.className='actions';
    const save=document.createElement('a');save.className='btn';save.href=url;save.download=`g3-sound-${String(r.number).padStart(3,'0')}.wav`;save.textContent='WAV speichern';
    const use=document.createElement('button');use.type='button';use.className='btn';use.textContent='Als Upload verwenden';
    use.addEventListener('click',()=>{source=wavOf(r).buffer;$('snd-file').value='';void convert();});
    row.append(save,use);li.append(title,audio,row);$('snd-dump-list').append(li);
  }
  $('snd-dump-start').addEventListener('click',async()=>{
    if(dumping||isBusy())return;
    const num=(id,max,d)=>{const n=Number(String($(id).value).trim().replace(',','.'));return String($(id).value).trim()!==''&&Number.isFinite(n)&&n>=0&&n<=max?n:d;};
    let from=Math.floor(num('snd-dump-from',255,0)),to=Math.floor(num('snd-dump-to',255,80));if(from>to)[from,to]=[to,from];
    const seconds=Math.min(15,Math.max(0.5,num('snd-dump-seconds',15,3))),numbers=Array.from({length:to-from+1},(_,i)=>from+i);
    let mic;
    try{mic=await openMicrophone();}catch(e){sayDump(`Mikrofon nicht verfügbar: ${e.message}`);return;}
    dumping=new AbortController();setBusy(true);update();
    recordings.length=0;$('snd-dump-list').textContent='';
    $('snd-dump-progress').hidden=false;$('snd-dump-progress').value=0;let kept=0;
    log(`Sound-Dumper: Nummern ${from}–${to}, ${seconds} s je Nummer, Mikrofon ${mic.rate} Hz.`);
    try{
      await dumpSounds({numbers,mic,seconds,signal:dumping.signal,
        play:async n=>{const c=getClient();if(!c?.authenticated)throw new Error('Verbindung getrennt.');await c.writeNoReply(VCU,REG_PLAY_SOUND,n);sayDump(`Nummer ${n} läuft (${n-from+1}/${numbers.length}) …`);},
        onItem:r=>{$('snd-dump-progress').value=(r.index+1)/r.total;log(`Sound-Dumper: Nr. ${r.number} ${r.heard?'Ton':'still'} (Pegel ${r.level.toFixed(3)}, Hintergrund ${r.floor.toFixed(3)}).`);if(r.heard||!$('snd-dump-skip').checked){addRecording(r);kept++;}update();}});
      sayDump(`Fertig: ${numbers.length} Nummern abgespielt, ${kept} Aufnahmen behalten.`);
    }catch(e){sayDump(`${e.message} ${kept} Aufnahmen behalten.`);}
    finally{mic.close();dumping=null;setBusy(false);$('snd-dump-progress').hidden=true;update();}
  });
  $('snd-dump-stop').addEventListener('click',()=>dumping?.abort());
  $('snd-dump-zip').addEventListener('click',()=>{
    const zip=makeZip(recordings.map(r=>({name:`g3-sound-${String(r.number).padStart(3,'0')}.wav`,data:wavOf(r)})));
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([zip],{type:'application/zip'}));a.download='g3-sounds.zip';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);
  });
  const sayScan=t=>{$('snd-scan-status').textContent=t;};
  const num=(id,max,fallback)=>{const t=String($(id).value).trim().replace(',','.');const n=Number(t);return t!==''&&Number.isFinite(n)&&n>=0&&n<=max?n:fallback;};
  const range=()=>{const a=Math.floor(num('snd-scan-from',255,0)),b=Math.floor(num('snd-scan-to',255,255));return a<=b?[a,b]:[b,a];};
  async function play(value){
    const c=getClient();if(!c?.authenticated)throw new Error('Verbindung getrennt.');
    setBusy(true);try{await c.writeNoReply(VCU,REG_PLAY_SOUND,value);}finally{setBusy(false);}
    lastPlayed=value;$('snd-scan-current').textContent=String(value);log(`Sound abspielen: playSound ${value}.`);
  }
  function stopScan(message){clearInterval(scanTimer);scanTimer=null;scanValue=null;if(message)sayScan(message);update();}
  async function scanStep(){
    if(scanValue===null)return;const [,to]=range();
    if(scanValue>to){stopScan(`Fertig. ${hits.length?`Markiert: ${hits.join(', ')}.`:'Keine Nummer markiert.'}`);return;}
    if(isBusy())return;
    try{await play(scanValue);sayScan(`Nummer ${scanValue} gespielt.`);scanValue++;}
    catch(e){stopScan(`Abspielen abgebrochen: ${e.message}`);}
  }
  async function stepTo(value){
    const [from,to]=range();if(scanTimer)stopScan();const v=Math.min(to,Math.max(from,value));
    try{await play(v);sayScan(`Nummer ${v} gespielt.`);}catch(e){sayScan(e.message);}update();
  }
  $('snd-scan-start').addEventListener('click',()=>{
    if(scanTimer){stopScan('Gestoppt.');return;}
    const [from,to]=range(),pause=Math.max(1,num('snd-scan-pause',60,3));
    scanValue=from;log(`Sound abspielen: ${from}–${to}, alle ${pause} s.`);
    scanTimer=setInterval(()=>void scanStep(),pause*1000);void scanStep();update();
  });
  $('snd-scan-next').addEventListener('click',()=>void stepTo(lastPlayed===null?range()[0]:lastPlayed+1));
  $('snd-scan-prev').addEventListener('click',()=>void stepTo(lastPlayed===null?range()[0]:lastPlayed-1));
  $('snd-scan-hit').addEventListener('click',()=>{
    // While playing, the last value sent is the one just heard; playback continues.
    if(lastPlayed===null)return;if(!hits.includes(lastPlayed))hits.push(lastPlayed);
    hits.sort((a,b)=>a-b);$('snd-scan-hits').textContent=`Ton gehört bei: ${hits.join(', ')}.`;
    log(`Sound abspielen: Ton bei Nummer ${lastPlayed} gehört.`);update();
  });
  window.addEventListener('pagehide',()=>clearInterval(scanTimer));
  renderUserSlots();describe();update();
  return {update};
}
