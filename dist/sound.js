// Custom sound upload to the G3 VCU. Format and flow follow the static analysis of the official app's
// Java file-transfer path (g3-sound-upload-analysis.md): 8 kHz / 16 bit / mono WAV with a 12-byte prefix,
// announced with 0x76, sent in 128-byte chunks with 0x77 and closed with 0x78 (index 0, inverted byte sum).
// Not hardware-confirmed. The G3 sound slot number is not known and must be supplied by the user.
export const VCU=0x16,CMD_BEGIN=0x76,CMD_WRITE=0x77,CMD_FINISH=0x78;
export const REG_CUSTOM_KEY=0x4a,REG_VOICE_VOLUME=0x76,REG_PLAY_SOUND=0x77,CUSTOM_KEY_SOUND=8;
export const RATE=8000,CHUNK=128,MAX_SECONDS=4;
export const STATUS={0:'OK',1:'Fehler',2:'Indexfehler',3:'Speichern fehlgeschlagen'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/** Canonical 44-byte-header PCM16 mono WAV from samples in [-1, 1]. */
export function encodeWav(samples,rate=RATE){
  const out=new Uint8Array(44+samples.length*2),v=new DataView(out.buffer);
  const text=(o,s)=>{for(let i=0;i<s.length;i++)out[o+i]=s.charCodeAt(i);};
  text(0,'RIFF');v.setUint32(4,36+samples.length*2,true);text(8,'WAVE');text(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);
  v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const s=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,s<0?Math.round(s*0x8000):Math.round(s*0x7fff),true);}
  return out;
}
/** Proprietary 12-byte prefix (<IIHBB: 12, len+12, 8000, 16, 1) followed by the complete WAV file. */
export function buildPayload(wav){
  const out=new Uint8Array(12+wav.length),v=new DataView(out.buffer);
  v.setUint32(0,12,true);v.setUint32(4,wav.length+12,true);v.setUint16(8,RATE,true);out[10]=16;out[11]=1;out.set(wav,12);
  return out;
}
/** Not a CRC32: 32-bit sum of all payload bytes, bit-inverted. */
export function checksum(payload){let sum=0;for(const b of payload)sum=(sum+b)>>>0;return (~sum)>>>0;}
export const le32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
export function beginData(length){return [...le32(length),1];}

/** Flow control from the 0x76 reply. `last` is the last packet the scooter already holds (-1 = none). */
export function parseBegin(data){
  const d=Uint8Array.from(data),v=new DataView(d.buffer),fix=w=>w===5000?0:Math.max(w,0);
  if(d.length>=4&&v.getUint16(0,true)===64)return {format:'legacy',protocol:0,group:64,last:-1,wait:fix(v.getInt16(2,true))};
  if(d.length>=11)return {format:'extended',protocol:d[0],group:v.getUint16(1,true),last:v.getInt32(3,true),wait:fix(v.getInt32(7,true))};
  return {format:'default',protocol:0,group:8,last:-1,wait:0};
}
export function planChunks(length){const n=Math.ceil(length/CHUNK);return {count:n,lastLength:length-(n-1)*CHUNK};}

const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join(' ');
/**
 * Upload `payload` into `slot`. `client` provides request/sendUnacknowledged/read as in ninebot.js.
 * Throws on any non-OK status; never guesses a resume position the protocol description does not define.
 */
export async function uploadSound(client,{slot,payload,onProgress=()=>{},log=()=>{},signal=null,retries=5,timeouts={begin:3000,ack:10000,finish:10000}}){
  if(!Number.isInteger(slot)||slot<0||slot>255)throw new Error('Slot muss eine ganze Zahl von 0 bis 255 sein.');
  const check=()=>{if(signal?.aborted)throw new Error('Upload abgebrochen.');};
  if(await client.read(VCU,0x57)!==0)throw new Error('Upload nur im Stillstand.');
  const sum=checksum(payload),{count}=planChunks(payload.length);
  log(`Sound-Upload: Slot ${slot}, ${payload.length} Bytes, ${count} Abschnitte, Prüfsumme 0x${sum.toString(16).padStart(8,'0')}.`);
  const begin=await client.request(VCU,CMD_BEGIN,slot,beginData(payload.length),CMD_BEGIN,null,timeouts.begin);
  if(begin.index!==0)throw new Error(`Roller lehnt den Upload ab: Status ${begin.index} (${STATUS[begin.index]||'unbekannt'}), Antwort ${hex(begin.payload)||'leer'}.`);
  const flow=parseBegin(begin.payload);
  if(!flow.group)throw new Error(`Ungültige Gruppengröße in der Startantwort: ${hex(begin.payload)}.`);
  let next=flow.protocol===1&&flow.last>=0?flow.last+1:0;
  log(`Sound-Upload: Startantwort ${flow.format}, ${flow.group} Pakete je Gruppe, Pause ${flow.wait} ms${next?`, fortsetzen ab Paket ${next}`:''}.`);
  while(next<count){
    check();
    const within=next%flow.group,offset=next*CHUNK,chunk=Array.from(payload.subarray(offset,offset+CHUNK));
    const groupEnd=within===flow.group-1||next===count-1;
    if(!groupEnd){
      await client.sendUnacknowledged(VCU,CMD_WRITE,within&255,chunk);
      if(flow.wait)await sleep(flow.wait);
    }else{
      let ack;
      for(let attempt=0;;attempt++){
        try{ack=await client.request(VCU,CMD_WRITE,within&255,chunk,CMD_WRITE,null,timeouts.ack);break;}
        catch(e){if(attempt>=retries||!/Keine Antwort/.test(e.message))throw e;log(`Sound-Upload: keine Gruppenbestätigung für Paket ${next}, Wiederholung ${attempt+1}/${retries}.`);await sleep(100);check();}
      }
      if(ack.index!==0)throw new Error(`Upload bei Paket ${next+1}/${count} abgebrochen: Status ${ack.index} (${STATUS[ack.index]||'unbekannt'}), Antwort ${hex(ack.payload)||'leer'}.`);
    }
    next++;onProgress(next,count);
  }
  check();
  const done=await client.request(VCU,CMD_FINISH,0,le32(sum),CMD_FINISH,null,timeouts.finish);
  if(done.index!==0)throw new Error(`Prüfsumme nicht akzeptiert: Status ${done.index} (${STATUS[done.index]||'unbekannt'}), Antwort ${hex(done.payload)||'leer'}.`);
  log('Sound-Upload: Abschluss vom Roller bestätigt.');
  return {bytes:payload.length,packets:count,checksum:sum,flow};
}

/** Decode any browser-supported audio file and convert it to the upload format. */
export async function convertAudio(arrayBuffer,{start=0,seconds=MAX_SECONDS,normalize=true}={}){
  const AC=globalThis.AudioContext||globalThis.webkitAudioContext;if(!AC)throw new Error('Audio-Umwandlung wird von diesem Browser nicht unterstützt.');
  const ctx=new AC();let decoded;
  try{decoded=await ctx.decodeAudioData(arrayBuffer.slice(0));}catch{throw new Error('Datei kann nicht gelesen werden. Unterstützt sind gängige Formate wie MP3, WAV, OGG, M4A.');}finally{ctx.close?.();}
  const length=Math.max(1,Math.min(seconds,MAX_SECONDS,Math.max(0,decoded.duration-start)));
  const offline=new OfflineAudioContext(1,Math.round(length*RATE),RATE),src=offline.createBufferSource();
  src.buffer=decoded;src.connect(offline.destination);src.start(0,Math.max(0,start),length);
  const samples=(await offline.startRendering()).getChannelData(0).slice();
  if(normalize){let peak=0;for(const s of samples)peak=Math.max(peak,Math.abs(s));if(peak>0.001)for(let i=0;i<samples.length;i++)samples[i]=samples[i]/peak*0.95;}
  return {samples,seconds:samples.length/RATE,sourceSeconds:decoded.duration};
}
