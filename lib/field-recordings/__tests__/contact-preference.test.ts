import assert from 'node:assert/strict';
import { checkedPreferenceReceipt, clearPreference, pendingPreferences, persistPreference, preferenceSchema, preferenceStorageKey, recoverSavedPreference, restorePreference } from '../contact-preference';
const ids=Array.from({length:7},()=>crypto.randomUUID());
const key=preferenceStorageKey(ids[0],ids[1],ids[2],ids[3]);
const payload={requestId:ids[4],version:2,contactId:ids[5],addressId:ids[6],proposalIndex:0,confirmed:true as const};
const rows=new Map<string,string>();
const store={get length(){return rows.size;},key:(index:number)=>[...rows.keys()][index]??null,getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value);},removeItem:(key:string)=>{rows.delete(key);}};
assert.equal(restorePreference(store,key),null);
persistPreference(store,key,payload); persistPreference(store,key,{...payload});
assert.deepEqual(restorePreference(store,key),payload);
assert.equal(restorePreference(store,preferenceStorageKey(crypto.randomUUID(),ids[1],ids[2],ids[3])),null);
assert.throws(()=>persistPreference(store,key,{...payload,contactId:crypto.randomUUID()}));
assert.throws(()=>clearPreference(store,key,{...payload,requestId:crypto.randomUUID()}));
const receipt={conversationId:ids[3],version:3,contactId:ids[5],doNotContact:true,requestId:ids[4]};
assert.deepEqual(checkedPreferenceReceipt(receipt,ids[3],payload),receipt);
for(const value of [{...receipt,conversationId:crypto.randomUUID()},{...receipt,contactId:crypto.randomUUID()},{...receipt,requestId:crypto.randomUUID()},{...receipt,version:2},{...receipt,doNotContact:false},{...receipt,token:'unexpected'}]) assert.throws(()=>checkedPreferenceReceipt(value,ids[3],payload));
for(const value of [{...payload,confirmed:false},{...payload,proposalIndex:20},{...payload,proposalIndex:-1},{...payload,ownerId:ids[0]},{...payload,version:0}]) assert.equal(preferenceSchema.safeParse(value).success,false);
clearPreference(store,key,payload); assert.equal(restorePreference(store,key),null);
store.setItem(key,'corrupt'); assert.throws(()=>restorePreference(store,key));
assert.throws(()=>persistPreference({...store,setItem:()=>{throw new Error('storage failure');}},'other',payload));
async function recoveryChecks() {
  rows.clear();persistPreference(store,key,payload);
  const foreign=preferenceStorageKey(crypto.randomUUID(),ids[1],ids[2],ids[3]);store.setItem(foreign,'corrupt');
  const entries=pendingPreferences(store,ids[0],ids[1]);assert.equal(entries.length,1);
  assert.deepEqual(entries[0],{key,recordingId:ids[2],conversationId:ids[3],payload});
  assert.equal(pendingPreferences(store,ids[0],crypto.randomUUID()).length,0);
  const bad=key+':extra';store.setItem(bad,JSON.stringify(payload));assert.throws(()=>pendingPreferences(store,ids[0],ids[1]));store.removeItem(bad);
  const signal=new AbortController().signal;
  const responses:Response[]=[];const calls:{url:string;init?:RequestInit}[]=[];
  const transport=(async (url,init)=>{calls.push({url:String(url),init});return responses.shift()!;}) as typeof fetch;
  responses.push(Response.json(receipt));
  assert.deepEqual(await recoverSavedPreference(store,entries[0],ids[1],signal,transport),{kind:'confirmed',version:3});
  assert.equal(calls.length,1);assert.equal(calls[0].init?.redirect,'error');assert.match(calls[0].url,new RegExp(`workspaceId=${ids[1]}&requestId=${payload.requestId}$`));assert.equal(restorePreference(store,key),null);
  persistPreference(store,key,payload);calls.length=0;responses.push(new Response(null,{status:404}),Response.json(receipt));
  await recoverSavedPreference(store,entries[0],ids[1],signal,transport);
  assert.equal(calls.length,2);assert.equal(calls[1].init?.method,'POST');assert.deepEqual(JSON.parse(calls[1].init?.body as string),payload);
  for(const response of [new Response(null,{status:403}),new Response(null,{status:500}),Response.json({...receipt,contactId:crypto.randomUUID()})]) {
    persistPreference(store,key,payload);calls.length=0;responses.push(response);
    await assert.rejects(recoverSavedPreference(store,entries[0],ids[1],signal,transport));assert.equal(calls.length,1);assert.deepEqual(restorePreference(store,key),payload);
  }
  responses.push(new Response(null,{status:404}),new Response(null,{status:409}));
  assert.deepEqual(await recoverSavedPreference(store,entries[0],ids[1],signal,transport),{kind:'rejected'});assert.equal(restorePreference(store,key),null);
  persistPreference(store,key,payload);const cancelled=new AbortController();cancelled.abort();calls.length=0;
  await assert.rejects(recoverSavedPreference(store,entries[0],ids[1],cancelled.signal,transport));assert.equal(calls.length,0);assert.deepEqual(restorePreference(store,key),payload);
  clearPreference(store,key,payload);persistPreference(store,key,{...payload,requestId:crypto.randomUUID()});
  await assert.rejects(recoverSavedPreference(store,entries[0],ids[1],signal,transport));assert.equal(calls.length,0);
}
recoveryChecks().then(()=>console.log('Independent preference discovery and exact receipt-first network recovery passed')).catch(error=>{console.error(error);process.exitCode=1;});
console.log('Preference scope, immutable journal, strict receipts and recovery validation passed');
