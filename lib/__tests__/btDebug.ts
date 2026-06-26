import { pushLeadToConnectedCrms } from '../integrations/auto-push';
import crypto from 'node:crypto';

const DEFAULT_ENCRYPTION_KEY = 'flyr-default-encryption-key-32chars!';
function encryptForTest(plaintext: string): string {
  const key = Buffer.from(DEFAULT_ENCRYPTION_KEY.slice(0, 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(plaintext, 'utf8', 'base64');
  enc += cipher.final('base64');
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc}`;
}

type QueryOp = { type: string; args: unknown[] };
class MQB {
  private ops: QueryOp[] = [];
  constructor(private t: string, private r: Function) {}
  select(c: string) { this.ops.push({type:'select',args:[c]}); return this; }
  eq(k: string, v: unknown) { this.ops.push({type:'eq',args:[k,v]}); return this; }
  in(k: string, v: unknown[]) { this.ops.push({type:'in',args:[k,v]}); return this; }
  update(p: unknown) { this.ops.push({type:'update',args:[p]}); return this; }
  insert(p: unknown) { this.ops.push({type:'insert',args:[p]}); return this; }
  maybeSingle() { return Promise.resolve(this.r(this.t,this.ops,'single')); }
  then<T>(f:(v:any)=>T) { return Promise.resolve(this.r(this.t,this.ops,'list')).then(f); }
}

const encryptedBt = encryptForTest('bt-api-token-xyz');
const resolver = (t: string, ops: QueryOp[], m: string) => {
  if (ops.some((o:any) => o.type==='update'||o.type==='insert')) return {data:null,error:null};
  const eqs: Record<string,unknown> = {};
  for (const op of ops) if (op.type==='eq') eqs[String(op.args[0])]=op.args[1];
  const cols = (ops.find((o:any)=>o.type==='select')?.args[0] as string)??'';
  if (t==='crm_connections' && cols==='provider') return {data:[{provider:'boldtrail'}],error:null};
  if (t==='crm_connections' && cols==='api_key_encrypted') {
    const p = eqs['provider'] as string;
    if (p==='boldtrail') return {data:{api_key_encrypted:encryptedBt},error:null};
  }
  if (t==='crm_object_links') return {data:null,error:null};
  return {data:null,error:null};
};
const sb = { from: (t: string) => new MQB(t, resolver) };

const CONTACT = { id:'c1', full_name:'John Doe', phone:'+15550001234', email:'john@example.com', address:'123 Main St', notes:'Some notes', campaign_id:'camp1' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function main() {
  const orig = globalThis.fetch;
  const fetchCalls: Array<{url:string;method:string}> = [];
  
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'POST').toUpperCase();
    console.log('FETCH CALLED:', method, url.slice(0, 80));
    fetchCalls.push({ url, method });
    if (url.includes('kvcore.com/v2/public/contact') && method === 'POST') {
      console.log('  → returning bt-new-777');
      return jsonResponse({ data: { id: 'bt-new-777' } }, 201);
    }
    console.log('  → catch-all 200');
    return jsonResponse({}, 200);
  }) as typeof fetch;

  const results = await pushLeadToConnectedCrms(sb as any, 'u', 'w', CONTACT);
  globalThis.fetch = orig;

  console.log('\nResults:', JSON.stringify(results, null, 2));
  console.log('\nFetch calls:', JSON.stringify(fetchCalls, null, 2));
  console.log('\nHas POST create:', fetchCalls.some(c => c.url.includes('kvcore.com/v2/public/contact') && c.method === 'POST'));
}

main().catch(e => { console.error(e); process.exit(1); });
