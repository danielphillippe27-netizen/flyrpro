export function archivePage(start:string,end:string,cursor:string|null,days=7){
  const first=Date.parse(start),last=Date.parse(end),through=cursor?Date.parse(cursor):last;
  if(!Number.isFinite(through)||through<=first||through>last)throw Error('Invalid archive cursor');
  const from=Math.max(first,through-days*86400000);
  return {start:new Date(from).toISOString(),end:new Date(through).toISOString(),nextCursor:from>first?new Date(from).toISOString():null};
}
export function mergeStormEvents<T extends {key:string}>(previous:T[],next:T[]):T[]{return [...new Map([...previous,...next].map(e=>[e.key,e])).values()];}
