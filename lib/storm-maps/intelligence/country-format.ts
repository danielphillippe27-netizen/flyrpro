import {XMLParser,XMLValidator} from 'fast-xml-parser';
const array=<T>(value:unknown):T[]=>(value==null?[]:Array.isArray(value)?value:[value]) as T[];
const text=(value:unknown):string=>typeof value==='string'?value:typeof value==='object'&&value!==null&&'#text'in value?String((value as {'#text':unknown})['#text']):'';
function parse(xml:string){
 if(xml.length>8_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('Invalid public warning XML.');
 return new XMLParser({ignoreAttributes:false,processEntities:false}).parse(xml);
}
export function capFeedItems(xml:string){
 const body=parse(xml);if(!body.rss?.channel)throw Error('Invalid CAP feed.');
 return array<{link:unknown;title:unknown;pubDate:unknown}>(body.rss.channel.item).map(item=>({url:text(item.link).replaceAll('&amp;','&'),title:text(item.title),published:text(item.pubDate)}));
}
export function trustedCapUrl(value:string,country:'AU'|'NZ'){
 try{const url=new URL(value);return url.protocol==='https:'&&(country==='NZ'?url.hostname==='alerts.metservice.com'&&url.pathname==='/cap/alert':url.hostname==='severeweather.wmo.int'&&url.pathname.startsWith('/v2/cap-alerts/au-bom-en/'));}catch{return false;}
}
export function capSummary(xml:string){
 const body=parse(xml),alert=body.alert;
 if(!alert||!text(alert.identifier)||!Number.isFinite(Date.parse(text(alert.sent))))throw Error('Invalid CAP alert.');
 const infos=array<Record<string,unknown>>(alert.info);
 const polygons=infos.flatMap(info=>array<Record<string,unknown>>(info.area).flatMap(area=>array<string>(area.polygon).flatMap(value=>{
  const coordinates=String(value).trim().split(/\s+/).map(pair=>pair.split(',').map(Number)).map(([lat,lon])=>[lon,lat]);
  if(coordinates.length<4||coordinates.some(([lon,lat])=>!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90))return [];
  const first=coordinates[0],last=coordinates.at(-1)!;if(first[0]!==last[0]||first[1]!==last[1])coordinates.push([...first]);
  return [{type:'Polygon' as const,coordinates:[coordinates]}];
 })));
 return {identifier:text(alert.identifier),sent:text(alert.sent),status:text(alert.status),messageType:text(alert.msgType),events:infos.map(info=>text(info.event)),headlines:infos.map(info=>text(info.headline)),polygons,evidence:'warning' as const,impactGeometry:false};
}
export function safeCanadaNext(value:string){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='api.weather.gc.ca'&&u.pathname==='/collections/weather-alerts/items';}catch{return false;}}
