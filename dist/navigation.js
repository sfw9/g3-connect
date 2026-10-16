// Independent route tracking and display payload encoding. Protocol references: navigation-analysis.md.
export const ROUTER='https://routing.openstreetmap.de/routed-bike/route/v1/driving/';
const rad=d=>d*Math.PI/180;
export function validPoint(p){return Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;}
export function distance(a,b){const x=rad(b[0]-a[0])*Math.cos(rad((a[1]+b[1])/2)),y=rad(b[1]-a[1]);return Math.hypot(x,y)*6371000;}
export function parseCoordinates(text){
 const m=text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);if(!m)return null;
 const p=[Number(m[2]),Number(m[1])];if(!validPoint(p))throw new Error('Koordinaten außerhalb des gültigen Bereichs.');return p;
}
function uint(value,max=0x7fffffff){if(!Number.isFinite(value)||value<0||value>max)throw new Error('Ungültiger Navigationswert.');return Math.round(value);}
export function encodeDistance(meters){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,uint(meters),true);return b;}
export function encodeInfo({remaining,seconds,icon,stepRemaining,gps=1}){
 const b=new Uint8Array(18),v=new DataView(b.buffer);
 v.setUint32(0,uint(remaining),true);v.setUint32(4,uint(seconds),true);v.setUint16(8,uint(icon,65535),true);
 v.setUint32(10,uint(stepRemaining),true);v.setUint16(14,0,true);v.setUint16(16,uint(gps,65535),true);return b;
}
export function encodeRoad(text){
 // Bound complete ATT frames; never cut a UTF-8 code point or send embedded NULs.
 const enc=new TextEncoder(),out=[];
 for(const ch of String(text).replaceAll('\0','')){const b=enc.encode(ch);if(out.length+b.length>39)break;out.push(...b);}
 return Uint8Array.from([...out,0]);
}
export function maneuver(m={}){
 const mod=m.modifier||'',type=m.type||'';
 if(type==='arrive')return {icon:15,text:'Ziel erreicht'};
 if(/roundabout|rotary/.test(type))return {icon:11,text:'Kreisverkehr'+(m.exit?` · Ausfahrt ${m.exit}`:'')};
 if(mod==='uturn')return {icon:8,text:'Wenden'};
 const turns={'left':[2,'Links abbiegen'],'right':[3,'Rechts abbiegen'],'slight left':[4,'Links halten'],'slight right':[5,'Rechts halten'],'sharp left':[6,'Scharf links'],'sharp right':[7,'Scharf rechts']};
 if(turns[mod])return {icon:turns[mod][0],text:turns[mod][1]};
 return {icon:9,text:type==='depart'?'Losfahren':'Geradeaus'};
}
export function makeRoute(data){
 const r=data?.routes?.[0];if(data.code!=='Ok'||!r)throw new Error('Keine Fahrradroute gefunden.');
 const steps=r.legs?.flatMap(l=>l.steps||[])||[];if(!steps.length)throw new Error('Route enthält keine Abbiegehinweise.');
 const points=[],segments=[],instructions=[];let length=0;
 for(const step of steps){
  const coords=step.geometry?.coordinates;if(!Array.isArray(coords)||coords.some(p=>!validPoint(p)))throw new Error('Ungültige Routengeometrie.');
  instructions.push({at:length,name:step.name||'',maneuver:step.maneuver||{},duration:Number(step.duration)||0});
  for(const p of coords){
   const previous=points.at(-1);if(previous){const n=distance(previous,p);if(n<0.01)continue;if(n>20000)throw new Error('Routengeometrie enthält eine Lücke.');segments.push({a:previous,b:p,start:length,length:n});length+=n;}
   points.push(p);
  }
 }
 if(segments.length<1||length<1||length>200000)throw new Error('Route muss zwischen 1 m und 200 km lang sein.');
 const duration=Number(r.duration);if(!Number.isFinite(duration)||duration<0)throw new Error('Ungültige Routendauer.');
 return {points,segments,instructions,length,duration};
}
function project(point,segment){
 const scale=Math.cos(rad(point[1])),a=segment.a,b=segment.b;
 const dx=(b[0]-a[0])*scale,dy=b[1]-a[1],px=(point[0]-a[0])*scale,py=point[1]-a[1];
 const t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy||1)));
 return {offset:distance(point,[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]),progress:segment.start+t*segment.length};
}
export function locate(route,point,previous=null){
 if(!validPoint(point))throw new Error('Ungültige GPS-Position.');
 let best=null;
 // Restrict progression to avoid jumping to a later pass on loops or crossings.
 for(const s of route.segments){
  if(previous!==null&&(s.start+s.length<previous-40||s.start>previous+500))continue;
  const hit=project(point,s);if(!best||hit.offset<best.offset-0.1)best=hit;
 }
 if(!best)throw new Error('Position konnte der Route nicht zugeordnet werden.');
 const progress=previous===null?best.progress:Math.max(previous,Math.min(best.progress,route.length));
 let current=0;for(let i=1;i<route.instructions.length;i++){if(route.instructions[i].at>progress+2)break;current=i;}
 const next=route.instructions[Math.min(current+1,route.instructions.length-1)];
 const remaining=Math.max(0,route.length-progress);
 const atEnd=remaining<=15&&distance(point,route.points.at(-1))<=20;
 const turn=atEnd?{icon:15,text:'Ziel erreicht'}:maneuver(next.maneuver);
 const awaitingArrival=turn.icon===15&&!atEnd;
 return {progress,offset:best.offset,remaining,seconds:remaining/route.length*route.duration,
  stepRemaining:Math.max(0,next.at-progress),icon:awaitingArrival?9:turn.icon,
  instruction:awaitingArrival?'Dem Weg bis zum Ziel folgen':turn.text,currentRoad:route.instructions[current].name,nextRoad:next.name,arrived:atEnd};
}
export async function getJSON(url,signal){
 const r=await fetch(url,{signal,credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});
 if(!r.ok)throw new Error(`Kartendienst antwortet mit HTTP ${r.status}.`);return r.json();
}
