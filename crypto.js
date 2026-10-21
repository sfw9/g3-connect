// Independent implementation of the documented Segway Encryption2 wire protocol.
export const bytes = (...parts) => Uint8Array.from(parts.flatMap(p => Array.from(p)));
export const hex = a => Array.from(a, n => n.toString(16).padStart(2,'0')).join('');
export function unhex(s) {
  if (!/^(?:[\da-f]{2})+$/i.test(s)) throw new Error('Ungültiges Hex-Format.');
  return Uint8Array.from(s.match(/../g), n => parseInt(n,16));
}
const pad = a => {const b = new Uint8Array(16); b.set(a.slice(0,16)); return b;};
const xor = (a,b) => a.map((n,i) => n ^ b[i]);
export const FW = unhex('97cfb802844143de56002b3b34780a5d');
export class Encryption2 {
  constructor(gen2=true) {this.staticInput=gen2?FW:new Uint8Array(16);this.auth=new Uint8Array(16);this.counter=0;this.lastRx=-1;this.sn=false;}
  async setKey(first,second=new Uint8Array(16)) {
    const raw = new Uint8Array(await crypto.subtle.digest('SHA-1',bytes(pad(first),pad(second)))).slice(0,16);
    this.key=await crypto.subtle.importKey('raw',raw,'AES-CBC',false,['encrypt']);
  }
  async block(input) {
    // First CBC block with zero IV is AES-ECB(input). Ignore WebCrypto's padding block.
    return new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv:new Uint8Array(16)},this.key,input)).slice(0,16);
  }
  nonce(counter) {return bytes([counter>>>24,(counter>>>16)&255,(counter>>>8)&255,counter&255],this.auth.slice(0,8),[0]);}
  async mac(plain,nonce) {
    let x=await this.block(bytes([0x59],nonce,[0,plain.length-3]));
    x=await this.block(xor(x,bytes(plain.slice(0,3),new Uint8Array(13))));
    for(let i=3;i<plain.length;i+=16) x=await this.block(xor(x,pad(plain.slice(i,i+16))));
    return x.slice(0,4);
  }
  async cryptPayload(payload,nonce) {
    let out=new Uint8Array(payload.length);
    for(let offset=0,idx=1;offset<payload.length;offset+=16,idx++) {
      const stream=await this.block(nonce?bytes([1],nonce,[0,idx]):this.staticInput);
      out.set(xor(payload.slice(offset,offset+16),stream),offset);
    }
    return out;
  }
  async encrypt(plain) {
    if(!this.sn) {
      const p=plain.slice(3),sum=(~p.reduce((a,b)=>a+b,0))&65535;
      return bytes(plain.slice(0,3),await this.cryptPayload(p,null),[0,0,sum&255,sum>>>8,0,0]);
    }
    if(this.counter>=65535) throw new Error('Sitzungszähler erschöpft. Bitte neu verbinden.');
    const ctr=++this.counter,nonce=this.nonce(ctr);
    const tag=xor(await this.mac(plain,nonce),(await this.block(bytes([1],nonce,[0,0]))).slice(0,4));
    return bytes(plain.slice(0,3),await this.cryptPayload(plain.slice(3),nonce),tag,[ctr>>>8,ctr&255]);
  }
  async decrypt(raw) {
    if(raw.length<13 || raw.length!==raw[2]+13 || raw[0]!==0x5a || ![0xa5,0xb5].includes(raw[1])) throw new Error('Ungültiger Frame.');
    const ctr=(raw.at(-2)<<8)|raw.at(-1),payload=raw.slice(3,-6);
    if(!ctr) {
      if(this.sn) throw new Error('Unverschlüsselter Sitzungsframe abgewiesen.');
      const p=await this.cryptPayload(payload,null),sum=(~p.reduce((a,b)=>a+b,0))&65535;
      if(raw.at(-6)!==0 || raw.at(-5)!==0 || raw.at(-4)!==(sum&255) || raw.at(-3)!==(sum>>>8)) throw new Error('Prüfsumme ungültig.');
      return bytes(raw.slice(0,3),p);
    }
    if(!this.sn || ctr<=this.lastRx) throw new Error('Wiederholter oder unerwarteter Frame.');
    const nonce=this.nonce(ctr),plain=bytes(raw.slice(0,3),await this.cryptPayload(payload,nonce));
    const tag=xor(await this.mac(plain,nonce),(await this.block(bytes([1],nonce,[0,0]))).slice(0,4));
    let diff=0;tag.forEach((n,i)=>diff|=n^raw[raw.length-6+i]);
    if(diff) throw new Error('Antwort konnte nicht authentifiziert werden.');
    // Ninebot uses a chained counter shared by incoming and outgoing frames.
    // The next TX must advance beyond the last verified vehicle counter.
    this.lastRx=ctr;this.counter=Math.max(this.counter,ctr);return plain;
  }
}
export function frame(board,cmd,index,payload=[],sync=0xa5) {
  if(payload.length>255) throw new Error('Payload zu lang.');
  return bytes([0x5a,sync,payload.length,0x3e,board,cmd,index],payload);
}
export class FrameBuffer {
  constructor(){this.buffer=new Uint8Array();}
  push(chunk) {
    this.buffer=bytes(this.buffer,chunk);const frames=[];
    while(this.buffer.length) {
      let pos=-1;
      for(let i=0;i<this.buffer.length-1;i++) if(this.buffer[i]===0x5a && [0xa5,0xb5].includes(this.buffer[i+1])) {pos=i;break;}
      if(pos<0){this.buffer=this.buffer.at(-1)===0x5a?Uint8Array.of(0x5a):new Uint8Array();break;}
      this.buffer=this.buffer.slice(pos);if(this.buffer.length<3) break;
      const length=this.buffer[2]+13;if(this.buffer.length<length)break;
      frames.push(this.buffer.slice(0,length));this.buffer=this.buffer.slice(length);
    }
    return frames;
  }
}
