// Sound dumper: no command to read a sound file back from the VCU is known, so each number is played with
// playSound (register 0x77) and recorded through the phone's microphone. Nothing else is written to the scooter.
const sleepMs=ms=>new Promise(r=>setTimeout(r,ms));

/** Microphone recorder with raw PCM access; processing (echo cancellation etc.) is turned off. */
export async function openMicrophone(){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Mikrofon wird von diesem Browser nicht unterstützt.');
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
  const ctx=new (globalThis.AudioContext||globalThis.webkitAudioContext)(),src=ctx.createMediaStreamSource(stream),proc=ctx.createScriptProcessor(4096,1,1);
  let chunks=null;
  proc.onaudioprocess=e=>{if(chunks)chunks.push(e.inputBuffer.getChannelData(0).slice());};
  // The processor only runs while connected to the output; it writes nothing, so nothing is heard.
  src.connect(proc);proc.connect(ctx.destination);
  if(ctx.state==='suspended')await ctx.resume();
  return {rate:ctx.sampleRate,
    start(){chunks=[];},
    stop(){const c=chunks||[];chunks=null;const out=new Float32Array(c.reduce((n,a)=>n+a.length,0));let o=0;for(const a of c){out.set(a,o);o+=a.length;}return out;},
    close(){proc.disconnect();src.disconnect();for(const t of stream.getTracks())t.stop();ctx.close?.();}};
}

const rms=(a,from=0,to=a.length)=>{let s=0;for(let i=from;i<to;i++)s+=a[i]*a[i];return to>from?Math.sqrt(s/(to-from)):0;};
/**
 * `samples` starts with `lead` seconds of background before playSound. A sound counts as heard when a 20 ms
 * window after the lead is `factor` times louder than that background (and above a small absolute floor).
 */
export function analyse(samples,rate,{lead=0.3,factor=4,minLevel=0.01}={}){
  const start=Math.min(samples.length,Math.round(lead*rate)),floor=rms(samples,0,start),win=Math.max(1,Math.round(rate*0.02));
  let level=0,peak=0;
  for(let i=start;i+win<=samples.length;i+=win)level=Math.max(level,rms(samples,i,i+win));
  for(let i=start;i<samples.length;i++)peak=Math.max(peak,Math.abs(samples[i]));
  return {heard:level>Math.max(floor*factor,minLevel),level,floor,peak,sound:samples.slice(start)};
}

/** Play each number and record it. `play(n)` writes playSound; `mic` is from openMicrophone (or a test double). */
export async function dumpSounds({numbers,play,mic,seconds=3,lead=0.3,signal=null,onItem=()=>{},sleep=sleepMs}){
  for(const [i,number] of numbers.entries()){
    if(signal?.aborted)throw new Error('Dumper abgebrochen.');
    mic.start();await sleep(lead*1000);
    try{await play(number);}catch(e){mic.stop();throw e;}
    await sleep(seconds*1000);
    onItem({number,index:i,total:numbers.length,rate:mic.rate,...analyse(mic.stop(),mic.rate,{lead})});
  }
}

const CRC=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=CRC[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
/** Uncompressed ZIP of {name, data: Uint8Array} entries. */
export function makeZip(files){
  const enc=new TextEncoder(),parts=[],central=[];let offset=0;
  for(const {name,data}of files){
    const n=enc.encode(name),crc=crc32(data),head=new Uint8Array(30+n.length),v=new DataView(head.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,n.length,true);head.set(n,30);
    const dir=new Uint8Array(46+n.length),d=new DataView(dir.buffer);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,n.length,true);d.setUint32(42,offset,true);dir.set(n,46);
    parts.push(head,data);central.push(dir);offset+=head.length+data.length;
  }
  const size=central.reduce((s,c)=>s+c.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  const out=new Uint8Array(offset+size+22);let o=0;for(const p of [...parts,...central,end]){out.set(p,o);o+=p.length;}
  return out;
}
