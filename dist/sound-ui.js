import {convertAudio,encodeWav,buildPayload,checksum,planChunks,uploadSound,VCU,REG_CUSTOM_KEY,REG_PLAY_SOUND,CUSTOM_KEY_SOUND,MAX_SECONDS} from './sound.js?v=1';

export function installSoundUI({getClient,isBusy,setBusy,log,writable}){
  const $=id=>document.getElementById(id);
  let payload=null,previewUrl=null,uploading=null,previousKey=null,source=null;
  const say=t=>{$('snd-status').textContent=t;};
  const online=()=>!!getClient()?.authenticated;
  const slot=()=>{const t=String($('snd-slot').value).trim();return /^\d{1,3}$/.test(t)&&Number(t)<=255?Number(t):null;};
  function update(){
    const ready=online()&&writable()&&!isBusy();
    $('snd-upload').disabled=!ready||!payload||slot()===null||!$('snd-confirm').checked;
    $('snd-dry').disabled=!payload||slot()===null;
    $('snd-cancel').hidden=!uploading;
    for(const id of ['snd-key-read','snd-key-set','snd-play'])$(id).disabled=!ready;
    $('snd-play').disabled=!ready||slot()===null;
    $('snd-key-restore').disabled=!ready||previousKey===null;
    $('snd-lock').hidden=!online()||writable();
  }
  async function convert(){
    if(!source){payload=null;update();return;}
    say('Datei wird umgewandelt …');
    try{
      const start=Math.max(0,Number(String($('snd-start').value).replace(',','.'))||0);
      const seconds=Math.min(MAX_SECONDS,Math.max(0.2,Number(String($('snd-seconds').value).replace(',','.'))||MAX_SECONDS));
      const {samples,seconds:len,sourceSeconds}=await convertAudio(source,{start,seconds,normalize:$('snd-normalize').checked});
      const wav=encodeWav(samples);payload=buildPayload(wav);
      if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(new Blob([wav],{type:'audio/wav'}));$('snd-preview').src=previewUrl;$('snd-preview').hidden=false;
      const {count}=planChunks(payload.length);
      $('snd-info').textContent=`${len.toFixed(2).replace('.',',')} s von ${sourceSeconds.toFixed(1).replace('.',',')} s · 8 kHz, 16 Bit, Mono · ${payload.length.toLocaleString('de-DE')} Bytes · ${count} Pakete`;
      say('Bereit. Vorschau anhören, Slot eintragen und hochladen.');
    }catch(e){payload=null;$('snd-preview').hidden=true;say(e.message);}
    update();
  }
  async function exclusive(fn){if(isBusy())return;setBusy(true);try{return await fn();}finally{setBusy(false);update();}}
  $('snd-file').addEventListener('change',async()=>{const f=$('snd-file').files?.[0];source=f?await f.arrayBuffer():null;await convert();});
  for(const id of ['snd-start','snd-seconds','snd-normalize'])$(id).addEventListener('change',()=>void convert());
  for(const id of ['snd-slot','snd-confirm'])$(id).addEventListener('input',update),$(id).addEventListener('change',update);
  $('snd-dry').addEventListener('click',()=>{
    if(!payload)return;const sum=checksum(payload),{count,lastLength}=planChunks(payload.length);
    const text=`Trockenlauf Slot ${slot()}: Ankündigung 0x76 mit ${payload.length} Bytes, ${count} Pakete à 128 Bytes (letztes ${lastLength}), Prüfsumme 0x${sum.toString(16).padStart(8,'0')} mit 0x78. Nichts gesendet.`;
    say(text);log(text);
  });
  $('snd-upload').addEventListener('click',()=>exclusive(async()=>{
    const c=getClient(),target=slot();if(!payload||target===null||!c?.authenticated||!writable())return;
    uploading=new AbortController();update();$('snd-progress').hidden=false;$('snd-progress').value=0;
    try{
      say(`Upload in Slot ${target} läuft …`);
      const r=await uploadSound(c,{slot:target,payload,signal:uploading.signal,log,onProgress:(n,total)=>{$('snd-progress').value=n/total;say(`Upload in Slot ${target}: ${n}/${total} Pakete …`);}});
      say(`Upload abgeschlossen: ${r.packets} Pakete, Prüfsumme vom Roller bestätigt. Mit „Abspielen“ oder der Custom-Taste testen.`);
    }catch(e){say(`Upload fehlgeschlagen: ${e.message}`);log(`Sound-Upload: ${e.message}`,'ERROR');}
    finally{uploading=null;$('snd-progress').hidden=true;}
  }));
  $('snd-cancel').addEventListener('click',()=>uploading?.abort());
  async function readKey(c){const v=await c.read(VCU,REG_CUSTOM_KEY);$('snd-key-state').textContent=`Aktuelle Belegung der Custom-Taste: ${v}${v===CUSTOM_KEY_SOUND?' (Soundeffekt)':''}`;return v;}
  $('snd-key-read').addEventListener('click',()=>exclusive(async()=>{try{await readKey(getClient());}catch(e){say(e.message);}}));
  $('snd-key-set').addEventListener('click',()=>exclusive(async()=>{
    const c=getClient();
    try{
      const before=await readKey(c);if(before===CUSTOM_KEY_SOUND){say('Custom-Taste spielt bereits den Soundeffekt.');return;}
      await c.writeNoReply(VCU,REG_CUSTOM_KEY,CUSTOM_KEY_SOUND);const after=await readKey(c);
      if(after!==CUSTOM_KEY_SOUND)throw new Error(`Rücklesen ergab ${after} statt ${CUSTOM_KEY_SOUND}.`);
      previousKey=before;log(`Custom-Taste: ${before} → ${CUSTOM_KEY_SOUND} (Soundeffekt), Rücklesen bestätigt.`);say('Custom-Taste spielt jetzt den Soundeffekt.');
    }catch(e){say(`Custom-Taste nicht geändert: ${e.message}`);log(`Custom-Taste: ${e.message}`,'ERROR');}
  }));
  $('snd-key-restore').addEventListener('click',()=>exclusive(async()=>{
    const c=getClient();
    try{await c.writeNoReply(VCU,REG_CUSTOM_KEY,previousKey);const after=await readKey(c);if(after!==previousKey)throw new Error(`Rücklesen ergab ${after}.`);log(`Custom-Taste auf ${previousKey} zurückgesetzt.`);say('Custom-Taste zurückgesetzt.');previousKey=null;}
    catch(e){say(`Zurücksetzen fehlgeschlagen: ${e.message}`);}
  }));
  $('snd-play').addEventListener('click',()=>exclusive(async()=>{
    const target=slot();
    try{await getClient().writeNoReply(VCU,REG_PLAY_SOUND,target);log(`playSound: Wert ${target} gesendet (experimentell).`);say(`Abspielbefehl für ${target} gesendet. Ob der Wert die Slot-Nummer ist, ist nicht bestätigt.`);}
    catch(e){say(e.message);}
  }));
  update();
  return {update};
}
