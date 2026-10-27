// Web-Bluetooth-shaped shim over @capacitor-community/bluetooth-le.
//
// The whole app above this file (ninebot.js, crypto.js, profiles.js, the UI) only ever uses
// the Web Bluetooth GATT API. This shim presents exactly that shape — device → gatt → server
// → services → characteristics, with startNotifications / 'characteristicvaluechanged' /
// writeValue* — and translates each call into a BleClient call underneath. Nothing above it
// changes between the browser and the Android (Capacitor) build.
//
// The native plugin is dynamically imported on first real use (and injectable for tests), so
// importing this module costs nothing in a browser or under `npm test`.

let injectedClient=null;
// Tests inject a fake BleClient here; the app leaves it null and the real plugin loads lazily.
export function _injectBleClient(client){injectedClient=client;initialized=false;}

let clientPromise=null;
async function bleClient(){
  if(injectedClient)return injectedClient;
  // Pre-bundled plugin (npm run build:vendor → dist/vendor/bluetooth-le.js). A relative path
  // resolves in the Android WebView. Never reached in a browser (runtimeBluetooth() returns
  // native Web Bluetooth there) or in tests (the client is injected), so on web the vendor
  // bundle is never even fetched.
  if(!clientPromise)clientPromise=import('./vendor/bluetooth-le.js?v=1').then(m=>m.BleClient);
  return clientPromise;
}

let initialized=false;
async function ensureInitialized(client){
  if(initialized)return;
  // androidNeverForLocation keeps the BLE scan from pulling in the location permission.
  await client.initialize({androidNeverForLocation:true});
  initialized=true;
}

const toDataView=d=>d instanceof DataView?d:new DataView(d.buffer,d.byteOffset,d.byteLength);

// The native BleClient only accepts full 128-bit UUID strings. Web Bluetooth also accepts the
// Bluetooth SIG short names ('generic_access') and 16-/32-bit numbers, and ninebot.js passes
// 'generic_access' in optionalServices — so translate those forms to full UUIDs before handing
// them to the plugin. Anything already in 128-bit form is returned unchanged.
const NAMED_UUIDS={
  generic_access:'00001800-0000-1000-8000-00805f9b34fb',
  generic_attribute:'00001801-0000-1000-8000-00805f9b34fb',
  device_information:'0000180a-0000-1000-8000-00805f9b34fb',
  battery_service:'0000180f-0000-1000-8000-00805f9b34fb',
};
const expand=n=>`0000${n.toString(16).padStart(4,'0')}-0000-1000-8000-00805f9b34fb`;
function normalizeUuid(u){
  if(typeof u==='number')return expand(u);
  const s=String(u).toLowerCase();
  if(NAMED_UUIDS[s])return NAMED_UUIDS[s];
  if(/^0x[0-9a-f]+$/.test(s))return expand(parseInt(s,16));
  if(/^[0-9a-f]{4}$/.test(s))return `0000${s}-0000-1000-8000-00805f9b34fb`;
  if(/^[0-9a-f]{8}$/.test(s))return `${s}-0000-1000-8000-00805f9b34fb`;
  return s;
}

class ShimCharacteristic extends EventTarget {
  constructor(deviceId,serviceUuid,info,client){
    super();
    this.uuid=info.uuid;this.properties=info.properties||{};this.value=null;
    this._deviceId=deviceId;this._service=serviceUuid;this._client=client;this._notifying=false;
  }
  async startNotifications(){
    if(this._notifying)return this;this._notifying=true;
    await this._client.startNotifications(this._deviceId,this._service,this.uuid,dataView=>{
      this.value=dataView; // event.target.value, like Web Bluetooth.
      this.dispatchEvent(new Event('characteristicvaluechanged'));
    });
    return this;
  }
  async stopNotifications(){
    if(!this._notifying)return this;this._notifying=false;
    await this._client.stopNotifications(this._deviceId,this._service,this.uuid);return this;
  }
  async writeValueWithResponse(data){await this._client.write(this._deviceId,this._service,this.uuid,toDataView(data));}
  async writeValueWithoutResponse(data){await this._client.writeWithoutResponse(this._deviceId,this._service,this.uuid,toDataView(data));}
  async readValue(){const v=await this._client.read(this._deviceId,this._service,this.uuid);this.value=v;return v;}
}

class ShimService {
  constructor(deviceId,info,client){
    this.uuid=info.uuid;
    this._chars=(info.characteristics||[]).map(c=>new ShimCharacteristic(deviceId,info.uuid,c,client));
  }
  async getCharacteristics(){return this._chars;}
  async getCharacteristic(uuid){
    const want=String(uuid).toLowerCase();
    const found=this._chars.find(c=>c.uuid.toLowerCase()===want);
    if(!found)throw new Error(`Characteristic ${uuid} nicht gefunden.`);
    return found;
  }
}

// device.gatt IS the server in Web Bluetooth, so this one object carries connect/disconnect/
// connected and the service getters.
class ShimGatt {
  constructor(device,client){this._device=device;this._client=client;this.connected=false;this._services=null;}
  async connect(){
    await ensureInitialized(this._client);
    await this._client.connect(this._device._deviceId,()=>{
      this.connected=false;
      this._device.dispatchEvent(new Event('gattserverdisconnected'));
    });
    this.connected=true;
    return this;
  }
  async disconnect(){
    try{await this._client.disconnect(this._device._deviceId);}catch{/* already gone */}
    this.connected=false;
  }
  async _loadServices(){
    if(this._services)return this._services;
    const raw=await this._client.getServices(this._device._deviceId);
    this._services=raw.map(s=>new ShimService(this._device._deviceId,s,this._client));
    return this._services;
  }
  async getPrimaryServices(){return this._loadServices();}
  async getPrimaryService(uuid){
    // GAP ('generic_access') is usually not exposed over GATT on Android; throwing here lets
    // ninebot fall back to the advertised device name, exactly as it does in a browser that
    // blocks the GAP service.
    const want=normalizeUuid(uuid).toLowerCase();
    const found=(await this._loadServices()).find(s=>s.uuid.toLowerCase()===want);
    if(!found)throw new Error(`Service ${uuid} nicht gefunden.`);
    return found;
  }
}

class ShimDevice extends EventTarget {
  constructor(deviceId,name,client){
    super();
    this.id=deviceId;this._deviceId=deviceId;this.name=name||'';
    this.gatt=new ShimGatt(this,client);
  }
}

// Web Bluetooth filters are OR-ed and can't be expressed one-to-one in BleClient. Prefer a name
// prefix (G3 serials start with "1C") when present; otherwise fall back to a service filter.
function pickFilter(options){
  let namePrefix,services=new Set();
  for(const f of options.filters||[]){
    if(f.namePrefix&&!namePrefix)namePrefix=f.namePrefix;
    for(const s of f.services||[])services.add(normalizeUuid(s));
  }
  return {namePrefix,services:[...services]};
}

// The UI (dist/ui.js) injects a styled device chooser here. When one is present and the plugin
// can do a live scan, requestDevice runs requestLEScan and feeds the hits to it, instead of the
// plugin's plain native list dialog. Left null (browser, tests) → the native picker is used.
let devicePicker=null;
export function _setDevicePicker(picker){devicePicker=picker;}

// Drive a live LE scan and let the injected UI chooser pick the device. Resolves with a
// ShimDevice (same shape the native path returns), or rejects if the user cancels.
function scanAndPick(client,options,{namePrefix,services}){
  const scanOpts={allowDuplicates:false};
  if(!options.acceptAllDevices){
    if(namePrefix)scanOpts.namePrefix=namePrefix;
    else if(services.length)scanOpts.services=services;
  }
  return new Promise((resolve,reject)=>{
    let settled=false;
    const stop=()=>{try{client.stopLEScan();}catch{/* scan already stopped */}};
    devicePicker.open({
      all:!!options.acceptAllDevices,
      onSelect:(id,name)=>{if(settled)return;settled=true;stop();resolve(new ShimDevice(id,name,client));},
      onCancel:()=>{if(settled)return;settled=true;stop();reject(new DOMException('Es wurde kein Gerät ausgewählt.','NotFoundError'));},
    });
    Promise.resolve(client.requestLEScan(scanOpts,result=>{
      if(settled)return;
      const dev=result?.device||{};
      if(!dev.deviceId)return;
      devicePicker.add({id:dev.deviceId,name:dev.name||result.localName||'',rssi:result.rssi});
    })).catch(err=>{if(settled)return;settled=true;devicePicker.close();reject(err);});
  });
}

async function requestDevice(options={}){
  const client=await bleClient();
  await ensureInitialized(client);
  const {namePrefix,services}=pickFilter(options);

  // Preferred path on Android: our own scanning dialog over a live LE scan.
  if(devicePicker&&typeof client.requestLEScan==='function')return scanAndPick(client,options,{namePrefix,services});

  // Fallback: the plugin's built-in native device picker (and the browser never gets here).
  const req={};
  if(namePrefix)req.namePrefix=namePrefix;
  else if(services.length)req.services=services;
  if(options.optionalServices?.length)req.optionalServices=options.optionalServices.map(normalizeUuid);
  const picked=await client.requestDevice(req);
  return new ShimDevice(picked.deviceId,picked.name,client);
}

// Re-acquire a device the app was already connected to, via a fresh LE scan — no picker.
// The G3 will not answer a fresh PRE_COMM on a direct reconnect to the cached handle (the
// link and Nordic UART come back up, but the VCU stays silent); a scan re-discovers the
// scooter so the next connect lands on a responsive GATT server, exactly like requestDevice.
// Matches the previous device by its id first, then by advertised name, and after the window
// falls back to the known id so the recovery connect is still attempted.
async function reacquire(previousDevice,{timeoutMs=6000}={}){
  const client=await bleClient();
  await ensureInitialized(client);
  if(typeof client.requestLEScan!=='function')return previousDevice; // no scan support: nothing better to do
  const wantId=previousDevice?._deviceId||previousDevice?.id;
  const wantName=previousDevice?.name||'';
  return new Promise(resolve=>{
    let settled=false,timer;
    const finish=dev=>{
      if(settled)return;settled=true;clearTimeout(timer);
      try{client.stopLEScan();}catch{/* scan already stopped */}
      resolve(dev);
    };
    Promise.resolve(client.requestLEScan({allowDuplicates:false},result=>{
      const dev=result?.device||{};
      if(!dev.deviceId)return;
      if(dev.deviceId===wantId||(wantName&&(dev.name===wantName||result.localName===wantName)))
        finish(new ShimDevice(dev.deviceId,dev.name||result.localName||wantName,client));
    })).catch(()=>finish(new ShimDevice(wantId,wantName,client)));
    // Not seen again in the window (e.g. address rotated, or still settling): try the known id.
    timer=setTimeout(()=>finish(new ShimDevice(wantId,wantName,client)),timeoutMs);
  });
}

export const capacitorBluetooth={requestDevice,reacquire};
