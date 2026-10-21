import {Ninebot} from './ninebot.js?v=11';
import {installNavigation} from './navigation-ui.js?v=12';
import {installManualSender} from './manual.js?v=1';
import {installSoundUI} from './sound-ui.js?v=5';
import {hex} from './crypto.js?v=10';
const $=id=>document.getElementById(id);
const logs=[];const started=performance.now();const sessionKeys=new Map();let client=null,busy=false,current=null;let displayDiagnostics=null,rangeDisplay=null,navigation=null,manual=null,sound=null;
function rememberKey(key) {
  const id=client.device.id;sessionKeys.set(id,key);$('pairing-key').value=key;$('pairing-key').dataset.device=id;
  $('save-key').hidden=false;$('new-key-hint').hidden=false;
  if($('remember-pairing').checked)try{localStorage.setItem('g3-pairing:'+id,key);}catch{log('Kopplung kann nur für diese geöffnete Seite gemerkt werden.');}
}
function rememberedKey(id) {
  if(sessionKeys.has(id))return sessionKeys.get(id);
  if($('remember-pairing').checked)try{const key=localStorage.getItem('g3-pairing:'+id);if(/^[\da-f]{32}$/i.test(key||''))return key;}catch{}
  return '';
}
const supported=window.isSecureContext && !!navigator.bluetooth && !!crypto.subtle;
function log(message,level='INFO') {
  const safe=String(message).replace(/\b[\da-f]{32}\b/gi,'[Schlüssel entfernt]');
  const time=new Date().toISOString();const elapsed=((performance.now()-started)/1000).toFixed(3);
  logs.push(`${time} +${elapsed}s [${level}] ${safe}`);
  if(logs.length>2000)logs.shift();
  $('log').value=logs.join('\n');$('log-count').textContent=`${logs.length} Einträge`;
  if($('auto-scroll').checked)$('log').scrollTop=$('log').scrollHeight;
}

// Register meanings (acceleration 0x6E, range display 0x2F bit 4) come from the official G3
// configuration. Other models such as the F3 share the display but are read-only here.
const modelName=()=>/^1C/i.test(client?.deviceName||client?.device?.name||'')?'Ninebot MAX G3':'Anderes Ninebot-Modell (z. B. F3)';
const writable=()=>modelName()==='Ninebot MAX G3';
const READ_ONLY='Nur Lesen: Die Register-Zuordnung ist für dieses Modell nicht bestätigt, daher sind Änderungen gesperrt.';
function status(title,detail='',kind='') {$('status-title').textContent=title;$('status-detail').textContent=detail;$('status-box').className=kind;}
function selected(){return Number(document.querySelector('input[name=level]:checked')?.value)||null;}
function update() {
  const connected=!!client?.authenticated;
  $('connect').disabled=busy||!supported;$('connect').textContent=connected?'Trennen':busy?'Verbindet …':'Verbinden';
  $('pair-again').disabled=busy||connected||!supported;
  $('connection-chip').textContent=connected?'Verbunden':busy?'Verbindet …':'Offline';
  $('connection-chip').className='chip '+(connected?'online':busy?'busy':'offline');
  $('levels').disabled=!connected||busy||![1,2,3].includes(current)||!writable();
  $('refresh').disabled=!connected||busy;
  $('read-display-diagnostics').disabled=!connected||busy;
  $('read-range').disabled=!connected||busy;
  $('range-enabled').disabled=!connected||busy||!rangeDisplay||!writable();
  $('apply-range').disabled=!connected||busy||!rangeDisplay||!writable()||$('range-enabled').checked===rangeDisplay.enabled;
  $('apply').disabled=!connected||busy||![1,2,3].includes(current)||!writable()||!selected()||selected()===current;
  $('cancel-pairing').hidden=!busy||!client?.device;
  $('pairing-key').disabled=busy||connected;$('name-override').disabled=busy||connected;
  navigation?.update();manual?.update();sound?.update();
}
function reset() {current=null;setRangeCurrent(null);$('current-level').textContent='—';$('read-status').textContent='Noch nicht ausgelesen.';$('device-name').textContent='Kein Gerät';$('device-caption').textContent='Nicht verbunden';document.querySelectorAll('[name=level]').forEach(r=>r.checked=false);}
function setRangeCurrent(value) {
  rangeDisplay=value;$('range-enabled').checked=!!value?.enabled;
  $('range-state').textContent=value?`Vom Roller gelesen: Reichweitenanzeige ${value.enabled?'ein':'aus'}.`:'Noch nicht ausgelesen.';
  $('range-capability').textContent=value&&!writable()?READ_ONLY:value&&!value.advertised?'Der Roller meldet den Segway-Schalter als ausgeblendet. Die Einstellung lässt sich hier direkt ansprechen; die Wirkung kann bei LC abweichen.':'';
}
function setCurrent(value) {
  current=value;$('current-level').textContent=[1,2,3].includes(value)?`Stufe ${value}`:`Unbekannter Wert: ${value}`;
  $('read-status').textContent=[1,2,3].includes(value)?'Vom Roller gelesen · Sport-Beschleunigung':'Dieses Registerformat wird nicht unterstützt. Änderungen sind gesperrt.';
  document.querySelectorAll('[name=level]').forEach(r=>r.checked=Number(r.value)===value);
}
async function refresh() {
  const level=await client.readAcceleration();setCurrent(level);log(`Beschleunigungsregister gelesen: ${level}.`);
  $('device-caption').textContent=`${modelName()} · ${client.generation}`;
  if(!writable()&&[1,2,3].includes(level))$('read-status').textContent=READ_ONLY;
  if(![1,2,3].includes(level))status('Änderungen gesperrt','Der Roller meldet einen unbekannten Stufenwert. Diese Firmware wird für Änderungen nicht unterstützt.','error');
}
async function connect(forcePairing=false) {
  if(busy)return;
  if(client?.authenticated){client.disconnect();reset();update();return;}
  const key=forcePairing?'':$('pairing-key').value.trim();
  if(key&&!/^[\da-f]{32}$/i.test(key)){status('Pairing-Schlüssel prüfen','Gib genau 32 Hex-Zeichen (0–9, a–f) ein.','error');return;}
  busy=true;reset();update();
  log(forcePairing?'Neue Power-Kopplung gestartet. Gespeicherter Schlüssel wird für diesen Versuch übersprungen.':'Verbindungsversuch gestartet.');
  client=new Ninebot(log,title=>{
    if(title==='Getrennt'){reset();status('Verbindung getrennt','Du kannst den Roller erneut verbinden.');log('Verbindung getrennt.');update();}
    else {const power=title.startsWith('Power-Taste');if(!power)log(title);status(title,power?'Drücke jetzt die Power-Taste einmal kurz. Die App wartet auf die Bestätigung und übernimmt ihren selbst erzeugten Schlüssel.':'Der Pairing-Schlüssel wird von dieser App auf deinem Gerät verwaltet.',power?'attention':'');update();}
  },password=>rememberKey(hex(password)));
  try {
    // requestDevice must be invoked directly from this click, before unrelated await.
    await client.choose($('show-all-devices').checked);log('Bluetooth-Gerät ausgewählt.');$('device-name').textContent=client.device.name||'Ninebot-Roller';
    const enteredKey=(!$('pairing-key').dataset.device || $('pairing-key').dataset.device===client.device.id)?key:'';
    await client.connect(forcePairing?'':enteredKey||rememberedKey(client.device.id),$('name-override').value,{forcePairing});
    $('device-name').textContent=client.device.name||'Ninebot-Roller';
    if(!writable())log('Kein G3-Name (1C…): Navigation verfügbar, Einstellungen nur lesend.');
    status('Roller verbunden','Verschlüsselte Verbindung hergestellt. Beschleunigungsstufe wird gelesen.','success');
    await refresh();
    if([1,2,3].includes(current))status('Bereit für deine Einstellung','Wähle eine Stufe. Beim Übernehmen prüft die App den Stillstand und liest den neuen Wert zurück. Die Stufenzuordnung bitte beim ersten Einsatz in der Segway-App vergleichen.','success');
    try {setRangeCurrent(await client.readRangeDisplay());}
    catch(e){setRangeCurrent(null);$('range-state').textContent=`Auslesen fehlgeschlagen: ${e.message}`;log(e.message,'ERROR');}
  } catch(e) {
    if(!client.authenticated)client.disconnect();
    status(e.name==='NotFoundError'?'Geräteauswahl abgebrochen':'Verbindung oder Auslesen fehlgeschlagen',e.message,'error');
    log(e.name==='NotFoundError'?'Geräteauswahl abgebrochen.':e.message,'ERROR');
  } finally {busy=false;update();}
}
$('connect').addEventListener('click',()=>connect());
$('pair-again').addEventListener('click',()=>connect(true));
$('cancel-pairing').addEventListener('click',()=>client?.disconnect());
$('pairing-key').addEventListener('input',()=>delete $('pairing-key').dataset.device);
$('refresh').addEventListener('click',async()=>{
  if(busy)return;busy=true;update();
  try {await refresh();if([1,2,3].includes(current))status('Werte aktualisiert','Aktuelle Beschleunigungsstufe direkt vom Roller gelesen.','success');}
  catch(e){setCurrent(null);status('Auslesen fehlgeschlagen',e.message,'error');log(e.message,'ERROR');}
  finally{busy=false;update();}
});
$('read-display-diagnostics').addEventListener('click',async()=>{
  if(busy||!client?.authenticated)return;busy=true;update();displayDiagnostics=null;
  $('display-diagnostic-output').textContent='Firmware und Display-Einstellungen werden gelesen …';
  try {
    displayDiagnostics=await client.readDisplayDiagnostics();
    $('display-diagnostic-output').textContent=JSON.stringify(displayDiagnostics,null,2);
    log('Display-Diagnose ist im JSON-Download enthalten.');
  } catch(e) {$('display-diagnostic-output').textContent=e.message;log(e.message,'ERROR');}
  finally{busy=false;update();}
});
$('levels').addEventListener('change',update);
$('range-enabled').addEventListener('change',update);
$('read-range').addEventListener('click',async()=>{
  if(busy||!client?.authenticated)return;busy=true;update();
  try{setRangeCurrent(await client.readRangeDisplay());}
  catch(e){setRangeCurrent(null);$('range-state').textContent=`Auslesen fehlgeschlagen: ${e.message}`;log(e.message,'ERROR');}
  finally{busy=false;update();}
});
$('apply-range').addEventListener('click',async()=>{
  if(busy||!rangeDisplay||!client?.authenticated)return;
  const enabled=$('range-enabled').checked;busy=true;update();$('range-state').textContent='Einstellung wird geschrieben und zurückgelesen …';
  try {
    setRangeCurrent(await client.setRangeDisplay(enabled));
    $('range-state').textContent=`Registerwert bestätigt: ${enabled?'ein':'aus'}. Anzeige am Roller prüfen.`;
  } catch(e){setRangeCurrent(null);$('range-state').textContent=e.message;log(e.message,'ERROR');}
  finally{busy=false;update();}
});
$('apply').addEventListener('click',async()=>{
  if(busy||!selected())return;const level=selected();busy=true;update();status('Stufe wird übernommen …','Stillstand prüfen, Wert schreiben und Ergebnis zurücklesen.');
  try {const result=await client.setAcceleration(level);setCurrent(result);status(`Stufe ${result} bestätigt`,'Der Roller hat den gewählten Wert zurückgemeldet. Prüfe bei der ersten Verwendung zusätzlich die Einstellung in der Segway-App.','success');}
  catch(e){setCurrent(null);status('Änderung nicht bestätigt',`${e.message} Lies den aktuellen Wert erneut, bevor du es noch einmal versuchst.`,'error');log(e.message,'ERROR');}
  finally{busy=false;update();}
});
$('reveal-key').addEventListener('click',()=>{const showing=$('pairing-key').type==='password';$('pairing-key').type=showing?'text':'password';$('reveal-key').textContent=showing?'Verbergen':'Anzeigen';$('reveal-key').setAttribute('aria-label',showing?'Pairing-Schlüssel verbergen':'Pairing-Schlüssel anzeigen');});
function download(content,name,type) {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('save-key').addEventListener('click',()=>download($('pairing-key').value+'\n','ninebot-pairing-key.txt','text/plain'));
$('download-log').addEventListener('click',()=>download(logs.join('\n')+'\n','g3-log.txt','text/plain'));
$('download-json').addEventListener('click',()=>download(JSON.stringify({app:'G3 Connect Beta 16',webBluetooth:supported,browser:navigator.userAgent,generation:client?.generation||null,connected:!!client?.authenticated,currentLevel:current,rangeDisplay,displayDiagnostics,log:logs},null,2),'g3-diagnose.json','application/json'));
$('copy-log').addEventListener('click',async()=>{
  try {await navigator.clipboard.writeText($('log').value);$('log-feedback').textContent='Log kopiert.';}
  catch {$('log').focus();$('log').select();$('log-feedback').textContent='Log markiert. Bitte mit Strg+C oder der Kopierfunktion des Browsers kopieren.';}
});
$('clear-log').addEventListener('click',()=>{logs.length=0;$('log').value='';$('log-feedback').textContent='Log geleert.';$('log-count').textContent='0 Einträge';});
window.addEventListener('pagehide',()=>client?.disconnect());
// While test values are being sent, route navigation stays locked so both never drive the display at once.
navigation=installNavigation({getClient:()=>client,isBusy:()=>busy||!!manual?.active(),setBusy:value=>{busy=value;update();},log});
sound=installSoundUI({getClient:()=>client,isBusy:()=>busy||!!manual?.active(),setBusy:value=>{busy=value;update();},log,writable});
manual=installManualSender({getClient:()=>client,isBusy:()=>busy,setBusy:value=>{busy=value;update();},log,beforeStart:()=>navigation.stop('Navigation für Testwerte beendet.')});
log('G3 Logger Beta 16 gestartet.');
log(`Browser: ${navigator.userAgent}`);
log(`HTTPS/localhost: ${window.isSecureContext}; Web Bluetooth: ${!!navigator.bluetooth}; WebCrypto: ${!!crypto.subtle}.`);
if(!supported){log('Web Bluetooth nicht verfügbar.','ERROR');status('Web Bluetooth nicht verfügbar',!window.isSecureContext?'Öffne diese App über HTTPS oder localhost. Eine normale HTTP-Adresse kann Bluetooth nicht verwenden.':'Nutze Chrome oder Edge auf einem Gerät mit Bluetooth-Unterstützung, z. B. Chrome auf Android. Safari auf iPhone und Firefox können diese Verbindung nicht herstellen.','error');$('connection-hint').textContent='Dieser Browser kann keine Bluetooth-Verbindung herstellen.';}
update();
