// Reine Oberflächenlogik: Tabs, Abbiegesymbol, Tastaturkürzel. Keine Bluetooth- oder Netzwerkzugriffe.
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
tabs.forEach((tab,i)=>{
  tab.addEventListener('click',()=>select(tab.dataset.tab));
  tab.addEventListener('keydown',e=>{
    const next={ArrowRight:i+1,ArrowDown:i+1,ArrowLeft:i-1,ArrowUp:i-1,Home:0,End:tabs.length-1}[e.key];
    if(next===undefined)return;
    e.preventDefault();select(tabs[(next+tabs.length)%tabs.length].dataset.tab,{focus:true});
  });
});
let initial='scooter';
try{const saved=localStorage.getItem(TAB_KEY);if(tabs.some(t=>t.dataset.tab===saved))initial=saved;}catch{}
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
