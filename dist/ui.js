// Oberflächenlogik: Tabs, Abbiegesymbol, Tastaturkürzel, Design und die gestalteten Dialoge
// (Freischalten, Gerätesuche). Kein direkter Bluetooth-Zugriff – die Gerätesuche wird nur als
// UI bereitgestellt; das eigentliche Scannen macht der BLE-Shim (ble-capacitor.js).
import {_setDevicePicker} from './ble-capacitor.js?v=3';
const $=id=>document.getElementById(id);
const TAB_KEY='g3-tab';

// Tabs (WAI-ARIA Tabs-Muster mit Pfeiltasten, Pos1 und Ende).
const tabs=[...document.querySelectorAll('[role="tab"]')];
function select(name,{focus=false,scroll=true}={}) {
  for(const tab of tabs){
    const on=tab.dataset.tab===name;
    tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;
    $(tab.getAttribute('aria-controls')).hidden=!on;
    if(on&&focus)tab.focus();
  }
  try{localStorage.setItem(TAB_KEY,name);}catch{}
  if(scroll)window.scrollTo({top:0});
}
// Profile-Freischaltung: Der Profile-Tab ist bei jedem App-Start gesperrt und muss mit dem Code
// 1337 freigeschaltet werden. Die Freischaltung gilt NUR für die laufende Sitzung – sie wird nicht
// gespeichert und wird aufgehoben, sobald die App in den Hintergrund geht (schließen/wechseln),
// sodass der Code beim nächsten Öffnen erneut abgefragt wird (kein Force-Close nötig). Reine
// Oberflächensperre – sie ändert nichts am Profil-Protokoll in profiles.js.
const UNLOCK_CODE='1337';
let profilesUnlockedFlag=false;
function profilesUnlocked(){return profilesUnlockedFlag;}
function markProfilesLock(){
  const t=$('tab-profiles');if(!t)return;
  const locked=!profilesUnlocked();
  t.classList.toggle('locked',locked);
  if(locked)t.title='Gesperrt – zum Freischalten Code '+UNLOCK_CODE+' eingeben.';else t.removeAttribute('title');
}
// Eigener, gestalteter Freischalt-Dialog (statt des schlichten window.prompt). Das <dialog>
// liegt in index.html; hier wird es nur bedient. Fällt auf window.prompt zurück, falls <dialog>
// nicht unterstützt wird.
const unlockDlg=$('unlock-dialog'),unlockForm=$('unlock-form'),unlockInput=$('unlock-input'),unlockError=$('unlock-error'),unlockCancel=$('unlock-cancel');
let unlockThen=null;
function openUnlock(then){
  if(!unlockDlg||typeof unlockDlg.showModal!=='function'){
    const code=prompt('Profile sind gesperrt. Zum Freischalten den Code eingeben:');
    if(code!==null&&code.trim()===UNLOCK_CODE){profilesUnlockedFlag=true;markProfilesLock();then&&then();}
    return;
  }
  unlockThen=then;unlockInput.value='';unlockError.hidden=true;
  if(!unlockDlg.open)unlockDlg.showModal();
  requestAnimationFrame(()=>unlockInput.focus());
}
if(unlockDlg&&typeof unlockDlg.showModal==='function'){
  unlockForm.addEventListener('submit',e=>{
    e.preventDefault();
    if(unlockInput.value.trim()===UNLOCK_CODE){
      profilesUnlockedFlag=true;markProfilesLock();
      const then=unlockThen;unlockDlg.close();then&&then();
    }else{
      unlockError.hidden=false;unlockInput.select();
    }
  });
  unlockCancel.addEventListener('click',()=>unlockDlg.close());
  unlockDlg.addEventListener('cancel',e=>{e.preventDefault();unlockDlg.close();}); // Esc: schließen ohne Freischalten
  unlockDlg.addEventListener('click',e=>{if(e.target===unlockDlg)unlockDlg.close();}); // Klick auf den Backdrop
  unlockDlg.addEventListener('close',()=>{unlockThen=null;unlockError.hidden=true;});
}
// Zieltab öffnen – bei gesperrten Profilen erst den Code abfragen, dann (bei Erfolg) umschalten.
function tryEnter(name,opts){
  if(name!=='profiles'||profilesUnlocked()){select(name,opts);return;}
  openUnlock(()=>select('profiles',opts));
}
// Beim Verbergen/Verlassen der App wieder sperren und, falls der Profile-Tab offen ist, wegschalten,
// damit beim nächsten Öffnen erneut der Code verlangt wird.
function relockProfiles(){
  if(unlockDlg&&unlockDlg.open)unlockDlg.close();
  if(!profilesUnlockedFlag)return;
  profilesUnlockedFlag=false;markProfilesLock();
  const active=tabs.find(t=>t.getAttribute('aria-selected')==='true');
  if(active&&active.dataset.tab==='profiles')select('scooter');
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)relockProfiles();});
window.addEventListener('pagehide',relockProfiles);
markProfilesLock();
tabs.forEach((tab,i)=>{
  tab.addEventListener('click',()=>tryEnter(tab.dataset.tab));
  tab.addEventListener('keydown',e=>{
    const next={ArrowRight:i+1,ArrowDown:i+1,ArrowLeft:i-1,ArrowUp:i-1,Home:0,End:tabs.length-1}[e.key];
    if(next===undefined)return;
    e.preventDefault();const name=tabs[(next+tabs.length)%tabs.length].dataset.tab;
    tryEnter(name,{focus:true});
  });
});
let initial='scooter';
try{const saved=localStorage.getItem(TAB_KEY);if(tabs.some(t=>t.dataset.tab===saved))initial=saved;}catch{}
if(initial==='profiles'&&!profilesUnlocked())initial='scooter';
select(initial,{scroll:false});

// Abbiegesymbol aus dem angezeigten Hinweistext ableiten.
const maneuver=document.querySelector('.maneuver'),instruction=$('nav-instruction');
function direction(text) {
  if(/ziel erreicht/i.test(text))return 'arrive';
  if(/kreisverkehr/i.test(text))return 'round';
  if(/wenden/i.test(text))return 'uturn';
  if(/links/i.test(text))return 'left';
  if(/rechts/i.test(text))return 'right';
  if(/geradeaus|losfahren|google maps/i.test(text))return 'straight';
  if(/route bereit/i.test(text))return 'ready';
  return 'none';
}
if(maneuver&&instruction){
  const sync=()=>{maneuver.dataset.dir=direction(instruction.textContent);};
  new MutationObserver(sync).observe(instruction,{childList:true,characterData:true,subtree:true});sync();
}

// Eingabetaste in der Zielsuche startet die Suche.
$('nav-query')?.addEventListener('keydown',e=>{
  if(e.key!=='Enter'||e.isComposing)return;
  e.preventDefault();if(!$('nav-find').disabled)$('nav-find').click();
});

// Fehler im Log am Logger-Tab markieren, solange er nicht geöffnet ist.
const logTab=$('tab-log'),log=$('log');
if(logTab&&log){
  let seen=0;
  const mark=()=>{
    const errors=(log.value.match(/\[ERROR\]/g)||[]).length;
    if(logTab.getAttribute('aria-selected')==='true'||errors<seen)seen=errors;
    logTab.classList.toggle('alert',errors>seen);
  };
  setInterval(mark,1000);logTab.addEventListener('click',mark);
}

// Design-Auswahl: Dunkel (Standard), OG (das ursprüngliche helle Design) oder System (folgt dem
// Betriebssystem). Die Wahl steht auf <html data-theme> und wird in localStorage gemerkt; ein
// kleines Inline-Skript im <head> setzt sie bereits vor dem ersten Zeichnen, um Flackern zu vermeiden.
const THEME_KEY='g3-theme',themeSelect=$('theme-select'),themeMeta=$('meta-theme-color');
const prefersDark=window.matchMedia?.('(prefers-color-scheme: dark)');
function readTheme(){try{return localStorage.getItem(THEME_KEY)||'dark';}catch{return 'dark';}}
function surfaceFor(name){
  if(name==='og')return '#11171e';
  if(name==='system')return prefersDark?.matches?'#151516':'#ffffff';
  return '#151516';
}
function applyTheme(name){
  document.documentElement.dataset.theme=name;
  themeMeta?.setAttribute('content',surfaceFor(name));
}
if(themeSelect){
  const current=readTheme();
  themeSelect.value=current;applyTheme(current);
  themeSelect.addEventListener('change',()=>{
    const name=themeSelect.value;try{localStorage.setItem(THEME_KEY,name);}catch{}applyTheme(name);
  });
}
// System-Design soll auf Wechsel des Betriebssystem-Themas reagieren (nur die Statusleistenfarbe).
prefersDark?.addEventListener?.('change',()=>{if(readTheme()==='system')themeMeta?.setAttribute('content',surfaceFor('system'));});

// ── Gestaltete Gerätesuche (nur Android) ──────────────────────────────────────
// Ersetzt den schlichten nativen Gerätewähler des BLE-Plugins durch eine zum Design passende
// Liste. Reiner UI-Baustein: Das Scannen macht der Shim; hier wird nur angezeigt, was er findet,
// und die Auswahl zurückgemeldet. Im Browser öffnet stattdessen der native Web-Bluetooth-Dialog,
// dieser Picker wird dort nie aufgerufen (schadet aber nicht).
const scanDlg=$('scan-dialog'),scanList=$('scan-list'),scanEmpty=$('scan-empty'),scanText=$('scan-text'),scanCancel=$('scan-cancel');
if(scanDlg&&typeof scanDlg.showModal==='function'){
  let onSelect=null,onCancel=null,scanSettled=false;
  const closeScan=()=>{if(scanDlg.open)scanDlg.close();};
  const cancelScan=()=>{if(scanSettled)return;scanSettled=true;const cb=onCancel;closeScan();cb&&cb();};
  scanCancel.addEventListener('click',cancelScan);
  scanDlg.addEventListener('cancel',e=>{e.preventDefault();cancelScan();}); // Esc
  scanDlg.addEventListener('click',e=>{if(e.target===scanDlg)cancelScan();}); // Backdrop
  _setDevicePicker({
    open({all,onSelect:sel,onCancel:cancel}){
      onSelect=sel;onCancel=cancel;scanSettled=false;
      scanList.innerHTML='';scanEmpty.hidden=false;
      scanText.textContent=all?'Alle Geräte in der Nähe …':'Suche nach deinem Roller …';
      if(!scanDlg.open)scanDlg.showModal();
    },
    add({id,name,rssi}){
      scanEmpty.hidden=true;
      let row=scanList.querySelector(`li[data-id="${CSS.escape(id)}"]`);
      if(!row){
        row=document.createElement('li');row.dataset.id=id;
        const btn=document.createElement('button');btn.type='button';btn.className='scan-item';
        const n=document.createElement('span');n.className='scan-name';
        const meta=document.createElement('span');meta.className='scan-id';
        btn.append(n,meta);row.append(btn);
        btn.addEventListener('click',()=>{if(scanSettled)return;scanSettled=true;const cb=onSelect;closeScan();cb&&cb(row.dataset.id,row.dataset.name||'');});
        scanList.append(row);
      }
      row.dataset.name=name||'';
      row.querySelector('.scan-name').textContent=name||'Unbekanntes Gerät';
      row.querySelector('.scan-id').textContent=id+(typeof rssi==='number'?` · ${rssi} dBm`:'');
    },
    close(){closeScan();},
  });
}
