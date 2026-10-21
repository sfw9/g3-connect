import {Encryption2,FW,frame,FrameBuffer,unhex} from './crypto.js?v=10';
import {encodeDistance,encodeInfo,encodeRoad} from './navigation.js?v=10';
export const NORDIC='6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const CUSTOM='6e400001-0000-0000-006e-696e65626f74';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export class Ninebot {
  constructor(log=()=>{},status=()=>{},onPairingKey=()=>{}) {this.log=log;this.status=status;this.onPairingKey=onPairingKey;this.pending=null;this.authenticated=false;this.listeners=[];this.rxChain=Promise.resolve();this.buffer=new FrameBuffer();this.session=0;}
  async choose(all=false) {
    // Ninebot scooters are matched by their BLE services; '1C' is the G3 serial prefix.
    // Other models with the same dashboard (e.g. F3 Pro D / F3 D) may advertise neither,
    // so the user can fall back to listing every device.
    const optionalServices=[NORDIC,CUSTOM,'generic_access'];
    this.device=await navigator.bluetooth.requestDevice(all?{acceptAllDevices:true,optionalServices}:{filters:[{services:[NORDIC]},{services:[CUSTOM]},{namePrefix:'1C'}],optionalServices});
    return this.device;
  }
  async connect(passwordHex='',nameOverride='',{forcePairing=false}={}) {
    this.cancelled=false;
    try {return await this.connectOnce(forcePairing?'':passwordHex,nameOverride);}
    catch(e) {
      if(e.code!=='PAIRING_RESTART_REQUIRED' || this.cancelled)throw e;
      // AUTH has already changed the cipher and consumed counters. Never send
      // SET_PWD in that session, even if GATT still looks connected.
      this.log('Gespeicherte Kopplung konnte nicht bestätigt werden. GATT und Handshake für eine neue Power-Kopplung neu starten.');
      await this.closeForReconnect();
      if(this.cancelled)throw new Error('Kopplung abgebrochen.');
      this.status('Neue Kopplung vorbereiten …');
      // Exactly one recovery attempt; no stored key and no reconnect loop.
      return this.connectOnce('',nameOverride);
    }
  }
  async closeForReconnect() {
    const gatt=this.device.gatt,wasConnected=!!this.server?.connected;
    this.cleanup();
    if(!wasConnected)return;
    // Wait for the old disconnect event before installing a fresh listener;
    // otherwise a queued event can tear down the new connection.
    await new Promise(resolve=>{
      let timer;
      const done=()=>{clearTimeout(timer);this.device.removeEventListener('gattserverdisconnected',done);resolve();};
      this.device.addEventListener('gattserverdisconnected',done);
      timer=setTimeout(done,1000);
      try {gatt.disconnect();}catch{done();}
    });
  }
  async connectOnce(passwordHex='',nameOverride='') {
    this.closed=false;
    const epoch=++this.session;
    this.disconnectHandler=()=>this.cleanup();
    this.device.addEventListener('gattserverdisconnected',this.disconnectHandler);
    this.log('GATT-Verbindung starten.');
    this.server=await this.device.gatt.connect();
    this.log('GATT verbunden.');
    if(this.session!==epoch) throw new Error('Verbindung abgebrochen.');
    const services=await this.server.getPrimaryServices();
    this.log(`GATT-Services: ${services.map(s=>s.uuid).join(', ')}`);
    this.channels=new Map();
    for(const service of services.filter(s=>[NORDIC,CUSTOM].includes(s.uuid))) {
      const chars=await service.getCharacteristics();
      for(const ch of chars) {
        this.channels.set(ch.uuid,ch);
        this.log(`Characteristic ${ch.uuid}: write=${!!ch.properties.write}, writeWithoutResponse=${!!ch.properties.writeWithoutResponse}, notify=${!!ch.properties.notify}, indicate=${!!ch.properties.indicate}.`);
        if(ch.properties.notify || ch.properties.indicate) {
          const handler=event=> {
            const data=new Uint8Array(event.target.value.buffer,event.target.value.byteOffset,event.target.value.byteLength).slice();
            this.log(`GATT RX: ${data.length} Bytes auf ${ch.uuid=== '6e400003-b5a3-f393-e0a9-e50e24dcca9e'?'Nordic UART':'Ninebot GATT'}.`);
            const packets=this.buffer.push(data);
            this.rxChain=this.rxChain.then(async()=>{for(const p of packets) {
              if(epoch!==this.session) return;
              try {
                const decoded=await this.cipher.decrypt(p);
                const pending=this.pending;
                this.log(`RX bestätigt: Board 0x${decoded[3].toString(16)} → 0x${decoded[4].toString(16)}, Befehl 0x${decoded[5].toString(16)}, Index/Status ${decoded[6]}, Datenlänge ${decoded.length-7}, Zähler ${this.cipher.lastRx}.`);
                const sourceMatches=pending && (decoded[3]===pending.board || pending.expect===0x5b && [4,0x21].includes(decoded[3]));
                if(sourceMatches && decoded[4]===0x3e && decoded[5]===pending.expect && (pending.index===null || decoded[6]===pending.index) && (pending.acceptIndex===null || decoded[6]===pending.acceptIndex)) {
                  this.pending=null;clearTimeout(pending.timer);pending.resolve({board:decoded[3],index:decoded[6],payload:decoded.slice(7)});
                }else if(pending?.expect===0x71){
                  this.log(`Navigation: verifizierte Antwort passt nicht zur offenen Startanfrage; erwartet Board 0x${pending.board.toString(16)}, Befehl 0x71, Index ${pending.index}. Weiter auf passende Bestätigung warten.`);
                }
              } catch(e) {this.log(`RX verworfen: ${e.message}`);}
            }}).catch(()=>this.log('Fehler beim Verarbeiten einer Antwort.'));
          };
          ch.addEventListener('characteristicvaluechanged',handler);this.listeners.push([ch,handler]);await ch.startNotifications();this.log(`Notifications aktiv: ${ch.uuid}.`);
        }
      }
    }
    let name=nameOverride.trim() || this.device.name || '';
    if(!nameOverride.trim())try {
      const s=await this.server.getPrimaryService('generic_access'),ch=await s.getCharacteristic('gap.device_name');
      name=decoder.decode(await ch.readValue()).replaceAll('\0','').trim() || name;
    }catch{/* Some browsers block the GAP service; advertised name remains available. */}
    if(!name) throw new Error('Gerätename fehlt. Trage den vollständigen Bluetooth-Namen ein.');
    this.deviceName=name;
    this.status('Authentifizierung läuft …');
    // G3 confirmed in ha-ninebot uses Gen2/Nordic; try documented Gen3 only if no PRE_COMM response.
    const options=[{gen2:true,sync:0xa5,write:'6e400002-b5a3-f393-e0a9-e50e24dcca9e'}, {gen2:false,sync:0xb5,write:'6e400002-0000-0000-006e-696e65626f74'}];
    let pre;
    for(const opt of options) {
      const ch=this.channels.get(opt.write);if(!ch)continue;
      for(const response of [false,true]) {
        if(response?!ch.properties.write:!ch.properties.writeWithoutResponse)continue;
        await this.rxChain;
        this.buffer=new FrameBuffer();this.cipher=new Encryption2(opt.gen2);this.sync=opt.sync;this.writeChar=ch;this.response=response;
        await this.cipher.setKey(encoder.encode(name),opt.gen2?FW:undefined);
        this.log(`PRE_COMM versuchen: ${opt.gen2?'Gen2/Nordic':'Gen3/Ninebot'}, ATT ${response?'mit':'ohne'} Antwort.`);
        try {pre=await this.request(4,0x5b,0,[],0x5b,null,3000);this.generation=opt.gen2?'Encryption2 · Nordic UART':'Encryption2 · Ninebot GATT';break;}
        catch(e){this.log(`PRE_COMM-Versuch gescheitert: ${e.message}`);if(!this.server?.connected || this.session!==epoch)throw e;}
      }
      if(pre)break;
    }
    if(!pre)throw new Error('Keine Handshake-Antwort. Segway-App vollständig schließen, Roller einschalten und vollständigen Bluetooth-Namen prüfen. Die Firmware könnte ein anderes Protokoll verwenden.');
    if(pre.payload.length<30)throw new Error('Handshake-Antwort ist zu kurz.');
    this.bleBoard=pre.board || 4;this.serialBytes=pre.payload.slice(16,30);
    this.cipher.auth=pre.payload.slice(0,16);this.serial=decoder.decode(this.serialBytes).replaceAll('\0','');
    this.log(`PRE_COMM erfolgreich: BLE-Board 0x${this.bleBoard.toString(16)}, Kopplungsflag ${pre.index}.`);
    this.cipher.sn=true;this.cipher.counter=1;
    await this.finishHandshake(name,pre,passwordHex,epoch);
    return this;
  }
  async finishHandshake(name,pre,passwordHex='',epoch=this.session) {
    let password=passwordHex?unhex(passwordHex):null;
    if(password && password.length!==16)throw new Error('Der Pairing-Schlüssel braucht genau 32 Hex-Zeichen.');
    // A stored-password flag does not prevent a new owner-confirmed pairing.
    // A failed AUTH must recover in a new GATT connection, not under its cipher.
    if(password && pre.index!==0) {
      try {
        await this.authenticate(password,epoch);
        this.log('Vorhandene Browser-Kopplung wiederverwendet.');
        return;
      } catch(e) {
        if(this.cancelled)throw e;
        const error=new Error(`Gespeicherte Kopplung nicht bestätigt: ${e.message}`,{cause:e});
        error.code='PAIRING_RESTART_REQUIRED';throw error;
      }
    }
    password=await this.registerPassword(name,epoch);
    await this.authenticate(password,epoch);
  }
  async registerPassword(name,epoch=this.session,{timeout=60000,retryDelay=500}={}) {
    const password=crypto.getRandomValues(new Uint8Array(16));
    await this.cipher.setKey(encoder.encode(name),this.cipher.auth);
    this.log('Neuen Pairing-Schlüssel erzeugt. Durchgehend auf Power-Bestätigung hören.');
    const deadline=Date.now()+timeout;
    const showWait=()=>this.status(`Power-Taste am Roller kurz drücken · ${Math.max(0,Math.ceil((deadline-Date.now())/1000))} s`);
    showWait();const ticker=setInterval(showWait,1000);
    try {
      // One waiter stays installed for the whole pairing window, including pauses
      // between TX attempts. Index 0 acknowledges receipt; only index 1 completes pairing.
      await this.request(this.bleBoard||4,0x5c,0,password,0x5c,null,timeout,{repeatMs:Math.max(1,retryDelay),acceptIndex:1});
      if(epoch!==this.session || !this.server?.connected)throw new Error('Kopplung abgebrochen.');
      this.newPassword=password;this.onPairingKey(password);
      this.log('Power-Bestätigung vom Roller erhalten. Pairing-Schlüssel akzeptiert.');
      return password;
    } catch(e) {
      if(e.message.startsWith('Keine Antwort'))throw new Error('Die Power-Bestätigung ist nicht angekommen. Das Protokoll zeigt, ob der Roller antwortet oder ob Antworten verworfen werden. Erneut verbinden; bei weiterhin ausbleibender Bestätigung die Diagnose herunterladen.');
      throw e;
    } finally {clearInterval(ticker);}
  }
  async authenticate(password,epoch=this.session) {
    await this.cipher.setKey(password,this.cipher.auth);
    const sn=this.serialBytes || new Uint8Array(14);
    if(!this.serialBytes)sn.set(encoder.encode(this.serial).slice(0,14));
    this.status('Sitzung authentifizieren …');
    const auth=await this.request(this.bleBoard||4,0x5d,0,sn,0x5d,null,10000,{repeatMs:500,acceptIndex:1});
    if(epoch!==this.session || !this.server?.connected)throw new Error('Verbindung abgebrochen.');
    if(auth.index!==1)throw new Error('Der Roller hat die Authentifizierung abgelehnt. Bitte erneut koppeln.');
    this.authenticated=true;this.log('Verschlüsselte Sitzung hergestellt.');
  }
  async request(board,cmd,index,payload,expect,matchIndex=index,timeout=3500,{repeatMs=0,acceptIndex=null}={}) {
    if(this.pending || this.requestBusy)throw new Error('Eine Anfrage läuft bereits.');
    this.requestBusy=true;const epoch=this.session;
    let operation,writer;
    const reply=new Promise((resolve,reject)=>{
      const finish=(fn,value)=>{if(operation.done)return;operation.done=true;clearTimeout(operation.timer);if(this.pending===operation)this.pending=null;fn(value);};
      operation={board,expect,index:matchIndex,acceptIndex,done:false,
        resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)};
      operation.timer=setTimeout(()=>operation.reject(new Error(`Keine Antwort auf Befehl 0x${cmd.toString(16)}, Register 0x${index.toString(16)}.`)),timeout);
      this.pending=operation;
    });
    // Catch immediately so a disconnect during a slow write cannot produce an
    // unhandled rejection. The reply is still awaited below for its real result.
    const settled=reply.catch(()=>{});
    try {
      writer=(async()=>{
        do {
          // Process queued RX first, so encryption uses the latest chained counter.
          await this.rxChain;
          if(operation.done)return;
          if(epoch!==this.session || !this.server?.connected)throw new Error('Bluetooth-Verbindung getrennt.');
          const wire=await this.cipher.encrypt(frame(board,cmd,index,payload,this.sync));
          if(operation.done)return;
          this.log(`GATT TX: Board 0x${board.toString(16)}, Befehl 0x${cmd.toString(16)}, Index 0x${index.toString(16)}, ${wire.length} Bytes, Zähler ${(wire.at(-2)<<8)|wire.at(-1)}.`);
          try {
            if(this.response)await this.writeChar.writeValueWithResponse(wire);
            else await this.writeChar.writeValueWithoutResponse(wire);
          } catch(e) {throw new Error(`GATT-Schreiben fehlgeschlagen: ${e.message}. Die Anmeldung benötigt bis zu 29 Bytes in einem ATT-Schreibvorgang.`);}
          if(!repeatMs || operation.done)return;
          await Promise.race([sleep(repeatMs),settled]);
        } while(!operation.done);
      })().catch(e=>operation.reject(e));
      const response=await reply;
      await writer;
      return response;
    } finally {
      await writer;
      clearTimeout(operation.timer);
      if(this.pending===operation)this.pending=null;
      this.requestBusy=false;
    }
  }
  async read(board,index) {
    if(!this.authenticated)throw new Error('Keine authentifizierte Verbindung.');
    const r=await this.request(board,1,index,[2],4);
    if(r.payload.length!==2)throw new Error('Unerwartete Registerlänge.');
    return r.payload[0]|r.payload[1]<<8;
  }
  async writeNoReply(board,index,value) {
    return this.sendUnacknowledged(board,3,index,[value&255,value>>>8]);
  }
  async sendUnacknowledged(board,cmd,index,payload) {
    if(!this.authenticated)throw new Error('Zuerst verbinden.');
    if(this.pending || this.requestBusy)throw new Error('Eine Anfrage läuft bereits.');
    this.requestBusy=true;const epoch=this.session;
    try {
      await this.rxChain;
      if(epoch!==this.session || !this.authenticated || !this.server?.connected)throw new Error('Bluetooth-Verbindung getrennt.');
      const wire=await this.cipher.encrypt(frame(board,cmd,index,payload,this.sync));
      if(epoch!==this.session || !this.authenticated || !this.server?.connected)throw new Error('Bluetooth-Verbindung getrennt.');
      this.log(`GATT TX: Board 0x${board.toString(16)}, Befehl 0x${cmd.toString(16)}, Index 0x${index.toString(16)}, ${wire.length} Bytes, Zähler ${(wire.at(-2)<<8)|wire.at(-1)}. Ohne Protokoll-ACK.`);
      if(this.response)await this.writeChar.writeValueWithResponse(wire);
      else await this.writeChar.writeValueWithoutResponse(wire);
      if(epoch!==this.session || !this.authenticated)throw new Error('Bluetooth-Verbindung getrennt.');
    } finally {this.requestBusy=false;}
  }
  async startNavigation() {
    if(!this.authenticated)throw new Error('Zuerst verbinden.');
    if(await this.read(0x16,0x57)!==0)throw new Error('Navigation im Stillstand starten.');
    // G3 config: TFT command 0x71, index 0, reply 0x71/0.
    // Manufacturer APK: ScreenCastType.SimpleNavi=1; Companion.start sends
    // exactly one byte (type.value). Cruise=3 requires a different display mode.
    this.log('Navigation: Pfeilnavigation starten, TFT 0x23 / 0x71 / 0x00, SimpleNavi 1, Nutzlast 01 (1 Byte).');
    let r;
    try{r=await this.request(0x23,0x71,0,[1],0x71,0,4000);}
    catch(e){throw new Error(`Navigationsstart nicht bestätigt. Es wurden noch keine Abbiegedaten gesendet. Ein Startton reicht als Bestätigung nicht aus. ${e.message}`);}
    this.navigationStarted=true;
    this.log(`Navigation: Startantwort empfangen (${r.payload.length} Datenbytes). Das bestätigt noch keine sichtbare Anzeige.`);
  }
  async updateNavigation(state,{total,initial=false}={}) {
    if(!this.navigationStarted)throw new Error('Display-Navigation wurde nicht gestartet.');
    // No VCU/motor writes: all navigation data goes to the TFT board.
    const packets=[];
    if(initial)packets.push([1,encodeDistance(total)]);
    if(initial||this.navCurrentRoad!==state.currentRoad)packets.push([0x10,encodeRoad(state.currentRoad)]);
    if(initial||this.navNextRoad!==state.nextRoad)packets.push([0x24,encodeRoad(state.nextRoad)]);
    packets.push([3,encodeInfo(state)]);
    for(const [index,payload]of packets) {
      if(!this.navigationStarted)throw new Error('Navigation beendet.');
      await this.sendUnacknowledged(0x23,0x71,index,payload);
    }
    if(initial)this.log('Navigation: vollständiger Datensatz an TFT gesendet (Distanz 4 B, aktuelle/nächste Straße, Info 18 B). Ohne Protokollbestätigung; sichtbare Wirkung offen.');
    this.navCurrentRoad=state.currentRoad;this.navNextRoad=state.nextRoad;
  }
  async stopNavigation() {
    if(!this.navigationStarted)return;
    this.navigationStarted=false;
    if(this.authenticated){
      // Manufacturer DashNaviDataMessenger.stopNavi: setNaviStart, one byte 0.
      await this.request(0x23,0x71,0,[0],0x71,0,4000);
      this.log('Navigation: Stopp 00 (1 Byte) vom TFT bestätigt.');
    }
  }
  async readRangeDisplay() {
    // Official G3 package 10258, device_ui_set_dashboard: preference bit 4,
    // visibility gate bit 6. The latter is not a firmware-version comparison.
    const capabilities=await this.read(0x16,0x32);
    const preference=await this.read(0x16,0x2f);
    const result={enabled:!!(preference&0x10),advertised:!!(capabilities&0x40),preference,capabilities};
    this.log(`Reichweitenanzeige: ${result.enabled?'ein':'aus'}; rFunBool4=0x${preference.toString(16).padStart(4,'0')}; rFunDisplayBool4=0x${capabilities.toString(16).padStart(4,'0')}; Segway-Schalter ${result.advertised?'sichtbar':'ausgeblendet'}.`);
    return result;
  }
  async setRangeDisplay(enabled) {
    if(typeof enabled!=='boolean')throw new Error('Reichweitenanzeige braucht Ein oder Aus.');
    if(!this.authenticated)throw new Error('Zuerst verbinden.');
    if(await this.read(0x16,0x57)!==0)throw new Error('Der Roller muss zum Ändern stillstehen.');
    // Fresh read-modify-write: never reuse a cached word or change capability flags.
    const before=await this.readRangeDisplay();
    const wanted=enabled?before.preference|0x10:before.preference&~0x10;
    if(wanted===before.preference){this.log('Reichweitenanzeige bereits so eingestellt. Kein Schreibbefehl gesendet.');return before;}
    this.log(`Reichweitenanzeige schreiben: rFunBool4 0x${before.preference.toString(16).padStart(4,'0')} → 0x${wanted.toString(16).padStart(4,'0')}; ausschließlich Maske 0x0010.`);
    await this.writeNoReply(0x16,0x2f,wanted);
    let actual;
    for(let attempt=0;attempt<4;attempt++) {
      if(attempt)await sleep(100);
      actual=await this.read(0x16,0x2f);
      if(actual===wanted) {
        this.log(`Reichweitenanzeige ${enabled?'ein':'aus'}: Registerwert durch Rücklesen bestätigt. Sichtbare Wirkung am Roller prüfen.`);
        return {...before,enabled,preference:actual};
      }
    }
    throw new Error(`Reichweitenanzeige nicht bestätigt: erwartet 0x${wanted.toString(16).padStart(4,'0')}, gelesen 0x${actual.toString(16).padStart(4,'0')}. Kein erneuter Schreibversuch.`);
  }
  async readDisplayDiagnostics() {
    if(!this.authenticated)throw new Error('Zuerst verbinden.');
    const result={capturedAt:new Date().toISOString(),generation:this.generation,firmware:{},registers:{},errors:[]};
    // Documented G3 reads only. Do not read pairing keys, PINs or identifiers.
    const fields=[
      ['firmware','ble',this.bleBoard||4,0x01],['firmware','vcu',0x16,0x17],['firmware','mcu',0x16,0x18],
      ['registers','rFunBool',0x16,0x1d],['registers','rFunBool2',0x16,0x1e],['registers','rFunBool3',0x16,0x1f],
      ['registers','rFunBool4',0x16,0x2f],['registers','rInstumentKey',0x16,0x2e],
      ['registers','rFunDisplayBool',0x16,0x1b],['registers','rFunDisplayBool2',0x16,0x30],
      ['registers','rFunDisplayBool3',0x16,0x31],['registers','rFunDisplayBool4',0x16,0x32],['registers','rFunDisplayBool5',0x16,0x33]
    ];
    for(const [group,name,board,index]of fields) {
      if(!this.authenticated)throw new Error('Verbindung während der Display-Diagnose getrennt.');
      try {
        const value=await this.read(board,index),word='0x'+value.toString(16).padStart(4,'0');
        result[group][name]={board:'0x'+board.toString(16),register:'0x'+index.toString(16),value,hex:word};
        this.log(`Display-Diagnose ${name}: ${word}.`);
      } catch(e) {
        if(!this.authenticated)throw e;
        result.errors.push({name,message:e.message});this.log(`Display-Diagnose ${name} nicht verfügbar: ${e.message}`);
      }
    }
    this.log('Display-Diagnose beendet. Es wurden keine Einstellungen geschrieben.');
    return result;
  }
  async readAcceleration(){return this.read(0x16,0x6e);}
  async setAcceleration(level) {
    if(![1,2,3].includes(level))throw new Error('Nur Stufen 1–3 werden unterstützt.');
    if(!this.authenticated)throw new Error('Zuerst verbinden.');
    const speed=await this.read(0x16,0x57);
    if(speed!==0)throw new Error('Der Roller muss zum Ändern stillstehen.');
    const before=await this.readAcceleration();
    if(![1,2,3].includes(before))throw new Error('Unbekanntes Registerformat. Schreiben gesperrt.');
    if(before===level)return level;
    await this.request(0x16,2,0x6e,[level,0],5);
    const after=await this.readAcceleration();
    if(after!==level)throw new Error(`Änderung nicht bestätigt (Rücklesewert ${after}). Kein Erfolg gemeldet.`);
    this.log(`Beschleunigungsstufe ${level} geschrieben und durch Rücklesen bestätigt.`);return after;
  }
  cleanup() {
    if(this.closed)return;
    this.closed=true;
    this.session++;this.authenticated=false;this.navigationStarted=false;this.navCurrentRoad=null;this.navNextRoad=null;
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('Bluetooth-Verbindung getrennt.'));this.pending=null;}
    for(const [ch,handler]of this.listeners)ch.removeEventListener('characteristicvaluechanged',handler);
    this.listeners=[];if(this.device&&this.disconnectHandler)this.device.removeEventListener('gattserverdisconnected',this.disconnectHandler);
    this.cipher=null;this.buffer=new FrameBuffer();this.status('Getrennt');
  }
  disconnect(){this.cancelled=true;this.cleanup();this.device?.gatt?.disconnect();}
}
