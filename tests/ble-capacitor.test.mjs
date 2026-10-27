import test from 'node:test';
import assert from 'node:assert/strict';
import {capacitorBluetooth,_injectBleClient,_setDevicePicker} from '../dist/ble-capacitor.js?v=3';

const NORDIC='6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const WRITE='6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NOTIFY='6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const GENERIC_ACCESS='00001800-0000-1000-8000-00805f9b34fb';

// A fake @capacitor-community/bluetooth-le BleClient: records what the shim asks of it and
// lets the test drive an incoming notification / disconnect. The point of the suite is to
// prove the shim presents the SAME Web Bluetooth GATT shape that ninebot.js (and the existing
// simulated-GATT tests) rely on, translated onto these BleClient calls.
function fakeBleClient(){
  const calls=[];
  let notify=null,onDisconnect=null;
  return {
    calls,
    async initialize(opts){calls.push(['initialize',opts]);},
    async requestDevice(req){calls.push(['requestDevice',req]);return {deviceId:'AA:BB',name:'1CGBC2510C0000'};},
    async connect(id,cb){calls.push(['connect',id]);onDisconnect=cb;},
    async disconnect(id){calls.push(['disconnect',id]);},
    async getServices(id){calls.push(['getServices',id]);return [
      {uuid:NORDIC,characteristics:[
        {uuid:WRITE,properties:{write:true,writeWithoutResponse:true}},
        {uuid:NOTIFY,properties:{notify:true}},
      ]},
    ];},
    async startNotifications(id,svc,ch,cb){calls.push(['startNotifications',svc,ch]);notify=cb;},
    async stopNotifications(id,svc,ch){calls.push(['stopNotifications',svc,ch]);},
    async write(id,svc,ch,value){calls.push(['write',svc,ch,value]);},
    async writeWithoutResponse(id,svc,ch,value){calls.push(['writeWithoutResponse',svc,ch,value]);},
    async read(id,svc,ch){calls.push(['read',svc,ch]);return new DataView(Uint8Array.of(0x31,0x43).buffer);},
    fire(bytes){notify(new DataView(Uint8Array.from(bytes).buffer));},
    drop(){onDisconnect&&onDisconnect();},
  };
}

test('shim presents a Web-Bluetooth GATT shape over BleClient',async()=>{
  const client=fakeBleClient();_injectBleClient(client);

  // 1. requestDevice: the G3 name prefix is forwarded; optionalServices are normalized to full
  //    128-bit UUIDs (BleClient rejects SIG short names like 'generic_access').
  const device=await capacitorBluetooth.requestDevice({
    filters:[{services:[NORDIC]},{namePrefix:'1C'}],
    optionalServices:[NORDIC,'generic_access'],
  });
  const req=client.calls.find(c=>c[0]==='requestDevice')[1];
  assert.equal(req.namePrefix,'1C','name prefix wins over service filter for the picker');
  assert.deepEqual(req.optionalServices,[NORDIC,GENERIC_ACCESS]);
  assert.equal(device.id,'AA:BB');
  assert.equal(device.name,'1CGBC2510C0000');

  // 2. gatt.connect() returns a server; .connected flips true (ninebot reads it on every TX).
  const server=await device.gatt.connect();
  assert.equal(server.connected,true);
  assert.equal(server,device.gatt,'device.gatt is the server, as in Web Bluetooth');

  // 3. getPrimaryServices() -> services with .uuid; getCharacteristics() -> chars with
  //    .uuid and a .properties object.
  const services=await server.getPrimaryServices();
  assert.deepEqual(services.map(s=>s.uuid),[NORDIC]);
  const chars=await services[0].getCharacteristics();
  assert.deepEqual(chars.map(c=>c.uuid),[WRITE,NOTIFY]);
  const writeChar=chars.find(c=>c.properties.write),notifyChar=chars.find(c=>c.properties.notify);
  assert.ok(writeChar&&notifyChar);

  // 4. startNotifications + 'characteristicvaluechanged' delivers a DataView at event.target.value,
  //    exactly how ninebot.js reads incoming frames.
  let received=null;
  notifyChar.addEventListener('characteristicvaluechanged',e=>{
    received=new Uint8Array(e.target.value.buffer,e.target.value.byteOffset,e.target.value.byteLength).slice();
  });
  await notifyChar.startNotifications();
  client.fire([0x5a,0xa5,0x03]);
  assert.deepEqual([...received],[0x5a,0xa5,0x03]);

  // 5. writeValueWithResponse / writeValueWithoutResponse pass a DataView through to BleClient.
  await writeChar.writeValueWithResponse(Uint8Array.of(1,2,3,4));
  await writeChar.writeValueWithoutResponse(Uint8Array.of(5,6));
  const w=client.calls.find(c=>c[0]==='write'),wo=client.calls.find(c=>c[0]==='writeWithoutResponse');
  assert.equal(w[1],NORDIC);assert.equal(w[2],WRITE);
  assert.ok(w[3] instanceof DataView);assert.deepEqual([...new Uint8Array(w[3].buffer)],[1,2,3,4]);
  assert.ok(wo[3] instanceof DataView);assert.deepEqual([...new Uint8Array(wo[3].buffer)],[5,6]);

  // 6. a BleClient disconnect raises 'gattserverdisconnected' and clears .connected,
  //    which is ninebot's cleanup trigger.
  let dropped=false;device.addEventListener('gattserverdisconnected',()=>{dropped=true;});
  client.drop();
  assert.equal(dropped,true);
  assert.equal(server.connected,false);
});

test('generic_access is reported missing so the caller uses the advertised name',async()=>{
  const client=fakeBleClient();_injectBleClient(client);
  const device=await capacitorBluetooth.requestDevice({filters:[{namePrefix:'1C'}]});
  const server=await device.gatt.connect();
  await assert.rejects(()=>server.getPrimaryService('generic_access'),/nicht gefunden/);
});

test('acceptAllDevices path sends no name/service filter',async()=>{
  const client=fakeBleClient();_injectBleClient(client);
  await capacitorBluetooth.requestDevice({acceptAllDevices:true,optionalServices:[NORDIC]});
  const req=client.calls.find(c=>c[0]==='requestDevice')[1];
  assert.equal(req.namePrefix,undefined);
  assert.equal(req.services,undefined);
  assert.deepEqual(req.optionalServices,[NORDIC]);
});

// When the UI injects a device picker and the plugin can scan, requestDevice runs a live LE scan
// and hands the hits to the picker instead of popping the plugin's native list dialog.
function scanningClient(){
  const calls=[];let scanCb=null;
  return {
    calls,
    async initialize(opts){calls.push(['initialize',opts]);},
    async requestLEScan(opts,cb){calls.push(['requestLEScan',opts]);scanCb=cb;},
    async stopLEScan(){calls.push(['stopLEScan']);},
    async requestDevice(req){calls.push(['requestDevice',req]);return {deviceId:'NATIVE',name:'x'};},
    advertise(r){scanCb(r);},
  };
}

test('an injected picker drives a LE scan and resolves the chosen device',async()=>{
  const client=scanningClient();_injectBleClient(client);
  let handlers=null;const added=[];
  _setDevicePicker({
    open(h){handlers=h;},
    add(d){added.push(d);},
    close(){this.closed=true;},
  });
  const pending=capacitorBluetooth.requestDevice({filters:[{services:[NORDIC]},{namePrefix:'1C'}],optionalServices:[NORDIC]});
  await new Promise(r=>setTimeout(r,0)); // flush the shim's init + scan start
  const scan=client.calls.find(c=>c[0]==='requestLEScan')[1];
  assert.equal(scan.namePrefix,'1C','name prefix drives the scan filter');
  assert.ok(!client.calls.some(c=>c[0]==='requestDevice'),'native picker is not used when a scanner is injected');
  client.advertise({device:{deviceId:'AA:BB',name:'1CGBC2510C0000'},rssi:-47});
  client.advertise({device:{deviceId:'AA:BB',name:'1CGBC2510C0000'},rssi:-44}); // same device updates, no dupe downstream contract
  assert.deepEqual(added[0],{id:'AA:BB',name:'1CGBC2510C0000',rssi:-47});
  handlers.onSelect('AA:BB','1CGBC2510C0000');
  const device=await pending;
  assert.equal(device.id,'AA:BB');
  assert.equal(device.name,'1CGBC2510C0000');
  assert.ok(client.calls.some(c=>c[0]==='stopLEScan'),'the scan is stopped once a device is picked');
  _setDevicePicker(null);
});

test('cancelling the picker rejects requestDevice and stops the scan',async()=>{
  const client=scanningClient();_injectBleClient(client);
  let handlers=null;
  _setDevicePicker({open(h){handlers=h;},add(){},close(){}});
  const pending=capacitorBluetooth.requestDevice({filters:[{namePrefix:'1C'}]});
  await new Promise(r=>setTimeout(r,0));
  handlers.onCancel();
  await assert.rejects(()=>pending,/kein Gerät/i);
  assert.ok(client.calls.some(c=>c[0]==='stopLEScan'));
  _setDevicePicker(null);
});

// reacquire re-discovers a known device with a fresh LE scan (no picker) so the recovery
// re-pair connects to a responsive GATT server, like requestDevice — a direct reconnect to the
// cached handle never gets the G3 to answer PRE_COMM.
test('reacquire re-scans and resolves a fresh handle for the same device by id',async()=>{
  const client=scanningClient();_injectBleClient(client);
  const previous={_deviceId:'AA:BB',name:'1CGBC2510C0000'};
  const pending=capacitorBluetooth.reacquire(previous,{timeoutMs:1000});
  await new Promise(r=>setTimeout(r,0)); // flush init + scan start
  assert.ok(client.calls.some(c=>c[0]==='requestLEScan'),'a live scan is started');
  client.advertise({device:{deviceId:'CC:DD',name:'somethingelse'},rssi:-60}); // ignored: wrong device
  client.advertise({device:{deviceId:'AA:BB',name:'1CGBC2510C0000'},rssi:-50});
  const device=await pending;
  assert.equal(device.id,'AA:BB');
  assert.equal(device.name,'1CGBC2510C0000');
  assert.ok(device.gatt,'returns a Web-Bluetooth-shaped device with a fresh gatt');
  assert.ok(client.calls.some(c=>c[0]==='stopLEScan'),'the scan is stopped once matched');
});

test('reacquire matches by advertised name when the device id has rotated',async()=>{
  const client=scanningClient();_injectBleClient(client);
  const previous={_deviceId:'OLD:ID',name:'1CGBC2510C0000'};
  const pending=capacitorBluetooth.reacquire(previous,{timeoutMs:1000});
  await new Promise(r=>setTimeout(r,0));
  client.advertise({device:{deviceId:'NEW:ID',name:'1CGBC2510C0000'},rssi:-55});
  const device=await pending;
  assert.equal(device.id,'NEW:ID','a rotated address is picked up by the matching name');
  assert.equal(device.name,'1CGBC2510C0000');
});

test('reacquire falls back to the known id if the device is not seen in the window',async()=>{
  const client=scanningClient();_injectBleClient(client);
  const previous={_deviceId:'AA:BB',name:'1CGBC2510C0000'};
  const device=await capacitorBluetooth.reacquire(previous,{timeoutMs:20});
  assert.equal(device.id,'AA:BB','still attempts the recovery connect on the known id');
  assert.ok(client.calls.some(c=>c[0]==='stopLEScan'));
});
