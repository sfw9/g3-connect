import {convertAudio,testTone,encodeWav,buildPayload,checksum,planChunks,uploadSound,setCustomSound,setCustomKeySound,writeVerified,slotInfo,SOUND_SLOTS,VCU,REG_CUSTOM_KEY,REG_PLAY_SOUND,REG_FUN_BOOL3,CUSTOM_KEY_SOUND,MAX_SECONDS} from './sound.js?v=4';

export function installSoundUI({getClient,isBusy,setBusy,log,writable}){
  const $=id=>document.getElementById(id);
  let payload=null,previewUrl=null,uploading=null,previousKey=null,source=null;
  const say=t=>{$('snd-status').textContent=t;};
  const online=()=>!!getClient()?.authenticated;
  const manual=()=>$('snd-event').value==='other';
  const slot=()=>{
    const t=manual()?String($('snd-slot').value).trim():$('snd-event').value;
    return /^\d{1,3}$/.test(t)&&Number(t)<=255?Number(t):null;
  };
  // Known event slots are uploaded with their 0x1F bit; a manual number is sent without touching the register.
  const event=()=>manual()?null:slotInfo(slot());
  const needsConfirm=()=>!event()?.confirmed;
  function describe(){
    const e=event(),n=slot();
    $('snd-slot-field').hidden=!manual();$('snd-confirm-row').hidden=!needsConfirm();
    $('snd-slot-info').textContent=e?`${e.label}: Slot ${e.slot} (0x${e.slot.toString(16)}), Bit 0x${e.mask.toString(16)} in Register 0x1F. ${e.confirmed?'Upload am Roller bestätigt.':'Vom Segway-Server gemeldet, Upload am Roller noch nicht beobachtet.'}`
      :n!==null&&slotInfo(n)?`Slot ${n} ist ${slotInfo(n).label}; besser oben direkt auswählen, dann wird auch Register 0x1F gesetzt.`
      :'Unbekannter Slot: kann abgelehnt werden oder einen vorhandenen Sound überschreiben. Register 0x1F wird nicht verändert.';
  }
  function update(){
    const ready=online()&&writable()&&!isBusy();
    $('snd-upload').disabled=!ready||!payload||slot()===null||(needsConfirm()&&!$('snd-confirm').checked);
    $('snd-dry').disabled=!payload||slot()===null;
    $('snd-cancel').hidden=!uploading;
    for(const id of ['snd-key-read','snd-key-set','snd-mode-read'])$(id).disabled=!ready;
    $('snd-mode-on').disabled=$('snd-mode-off').disabled=!ready||!event();
    $('snd-play').disabled=!ready||slot()===null;
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
  for(const id of ['snd-event','snd-slot','snd-confirm'])for(const type of ['input','change'])$(id).addEventListener(type,()=>{if(id!=='snd-confirm')$('snd-confirm').checked=false;describe();update();});
  $('snd-dry').addEventListener('click',()=>{
    if(!payload)return;const sum=checksum(payload),{count,lastLength}=planChunks(payload.length),e=event();
    const text=`Trockenlauf Slot ${slot()}${e?` (${e.label})`:''}: ${e?`Register 0x1F Bit 0x${e.mask.toString(16)} löschen, `:''}Ankündigung 0x76 mit ${payload.length} Bytes, ${count} Pakete à 128 Bytes (letztes ${lastLength}), Prüfsumme 0x${sum.toString(16).padStart(8,'0')} mit 0x78${e?', danach Bit setzen':''}. Nichts gesendet.`;
    say(text);log(text);
  });
  $('snd-upload').addEventListener('click',()=>exclusive(async()=>{
    const c=getClient(),target=slot(),e=event();if(!payload||target===null||!c?.authenticated||!writable())return;
    uploading=new AbortController();update();$('snd-progress').hidden=false;$('snd-progress').value=0;
    const name=e?`${e.label} (Slot ${target})`:`Slot ${target}`;
    try{
      say(`Upload ${name} läuft …`);
      const r=await uploadSound(c,{slot:target,payload,mask:e?.mask||0,signal:uploading.signal,log,onProgress:(n,total)=>{$('snd-progress').value=n/total;say(`Upload ${name}: ${n}/${total} Pakete …`);}});
      let test=e?.type==='power_on_sound'?' Zum Testen den Roller aus- und einschalten.':'';
      if(e?.type==='customize_sound'){
        // The sound only plays if the button's action is "sound effect"; otherwise it keeps e.g. the hazard lights.
        try{test=` ${await assignKey(c)} Zum Testen die Custom-Taste drücken.`;}
        catch(err){test=` Custom-Taste nicht auf Soundeffekt gestellt: ${err.message}`;log(`Custom-Taste: ${err.message}`,'ERROR');}
      }
      say(`Upload abgeschlossen: ${r.packets} Pakete, Prüfsumme vom Roller bestätigt${e?', eigener Sound aktiv':''}.${test}`);
    }catch(err){say(`Upload fehlgeschlagen: ${err.message}`);log(`Sound-Upload: ${err.message}`,'ERROR');}
    finally{uploading=null;$('snd-progress').hidden=true;}
  }));
  $('snd-cancel').addEventListener('click',()=>uploading?.abort());
  function showMode(value){
    $('snd-mode-state').textContent=`Register 0x1F = 0x${value.toString(16).padStart(4,'0')}: `+SOUND_SLOTS.map(s=>`${s.label} ${value&s.mask?'eigener Sound':'Werkston'}`).join(' · ');
  }
  $('snd-mode-read').addEventListener('click',()=>exclusive(async()=>{try{showMode(await getClient().read(VCU,REG_FUN_BOOL3));}catch(e){say(e.message);}}));
  for(const [id,on] of [['snd-mode-on',true],['snd-mode-off',false]])$(id).addEventListener('click',()=>exclusive(async()=>{
    const e=event();if(!e)return;
    try{const v=await setCustomSound(getClient(),e.mask,on);showMode(v);log(`${e.label}: ${on?'eigener Sound':'Werkston'} (Register 0x1F = 0x${v.toString(16)}, Rücklesen bestätigt).`);say(`${e.label} spielt jetzt ${on?'den eigenen Sound':'den Werkston'}.`);}
    catch(err){say(`${e.label} nicht umgestellt: ${err.message}`);log(`Register 0x1F: ${err.message}`,'ERROR');}
  }));
  const keyName=v=>v===CUSTOM_KEY_SOUND?`${v} (Soundeffekt)`:String(v);
  async function readKey(c){const v=await c.read(VCU,REG_CUSTOM_KEY);$('snd-key-state').textContent=`Aktuelle Belegung der Custom-Taste: ${keyName(v)}`;return v;}
  async function assignKey(c){
    const {before,changed}=await setCustomKeySound(c);
    $('snd-key-state').textContent=`Aktuelle Belegung der Custom-Taste: ${keyName(CUSTOM_KEY_SOUND)}`;
    if(!changed)return 'Custom-Taste spielt bereits den Soundeffekt.';
    previousKey=before;log(`Custom-Taste: ${before} → ${CUSTOM_KEY_SOUND} (Soundeffekt), Rücklesen bestätigt.`);
    return `Custom-Taste von Aktion ${before} auf Soundeffekt umgestellt (Zurücksetzen unter „Custom-Taste und Abspielen“).`;
  }
  $('snd-key-read').addEventListener('click',()=>exclusive(async()=>{try{await readKey(getClient());}catch(e){say(e.message);}}));
  $('snd-key-set').addEventListener('click',()=>exclusive(async()=>{
    try{say(await assignKey(getClient()));}
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
  describe();update();
  return {update};
}
