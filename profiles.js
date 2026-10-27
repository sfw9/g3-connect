// Custom VCU profile protocol, reconstructed from the supplied AA03 firmware.
// BLE Encryption2/pairing remains entirely in Ninebot.request(). No stock writes.
// CFW is detected by this F1/F2 profile protocol answering with valid blocks, NOT by the
// version word: the firmware advertises a stock version (e.g. 0x162) for stealth. A snapshot
// only exists when both F1 blocks read back and the sequence decodes as the AA03 format, so a
// successful read is itself the CFW signature. PROFILE_VERSION is kept only as a legacy marker.
export const PROFILE_BOARD=0x16,PROFILE_VERSION=0xaa03;
// [protocol id, German description, original 1dragon-dashboard button name].
// The third field is the exact label the 1dragon client shows for each G3 input (decoded from its i18n
// inputs dict: input.brake_left→"Left Brake", next_button→"M button (up)", prev_button→"Power button (down)",
// left/right_button→"Left/Right blinker", custom_button→"Boost/Custom button"), so the UI matches the dashboard.
export const PROFILE_EVENTS=Object.freeze([
 [1,'linke Bremse loslassen','Left Brake'],[2,'rechte Bremse loslassen','Right Brake'],
 [4,'Next-Taste','M button (up)'],[5,'Previous-Taste','Power button (down)'],
 [6,'linke Taste','Left blinker'],[7,'rechte Taste','Right blinker'],[8,'Boost/Custom-Taste','Boost/Custom button']
]);
const events=new Set(PROFILE_EVENTS.map(([n])=>n)),owners=new WeakMap(),locks=new WeakSet();
const lengths=[20,16],editable=[0,1,2,3,8,9,10,11,12,13,14,15];
// Settings bytes asserted on write-readback. Race bytes (0,2) and live limits (4–7) are firmware-managed and excluded.
// Flags/autoReturn/beep (8–15) are verified strictly. The Sport set-points (1,3) are advisory: the firmware clamps them
// to the active profile's enforced cap (e.g. a locked tuning profile that rides at 20), so a mismatch there is reported
// as a clamp notice, not a hard write failure.
const strictSettings=[8,9,10,11,12,13,14,15],advisorySettings=[1,3];
const sportByteProfile={1:'normal',3:'alternate'};
const equal=(a,b,indices=null)=>(indices||[...a.keys()]).every(i=>a[i]===b[i]);
export const profileHex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(' ');
function bytes(value,n){if(!(value instanceof Uint8Array)||value.length!==n)throw new Error(`Profilblock muss genau ${n} Bytes enthalten.`);return value;}
function integer(v){if(!Number.isInteger(v)||v<0||v>255)throw new Error('Profilwerte brauchen ganze Bytes von 0 bis 255.');return v;}
function bool(v){if(typeof v!=='boolean')throw new Error('Profilschalter brauchen Ein oder Aus.');return v;}
function keys(obj,allowed){if(!obj||typeof obj!=='object'||Array.isArray(obj)||Object.keys(obj).some(k=>!allowed.includes(k)))throw new Error('Unbekanntes Profilfeld.');}
export function encodeSequence(sequence){
 if(typeof sequence==='string'){
  const text=sequence.trim();if(!/^[\d\s,;]+$/.test(text))throw new Error('Eingabefolge: nur Ereignisnummern, mit Leerzeichen getrennt.');
  sequence=text.split(/[\s,;]+/).filter(Boolean).map(Number);
 }
 if(!Array.isArray(sequence)||sequence.length<1||sequence.length>19||sequence.some(n=>!events.has(n)))throw new Error('Eingabefolge: 1–19 Ereignisse aus 1, 2, 4, 5, 6, 7, 8.');
 const out=new Uint8Array(20);out.set(sequence);return out;
}
export function decodeSequence(raw){
 bytes(raw,20);const end=raw.indexOf(0);
 if(end<1||end>19||raw.slice(0,end).some(n=>!events.has(n)))throw new Error('Unbekannte Eingabefolge: keine gültige, nullterminierte AA03-Folge.');
 return Array.from(raw.slice(0,end));
}
export function decodeSettings(raw){
 bytes(raw,16);
 const profile=n=>({low:raw[n*2],high:raw[n*2+1],flag4:!!raw[8+n],flag800:!!raw[10+n],cruise:!!raw[12+n]});
 return {normal:profile(0),alternate:profile(1),limits:[{low:raw[4],high:raw[5]},{low:raw[6],high:raw[7]}],autoReturn:!!raw[14],beep:!!raw[15]};
}
export function encodeSettings(raw,patch={}){
 bytes(raw,16);keys(patch,['normal','alternate','autoReturn','beep']);const out=raw.slice();
 for(const [n,name]of ['normal','alternate'].entries())if(Object.hasOwn(patch,name)){
  const p=patch[name];keys(p,['low','high','flag4','flag800','cruise']);
  for(const [field,offset]of [['low',2*n],['high',2*n+1]])if(Object.hasOwn(p,field))out[offset]=integer(p[field]);
  for(const [field,offset]of [['flag4',8+n],['flag800',10+n],['cruise',12+n]])if(Object.hasOwn(p,field)){
   const wanted=bool(p[field]);if(wanted!==!!raw[offset])out[offset]=Number(wanted);
  }
  if(out[2*n]>raw[4+2*n]||out[2*n+1]>raw[5+2*n])throw new Error(`${name==='normal'?'Normalprofil':'Alternativprofil'} überschreitet ein vom VCU gemeldetes Byte-Limit.`);
 }
 for(const [field,offset]of [['autoReturn',14],['beep',15]])if(Object.hasOwn(patch,field)){
  const wanted=bool(patch[field]);if(wanted!==!!raw[offset])out[offset]=Number(wanted);
 }
 return out;
}
function identity(c){return {session:c.session,device:c.device?.id};}
function guard(c,id){if(!c?.authenticated||c.session!==id.session||c.device?.id!==id.device)throw new Error('Profilvorgang abgebrochen: Verbindung oder Gerät gewechselt. Neu auslesen.');}
async function exclusive(c,fn){
 if(!c?.authenticated)throw new Error('Zuerst verbinden.');
 if(locks.has(c))throw new Error('Ein Profilvorgang läuft bereits.');locks.add(c);
 try{return await fn(identity(c));}finally{locks.delete(c);}
}
async function readWord(c,id,index){guard(c,id);const n=await c.read(PROFILE_BOARD,index);guard(c,id);return n;}
async function block(c,id,slot){
 guard(c,id);const r=await c.request(PROFILE_BOARD,0xf1,slot,[],0xf4,slot);
 guard(c,id);if(r.index!==slot||r.board!==undefined&&r.board!==PROFILE_BOARD)throw new Error('Profilantwort stammt nicht vom erwarteten VCU/Block.');
 return bytes(r.payload,lengths[slot]).slice();
}
function snapshot(c,id,version,active,seq,settings){
 const value={version,activeProfile:active,sequence:decodeSequence(seq),settings:decodeSettings(settings),
  rawSequence:seq.slice(),rawSettings:settings.slice(),writable:true,persistenceVerified:false};
 owners.set(value,{client:c,id:{...id},seq:seq.slice(),settings:settings.slice(),active,version});return value;
}
async function readSnapshot(c,id){
 const version=await readWord(c,id,0x17);
 for(let attempt=0;attempt<2;attempt++){
  const before=(await readWord(c,id,0x1d)&2)?1:0;
  const seq=await block(c,id,0),settings=await block(c,id,1);
  const after=(await readWord(c,id,0x1d)&2)?1:0;
  if(before===after)return snapshot(c,id,version,after,seq,settings);
 }
 throw new Error('Profil wechselte während des Auslesens. Ohne Betätigung erneut lesen.');
}
export async function readProfiles(c){return exclusive(c,id=>readSnapshot(c,id));}
export async function writeProfiles(c,baseline,changes,{onProgress=()=>{}}={}){
 const old=owners.get(baseline);
 if(!old||old.client!==c)throw new Error('Zuerst Profile dieses Geräts auslesen.');
 keys(changes,['sequence','settings']);
 return exclusive(c,async id=>{
  guard(c,old.id);const fresh=await readSnapshot(c,id);
  // No version gate: CFW was confirmed by readSnapshot decoding valid F1 profile blocks above.
  if(!equal(old.seq,fresh.rawSequence)||!equal(old.settings,fresh.rawSettings,editable)||old.active!==fresh.activeProfile)throw new Error('Profile wurden zwischenzeitlich geändert. Neu auslesen, dann bearbeiten.');
  let sequence=Object.hasOwn(changes,'sequence')?encodeSequence(changes.sequence):fresh.rawSequence;
  if(equal(encodeSequence(fresh.sequence),sequence))sequence=fresh.rawSequence; // Preserve ignored trailing bytes when the logical sequence is unchanged.
  const wanted=[sequence,
   Object.hasOwn(changes,'settings')?encodeSettings(fresh.rawSettings,changes.settings):fresh.rawSettings];
  const actual=[fresh.rawSequence,fresh.rawSettings],plan=[0,1].filter(i=>!equal(wanted[i],actual[i],i===1?editable:null));
  const confirmed=[],ackMissing=[],clamped=[];
  try{
   for(const slot of plan){
    if(await readWord(c,id,0x57)!==0)throw new Error('Profile nur im Stillstand schreiben.');
    if(((await readWord(c,id,0x1d)&2)?1:0)!==fresh.activeProfile)throw new Error('Aktives Profil wechselte. Neu auslesen.');
    onProgress(`Block ${slot}: schreiben und zurücklesen …`);guard(c,id);
    let failure=null;
    try{
     const ack=await c.request(PROFILE_BOARD,0xf2,slot,wanted[slot],0xf5,slot);
     guard(c,id);if(ack.index!==slot||ack.payload.length!==0||ack.board!==undefined&&ack.board!==PROFILE_BOARD)throw new Error('Unerwartete F5-Profilbestätigung.');
    }catch(e){failure=e;guard(c,id);}
    // Never repeat a flash-writing F2. Even a missing ACK is followed only by F1.
    const readback=await block(c,id,slot);
    if(slot===1){
     const strictDiff=strictSettings.filter(i=>wanted[1][i]!==readback[i]);
     if(strictDiff.length)throw new Error(`Block 1: Rücklesen stimmt nicht überein (${strictDiff.map(i=>`Byte ${i} ${wanted[1][i]}→${readback[i]}`).join(', ')}). Kein erneuter Schreibversuch.`);
     for(const i of advisorySettings)if(wanted[1][i]!==readback[i])clamped.push({byte:i,profile:sportByteProfile[i],wanted:wanted[1][i],got:readback[i]});
    }else{
     const diff=[...wanted[slot].keys()].filter(i=>wanted[slot][i]!==readback[i]);
     if(diff.length)throw new Error(`Block ${slot}: Rücklesen stimmt nicht überein (${diff.map(i=>`Byte ${i} ${wanted[slot][i]}→${readback[i]}`).join(', ')}). Kein erneuter Schreibversuch.`);
    }
    if(failure)ackMissing.push(slot);confirmed.push(slot);
   }
   const result=await readSnapshot(c,id);result.confirmedBlocks=confirmed;result.missingAcknowledgements=ackMissing;result.clampedBytes=clamped;result.changed=plan.length>0;
   return result;
  }catch(e){e.confirmedBlocks=confirmed.slice();e.missingAcknowledgements=ackMissing.slice();e.clampedBytes=clamped.slice();throw e;}
 });
}
