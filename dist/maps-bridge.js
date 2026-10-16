const ENDPOINT='http://127.0.0.1:8769/navigation';
const ICONS=new Set([2,3,4,5,6,7,8,9,11,12,15]);
export function mapsGuidance(data){
 const g=data?.guidance;
 if(data?.version!==1||!data.listenerReady)return {ok:false,message:'In der Android-Brücke zuerst Benachrichtigungszugriff erlauben.'};
 if(!g?.active)return {ok:false,message:'In Google Maps eine Navigation starten und danach hierher zurückwechseln.'};
 const n=[g.remaining,g.seconds,g.stepRemaining];
 if(g.complete!==true||!ICONS.has(g.icon)||!n.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=0x7fffffff)||g.remaining<g.stepRemaining||!Number.isFinite(g.confidence)||g.confidence<0.9||g.confidence>1)
  return {ok:false,message:'Google-Maps-Hinweis erkannt, aber Richtung, Reststrecke oder Restzeit fehlen bzw. sind unsicher. Keine Display-Übertragung.'};
 return {ok:true,state:{remaining:g.remaining,seconds:g.seconds,stepRemaining:g.stepRemaining,icon:g.icon,gps:1,currentRoad:'',nextRoad:String(g.road||'').slice(0,300)},road:String(g.road||''),title:String(g.title||''),confidence:g.confidence};
}
export function createMapsBridge(onUpdate){
 let token='',timer=null,abort=null,running=false,lastSeen=0,last=null,generation=0;
 try{
  const hash=new URLSearchParams(window.location.hash.slice(1)),incoming=hash.get('maps_bridge');
  if(incoming&&/^[\w-]{43}$/.test(incoming)){
   token=incoming;try{sessionStorage.setItem('g3-maps-bridge',token);}catch{}
   hash.delete('maps_bridge');history.replaceState(null,'',window.location.pathname+window.location.search+(hash.toString()?'#'+hash:''));
  }else{const saved=sessionStorage.getItem('g3-maps-bridge')||'';if(/^[\w-]{43}$/.test(saved))token=saved;}
 }catch{}
 async function poll(epoch){
  if(!running||epoch!==generation)return;const request=new AbortController();abort=request;const timeout=setTimeout(()=>request.abort(),lastSeen?2500:20000);
  try{
   const response=await fetch(ENDPOINT,{headers:{'X-G3-Token':token},cache:'no-store',credentials:'omit',signal:request.signal,targetAddressSpace:'loopback'});
   if(!response.ok)throw new Error(`Lokale Brücke: HTTP ${response.status}. Bitte aus der Android-App neu öffnen.`);
   const data=await response.json();if(!running||epoch!==generation)return;
   last=mapsGuidance(data);lastSeen=Date.now();onUpdate({...last,raw:data.guidance||{}});
  }catch(e){if(!running||epoch!==generation)return;last=null;lastSeen=0;onUpdate({ok:false,message:e.name==='TypeError'?'Lokale Brücke nicht erreichbar. Android-App und Freigaben prüfen; Chrome muss lokalen Zugriff erlauben.':e.message});}
  finally{clearTimeout(timeout);if(abort===request)abort=null;if(running&&epoch===generation)timer=setTimeout(()=>void poll(epoch),1000);}
 }
 return {
  available:()=>!!token,
  start(){if(running)return;if(!token)throw new Error('G3 Connect über „G3 Maps Bridge“ auf diesem Handy öffnen.');running=true;void poll(++generation);},
  stop(){running=false;generation++;clearTimeout(timer);abort?.abort();abort=null;last=null;lastSeen=0;},
  latest(){return last?.ok&&Date.now()-lastSeen<8000?last.state:null;},
  connected:()=>running
 };
}
