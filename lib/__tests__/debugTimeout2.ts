import { pushLeadToConnectedCrms } from '../integrations/auto-push';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type QueryOp = { type: string; args: unknown[] };
class MQB {
  private ops: QueryOp[] = [];
  constructor(private t: string, private r: (t: string, ops: QueryOp[], m: 'list'|'single') => {data:unknown;error:null}) {}
  select(c: string) { this.ops.push({type:'select',args:[c]}); return this; }
  eq(k: string, v: unknown) { this.ops.push({type:'eq',args:[k,v]}); return this; }
  in(k: string, v: unknown[]) { this.ops.push({type:'in',args:[k,v]}); return this; }
  update(p: unknown) { this.ops.push({type:'update',args:[p]}); return this; }
  insert(p: unknown) { this.ops.push({type:'insert',args:[p]}); return this; }
  maybeSingle() { return Promise.resolve(this.r(this.t,this.ops,'single')); }
  single() { return Promise.resolve(this.r(this.t,this.ops,'single')); }
  then<T>(f:(v:{data:unknown;error:null})=>T) { return Promise.resolve(this.r(this.t,this.ops,'list')).then(f); }
}

function mkSb(providers: string[], hsOAuth: Record<string,unknown>|null = null) {
  const resolver = (t: string, ops: QueryOp[], m: 'list'|'single') => {
    if (ops.some(o=>o.type==='update'||o.type==='insert')) return {data:null,error:null};
    const eqs: Record<string,unknown> = {};
    for (const op of ops) if (op.type==='eq') eqs[String(op.args[0])]=op.args[1];
    const cols = (ops.find(o=>o.type==='select')?.args[0] as string)??'';
    if (t==='crm_connections' && cols==='provider') return {data:providers.map(p=>({provider:p})),error:null};
    if (t==='user_integrations' && eqs['provider']==='hubspot') return {data:hsOAuth,error:null};
    if (t==='user_integrations') return {data:null,error:null};
    return {data:null,error:null};
  };
  return { from: (t: string) => new MQB(t, resolver as any) };
}

const CONTACT = { id:'c1', full_name:'Test', phone:'+15550001234', email:'t@t.com', address:null, notes:'hi', campaign_id:null };
const HS = { access_token:'hs-tok', refresh_token:null, expires_at:null };

async function main() {
  const orig = globalThis.fetch;

  // Test A: HubSpot 400 (mirrors test 14)
  console.log('[A] starting');
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method??'GET').toUpperCase();
    if (url.includes('/contacts/search')) return jsonResponse({total:0,results:[]});
    if (url.endsWith('/crm/v3/objects/contacts') && method==='POST') return jsonResponse({status:'error'},400);
    return jsonResponse({},200);
  }) as typeof fetch;
  const rA = await pushLeadToConnectedCrms(mkSb(['hubspot'],HS) as any,'u','w',CONTACT);
  console.log('[A] result:', rA[0]?.status, rA[0]?.error?.slice(0,60));
  globalThis.fetch = orig;
  console.log('[A] done, moving to B');

  // Test B: HubSpot timeout (mirrors test 15)
  console.log('[B] starting');
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/contacts/search')) return jsonResponse({total:0,results:[]});
    console.log('[B] hanging fetch for:', url.slice(0,60));
    return new Promise<Response>(() => {});
  }) as typeof fetch;
  const t0 = Date.now();
  console.log('[B] calling pushLeadToConnectedCrms');
  const rB = await pushLeadToConnectedCrms(mkSb(['hubspot'],HS) as any,'u','w',CONTACT);
  console.log('[B] result:', rB[0]?.status, 'elapsed:', Date.now()-t0, rB[0]?.error?.slice(0,60));
  globalThis.fetch = orig;
  console.log('[B] done');
}

main().then(()=>{console.log('FINISHED');process.exit(0);}).catch(e=>{console.error('CRASH',e);process.exit(1);});
