import { z } from 'zod';

const numeric = z.string().regex(/^-?\d+(\.\d+)?$/);
export const fieldContextSchema = z.object({
  version: z.literal(2), actor: z.string().uuid(), role: z.string(), scope: z.enum(['self','team']),
  timezone: z.string(), sales_timezone: z.string().nullable(), as_of: z.string(), local_day: z.string(), first_day: z.string(), days: z.union([z.literal(30),z.literal(90),z.literal(365)]),
  stage_defs:z.array(z.object({key:z.string(),label:z.string(),probability:z.number(),kind:z.string()})).default([]),
  people: z.array(z.object({id:z.string().uuid(),name:z.string()})).max(200),
  campaigns: z.array(z.object({id:z.string().uuid(),name:z.string(),territory:z.string().nullable()})),
  goals: z.array(z.object({rep:z.string().uuid(),daily:z.number().nullable(),weekly:z.number().nullable()})),
  rows: z.array(z.object({rep:z.string().uuid(),campaign:z.string().nullable(),day:z.string().nullable(),values:z.record(z.string(),numeric.nullable())})).max(60000),
  available:z.array(z.string()),unavailable:z.array(z.string()),currency:z.string().nullable(),
  lifetime:z.record(z.string(),z.union([z.number(),z.string(),z.null()])).nullable(),
  priorities:z.array(z.object({id:z.string().uuid(),name:z.string(),status:z.string(),due:z.string().nullable(),last_contacted:z.string().nullable(),reason:z.string()})).max(10),
});
export type FieldContext=z.infer<typeof fieldContextSchema>;
type Row=FieldContext['rows'][number];
type Unit='count'|'percent'|'pp'|'hours'|'km'|'money'|'days'|'ratio';
type Definition={label:string;source:string;unit:Unit;current?:boolean};
export const KPI:Record<string,Definition>={};
function define(source:string,entries:Record<string,string>,unit:Unit='count',current=false){
 for(const [key,label] of Object.entries(entries)) KPI[key]={label,source,unit,current};
}
define('visits',{doors:'Doors visited',conversations:'Conversations',flyers:'Flyer visits',no_answer:'No answer outcomes',do_not_knock:'Do not knock outcomes',not_interested:'Not interested outcomes'});
define('sessions',{sessions:'Sessions started',ended_sessions:'Completed sessions',reported_doors:'Session-reported doors',reported_flyers:'Session-reported flyers',session_goals_met:'Door/flyer session goals met',sessions_with_goals:'Completed sessions with door/flyer goals'});
define('sessions',{active_seconds:'Tracked time (completed sessions)'},'hours');define('sessions',{distance_meters:'Distance (completed sessions)'},'km');
define('leads',{leads:'Field leads created',leads_contacted:'Created leads contacted by now'});
define('activities',{appointments:'Appointments created',calls:'Calls logged',texts:'Texts logged',emails:'Emails logged',notes:'Notes logged',contact_knocks:'Contact knocks logged',contact_flyers:'Contact flyers logged'});
define('activities',{appointments_today:'Appointments remaining today',appointments_upcoming:'Upcoming appointments'},'count',true);
define('appointment_outcomes',{appointments_completed:'Meetings marked completed in history',appointments_cancelled:'Meetings marked cancelled in history'},'count',true);
define('contacts',{contacts:'Field contacts',hot_leads:'Hot leads',warm_leads:'Warm leads',cold_leads:'Cold leads',new_leads:'New leads',overdue_reminders:'Overdue contact reminders',never_contacted:'Never contacted',stale_hot_leads:'Hot leads without contact for 3 days'},'count',true);
define('sales',{verified_sales:'Verified sales',pending_sales:'Pending sales',cancelled_sales:'Cancelled sales',unlinked_appointment_sales:'Verified sales without appointment link'});
define('sales',{revenue_minor:'Verified revenue'},'money');
define('cohorts',{leads_sold:'Created leads with a verified sale by now'});define('cohorts',{lead_sale_days:'Total lead-to-sale days'},'days');
define('pipeline',{open_opportunities:'Open opportunities',won_opportunities:'Opportunities marked won',lost_opportunities:'Opportunities marked lost',pipeline_missing_values:'Open opportunities missing a value',overdue_expected_closes:'Overdue expected close dates',hot_without_next_step:'Hot open opportunities without a next step'},'count',true);
define('pipeline',{pipeline_minor:'Open pipeline value (known values)',weighted_pipeline_minor:'Weighted pipeline estimate (known values)'},'money',true);
define('tasks',{tasks_due:'Tasks due',tasks_done:'Due tasks completed by now',tasks_cancelled:'Due tasks cancelled',tasks_on_time:'Due tasks completed on time'});
define('tasks_current',{overdue_tasks:'Overdue pending tasks',pending_tasks:'Pending tasks'},'count',true);
define('sales_goals',{monthly_sales_goal:'Personal monthly sales target (sum for team)',team_monthly_sales_goal:'Team monthly sales target'},'count',true);
define('qr',{qr_scans:'QR scan events (campaign owner attribution)'});
define('landing',{page_views:'Landing page view events',page_clicks:'Landing page click events'});
define('farms',{farm_touches_planned:'Farm touches scheduled',farm_touches_completed:'Scheduled farm touches completed by now'});

export type Fact={id:string;label:string;value:string|null;display:string;unit:Unit;period:string;group:string;source:string;note?:string};
export type Alert={group:string;reason:string;fact_ids:string[];severity:number};
export type Analysis={alerts:Alert[];scope:string;role:string;as_of:string;timezone:string;currency:string|null;facts:Fact[];coverage:string[];groups:{id:string;label:string}[];priorities:FieldContext['priorities']};
const shift=(day:string,n:number)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const monday=(day:string)=>shift(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7));
function sum(rows:Row[],key:string):string|null {
 const values=rows.filter(r=>key in r.values).map(r=>r.values[key]);
 if(values.some(v=>v===null)||(!values.length&&key.includes('sales_goal'))) return null;
 if(key.endsWith('_minor')||key.startsWith('stage_value_')) return values.reduce<bigint>((a,v)=>a+BigInt(v!),BigInt(0)).toString();
 const total=values.reduce((a,v)=>a+Number(v),0);
 return Number.isFinite(total)&&Math.abs(total)<=Number.MAX_SAFE_INTEGER?String(Math.round(total*1000)/1000):null;
}
function ratio(a:string|null,b:string|null,multiplier=100):string|null {
 if(a===null||b===null||Number(b)<=0) return null;
 const n=Number(a)/Number(b)*multiplier;
 return Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER?n.toFixed(2):null;
}
function display(value:string|null,unit:Unit,currency:string|null){
 if(value===null)return 'Unavailable';
 if(unit==='money'){
  // Never convert cents to a JS number: aggregate sums may exceed the safe integer range.
  const n=BigInt(value),decimals=currency==='JPY'?0:2,scale=BigInt(10)**BigInt(decimals);
  return `${currency??''} ${(n/scale).toLocaleString('en-CA')}${decimals?'.'+(n%scale).toString().padStart(decimals,'0'):''}`.trim();
 }
 const n=Number(value);return `${n.toLocaleString('en-CA',{maximumFractionDigits:2})}${unit==='percent'?'%':unit==='pp'?' pp':unit==='hours'?' h':unit==='km'?' km':unit==='days'?' days':''}`;
}
export function analyze(c:FieldContext):Analysis {
 const defs={...KPI};
 for(const stage of c.stage_defs){
  defs['stage_count_'+stage.key]={label:`${stage.label} stage: opportunities`,source:'stages',unit:'count',current:true};
  defs['stage_value_'+stage.key]={label:`${stage.label} stage: known value`,source:'stages',unit:'money',current:true};
 }
 const facts:Fact[]=[],alerts:Alert[]=[],groups:{id:string;label:string}[]=[];
 const coverage=[...c.unavailable.map(x=>`${x}: unavailable or not enabled`),
  'Synced data only. Today, this week and this month are incomplete periods. Historical comparisons use complete local days.',
  'Door counts use the latest non-undone visit per session and address/building. Session-reported totals are separate legacy measures; do not add them to event counts.',
  'Time and distance are completed-session totals attributed to the session start day; cross-midnight sessions are not split. Live session duration is excluded.',
  'Activity ratios describe volumes in a period, not the same people moving through a funnel. Lead-to-sale conversion is a creation-date cohort measured through now; recent cohorts have had less time to convert.',
  'QR, page events and farm touches use owner attribution, not proof a particular rep caused an outcome. Scans/clicks are events, not unique people.',
  'Team analytics includes current workspace members only. Team contact names, notes, contact details and GPS paths are excluded.'];
 if(Number(sum(c.rows,'reported_doors'))>Number(sum(c.rows,'doors')))coverage.push('Session-reported doors exceed timestamped visit counts. Legacy or unsynced event history may be incomplete; do not interpret that gap as a performance decline.');
 if(c.sales_timezone&&c.sales_timezone!==c.timezone)coverage.push(`Sales dates use ${c.sales_timezone}; activity uses ${c.timezone}. Cross-source day ratios can differ near midnight.`);
 const periods=[{id:'today',label:'Today (so far)',start:c.local_day,end:shift(c.local_day,1)},
 {id:'week',label:'This week (so far)',start:monday(c.local_day),end:shift(c.local_day,1)},
 {id:'month',label:'This month (so far)',start:c.local_day.slice(0,8)+'01',end:shift(c.local_day,1)},
 {id:'last7',label:'Last 7 complete days',start:shift(c.local_day,-7),end:c.local_day},
 {id:'previous7',label:'Previous 7 complete days',start:shift(c.local_day,-14),end:shift(c.local_day,-7)},
 {id:'last30',label:'Last 30 complete days',start:shift(c.local_day,-30),end:c.local_day},
 {id:'previous30',label:'Previous 30 complete days',start:shift(c.local_day,-60),end:shift(c.local_day,-30)},
 {id:'history',label:`Last ${c.days} complete days`,start:shift(c.local_day,-c.days),end:c.local_day},
 {id:'previous_history',label:`Previous ${c.days} complete days`,start:shift(c.local_day,-c.days*2),end:shift(c.local_day,-c.days)}];
 for(let i=1;i<=4;i++)periods.push({id:`week${i}`,label:`Complete week starting ${shift(monday(c.local_day),-7*i)}`,start:shift(monday(c.local_day),-7*i),end:shift(monday(c.local_day),-7*(i-1))});
 const add=(group:string,key:string,value:string|null,def:Definition,period:string,periodID:string,note?:string)=>{
  facts.push({id:`${group}.${periodID}.${key}`,label:def.label,value,display:display(value,def.unit,c.currency),unit:def.unit,period,group,source:def.source,...(note?{note}:{})});
 };
 const derived=[
 ['conversation_rate','Conversations per 100 doors','conversations','doors',100,'percent'],
 ['lead_per_conversation','Leads created per 100 conversations','leads','conversations',100,'percent'],
 ['appointment_per_lead','Appointments created per 100 leads','appointments','leads',100,'percent'],
 ['appointments_per_100_doors','Appointments created per 100 doors','appointments','doors',100,'ratio'],
 ['sales_per_100_doors','Verified sales per 100 doors','verified_sales','doors',100,'ratio'],
 ['lead_sale_conversion','Created-lead cohort sale conversion','leads_sold','leads',100,'percent'],
 ['average_sale_days','Average lead-to-sale time for converted cohort','lead_sale_days','leads_sold',1,'days'],
 ['task_completion_rate','Due-task completion rate (excluding cancelled)','tasks_done','actionable_tasks',100,'percent'],
 ['task_on_time_rate','Due-task on-time completion rate','tasks_on_time','actionable_tasks',100,'percent'],
 ['farm_completion_rate','Scheduled farm touch completion','farm_touches_completed','farm_touches_planned',100,'percent'],
 ['page_click_rate','Click events per 100 view events','page_clicks','page_views',100,'percent'],
 ['doors_per_hour','Event doors per completed-session hour','doors','active_seconds',3600,'ratio'],
 ['session_goal_rate','Completed door/flyer sessions hitting target','session_goals_met','sessions_with_goals',100,'percent'],
 ] as const;
 function buildGroup(id:string,label:string,rows:Row[],full:boolean){
  groups.push({id,label});
  const usePeriods=full?periods:periods.filter(p=>['today','last7','previous7','last30'].includes(p.id));
  const keys=full?Object.keys(defs):['doors','conversations','leads','appointments','verified_sales','revenue_minor','active_seconds','overdue_tasks','overdue_reminders','hot_without_next_step','open_opportunities','pipeline_minor'];
  for(const p of usePeriods){
   const selected=rows.filter(r=>r.day!==null&&r.day>=p.start&&r.day<p.end);
   const totals:Record<string,string|null>={};
   for(const [key,def] of Object.entries(defs))if(!def.current)totals[key]=c.available.includes(def.source)?sum(selected,key):null;
   totals.actionable_tasks=totals.tasks_due!==null&&totals.tasks_cancelled!==null?String(Number(totals.tasks_due)-Number(totals.tasks_cancelled)):null;
   const period=`${p.label} · ${p.start}–${shift(p.end,-1)}`;
   for(const key of keys){const def=defs[key];if(def.current)continue;
    let val=totals[key];if(val!==null&&key==='active_seconds')val=(Number(val)/3600).toFixed(2);if(val!==null&&key==='distance_meters')val=(Number(val)/1000).toFixed(2);
    add(id,key,val,def,period,p.id);
   }
   for(const [key,label,a,b,m,unit] of derived){
    if(!full&&!['conversation_rate','lead_per_conversation','sales_per_100_doors'].includes(key))continue;
    const numerator=totals[a],denominator=totals[b];
    add(id,key,ratio(numerator,denominator,m),{label,source:`${a} / ${b}`,unit},period,p.id,
      denominator!==null&&Number(denominator)<20?'Small denominator; do not treat this as a reliable trend or cause.':undefined);
   }
   if(full&&totals.revenue_minor!==null&&Number(totals.verified_sales)>0){
    add(id,'average_sale_value',(BigInt(totals.revenue_minor)/BigInt(totals.verified_sales!)).toString(),{label:'Average verified sale value',source:'sales',unit:'money'},period,p.id);
   }
  }
  for(const key of keys){const def=defs[key];if(!def.current)continue;
   add(id,key,c.available.includes(def.source)?sum(rows.filter(r=>r.day===null),key):null,def,`Current snapshot · ${c.local_day}`,'current');
  }
  const own=facts.filter(f=>f.group===id);
  for(const [now,before] of [['last7','previous7'],['last30','previous30'],['history','previous_history']]){
   for(const key of full?['doors','conversations','leads','appointments','verified_sales','revenue_minor','conversation_rate','lead_sale_conversion','task_completion_rate']:['doors','conversations','leads']){
    const a=own.find(f=>f.id===`${id}.${now}.${key}`),b=own.find(f=>f.id===`${id}.${before}.${key}`);if(!a||!b)continue;
    let change:string|null=null;
    if(a.value!==null&&b.value!==null){
     if(a.unit==='percent')change=(Number(a.value)-Number(b.value)).toFixed(2);
     else if(Number(b.value)!==0)change=((Number(a.value)/Number(b.value)-1)*100).toFixed(2);
    }
    add(id,key+'_change',change,{label:`${a.label}: change`,source:a.source,unit:a.unit==='percent'?'pp':'percent'},`${a.period} vs ${b.period}`,`${now}_change`,b.value==='0'?'No percentage growth is defined from a zero baseline.':undefined);
   }
  }
 }
 buildGroup('scope',c.scope==='team'?'Team':'My performance',c.rows,true);
 if(c.scope==='team'){
  for(const person of c.people)buildGroup('rep_'+person.id,person.name,c.rows.filter(r=>r.rep===person.id),false);
 }
 const campaignByID=new Map(c.campaigns.map(c=>[c.id,c]));
 const grouped=new Map<string,Row[]>();
 for(const row of c.rows){const campaign=row.campaign?campaignByID.get(row.campaign):undefined;const key=row.campaign?.startsWith('territory:')?'territory_'+row.campaign.slice(10):campaign?.territory?'territory_'+campaign.territory:campaign?'campaign_'+campaign.id:'unassigned';
  const bucket=grouped.get(key)??[];bucket.push(row);grouped.set(key,bucket);
 }
 const regions=[...grouped].sort((a,b)=>Number(sum(b[1],'doors'))-Number(sum(a[1],'doors'))||a[0].localeCompare(b[0]));
 if(regions.length>60)coverage.push(`Territory detail includes the 60 highest-activity groups of ${regions.length}; scope totals include all groups.`);
 for(const [id,rows] of regions.slice(0,60)){
  const campaign=c.campaigns.find(x=>`campaign_${x.id}`===id);
  const names=c.campaigns.filter(x=>x.territory&&`territory_${x.territory}`===id).map(x=>x.name);
  buildGroup(id,id==='unassigned'?'Unassigned territory':campaign?.name??(names.slice(0,3).join(' / ')||'Territory '+id.replace('territory_','')),rows,false);
 }

 const regional=groups.filter(g=>/^(territory_|campaign_)/.test(g.id)).map(g=>({g,
  doors:facts.find(f=>f.id===`${g.id}.last7.doors`),rate:facts.find(f=>f.id===`${g.id}.last7.conversation_rate`)}))
  .filter(x=>x.doors?.value!==null&&Number(x.doors?.value)>=20&&x.rate?.value!==null);
 for(const entry of regional){
  const rank=1+regional.filter(x=>Number(x.rate?.value)>Number(entry.rate?.value)).length;
  add(entry.g.id,'conversation_rank',String(rank),{label:'Conversation rate rank (territories/campaigns with at least 20 doors)',unit:'count',source:'visits'},'Last 7 complete days','ranking');
 }
 for(const person of c.people){
  const g=c.goals.find(g=>g.rep===person.id)??{rep:person.id,daily:null,weekly:null};
  const group=c.scope==='self'?'scope':'rep_'+g.rep;
  add(group,'daily_goal',g.daily===null?null:String(g.daily),{label:'Personal daily door goal',unit:'count',source:'goals'},'Current target','current');
  add(group,'weekly_goal',g.weekly===null?null:String(g.weekly),{label:'Personal weekly door goal',unit:'count',source:'goals'},'Current target','current');
  const weekRows=c.rows.filter(r=>r.rep===g.rep&&r.day!==null&&r.day>=monday(c.local_day)&&r.day<=c.local_day);
  const weekDoors=c.available.includes('visits')?sum(weekRows,'doors'):null;
  const daysLeft=7-((new Date(c.local_day+'T12:00:00Z').getUTCDay()+6)%7);
  if(g.weekly!==null&&weekDoors!==null){
   const remaining=Math.max(0,g.weekly-Number(weekDoors));
   add(group,'weekly_remaining',String(remaining),{label:'Doors remaining this week',unit:'count',source:'goals + visits'},'Current week','current');
   add(group,'weekly_daily_pace',String(Math.ceil(remaining/daysLeft)),{label:'Doors per day needed through Sunday (including today)',unit:'count',source:'goals + visits'},'Current week','current');
  }
  const doors=facts.find(f=>f.id===`${group}.today.doors`)?.value;
  if(g.daily!==null&&doors!==null&&doors!==undefined){add(group,'daily_remaining',String(Math.max(0,g.daily-Number(doors))),{label:'Doors remaining today',unit:'count',source:'goals + visits'},'Today','current');}
 }
 if(c.lifetime)for(const [key,value]of Object.entries(c.lifetime)){
  let v=value===null?null:String(value);let unit:Unit=(key.includes('rate')||key==='conversation_per_door')?'ratio':key==='distance_walked'?'km':key==='time_tracked'?'hours':'count';
  if(key==='time_tracked'&&v!==null)v=(Number(v)/60).toFixed(2);
  add('scope','lifetime_'+key,v,{label:key.replaceAll('_',' ')+(unit==='ratio'?' (stored ratio)':''),unit,source:'user_stats'},'Personal lifetime · all workspaces','lifetime');
 }
 for(const p of c.priorities){add('scope','lead_'+p.id,'1',{label:`${p.name}: ${p.reason}`,unit:'count',source:'contacts'},'Current private follow-up priority','priority');}
 const targets=c.scope==='team'?c.people.map(p=>'rep_'+p.id):['scope'];
 for(const group of targets){
  const get=(suffix:string)=>facts.find(f=>f.id===`${group}.${suffix}`);
  for(const key of ['overdue_tasks','overdue_reminders','hot_without_next_step']){
   const fact=get('current.'+key);if(fact?.value&&Number(fact.value)>0)alerts.push({group,reason:fact.label,fact_ids:[fact.id],severity:Math.min(50,Number(fact.value))+30});
  }
  const doors=get('today.doors'),goal=get('current.daily_goal');
  // No invented hourly work schedule: below-target is not labelled behind pace.
  if(doors?.value!==null&&goal?.value&&Number(doors?.value)<Number(goal.value))alerts.push({group,reason:'Daily door goal still open; no work schedule assumed',fact_ids:[doors!.id,goal.id],severity:10});
  const talks=get('last7.conversations'),leads=get('last7.leads');
  if(Number(talks?.value)>=20&&leads?.value==='0')alerts.push({group,reason:'Conversations without new leads; review qualification',fact_ids:[talks!.id,leads.id],severity:70});
 }
 alerts.sort((a,b)=>b.severity-a.severity||a.group.localeCompare(b.group));
 if(c.scope==='team'){
  const ranked=c.people.map(p=>({p,f: facts.find(f=>f.id===`rep_${p.id}.last7.doors`)})).filter(x=>x.f?.value!==null)
   .sort((a,b)=>Number(b.f?.value)-Number(a.f?.value)||a.p.id.localeCompare(b.p.id));
  for(const entry of ranked){
   const rank=1+ranked.filter(x=>Number(x.f?.value)>Number(entry.f?.value)).length;
   add('rep_'+entry.p.id,'door_rank',String(rank),{label:'Team door rank (ties share rank)',unit:'count',source:'visits'},'Last 7 complete days','ranking');
  }
 }
 for(const fact of facts)if(fact.group!=='scope')fact.label=`${groups.find(g=>g.id===fact.group)?.label??'Group'} · ${fact.label}`;
 return {alerts,scope:c.scope,role:c.role,as_of:c.as_of,timezone:c.timezone,currency:c.currency,facts,coverage,groups,priorities:c.priorities};
}

/** A bounded evidence set for the LLM. All KPIs remain browsable in report mode. */
export function selectEvidence(a:Analysis,question:string,mode:string):Fact[]{
 const q=question.toLowerCase();
 const terms=q.split(/[^\p{L}\p{N}]+/u).filter(s=>s.length>2&&!['what','how','the','are','for','and','this','doing','today'].includes(s));
 const names=a.groups.filter(g=>g.id!=='scope'&&q.includes(g.label.toLowerCase())).map(g=>g.id);
 const manager=/team|rep|who|help|leading|leader|manager/.test(q);
 const territory=/territor|campaign|area|where/.test(q);
 const alertIDs=new Set(a.alerts.slice(0,8).flatMap(a=>a.fact_ids));
 return [...a.facts].filter(f=>f.value!==null).map(f=>{
  let score=f.group==='scope'?12:0;
  score+=f.id.includes('.today.')?6:f.id.includes('.current.')?8:0;
  if(/better|improv|trend|histor|compar|week|month/.test(q)&&/last7|previous7|last30|previous30|change/.test(f.id))score+=20;
  for(const term of terms)if(`${f.label} ${f.id}`.toLowerCase().includes(term))score+=15;
  if(names.includes(f.group))score+=100;
  if(manager&&f.group.startsWith('rep_'))score+=20;
  if(manager&&alertIDs.has(f.id))score+=80;
  if(/leading|leader|rank|beat/.test(q)&&f.id.includes('.ranking.'))score+=80;
  if(territory&&/^(territory_|campaign_)/.test(f.group)){
   score+=30;
   const rank=a.facts.find(x=>x.id===`${f.group}.ranking.conversation_rank`);
   if(rank?.value&&Number(rank.value)<=10&&(/\.ranking\.|\.last7\.(doors|conversations|conversation_rate)$/.test(f.id)))score+=100-Number(rank.value);
  }
  if(/follow|contact/.test(q)&&f.period==='Current private follow-up priority')score+=45;
  if(mode==='brief'&&f.group!=='scope')score-=30;
  return {f,score};
 }).sort((a,b)=>b.score-a.score||a.f.id.localeCompare(b.f.id)).slice(0,mode==='brief'?35:160).map(x=>x.f);
}
export function groundedReply(raw:string,evidence:Fact[],mode:string){
 const {message}=z.object({message:z.string().trim().min(10).max(mode==='brief'?500:2400)}).strict().parse(JSON.parse(raw));
 const byID=new Map(evidence.map(f=>[f.id,f]));const used:Fact[]=[];
 // The model may select facts; only the server inserts a numerical claim and its full label/period.
 const text=message.replace(/\[\[([^\]]+)\]\]/g,(_,id:string)=>{
  const fact=byID.get(id);if(!fact)throw Error('Unknown evidence reference');used.push(fact);return '';
 });
 if(/\d|https?:|www\.|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|percent)\b/i.test(text))throw Error('Unverified numerical claim');
 if(/\b(?:awarded|credited|purchased|equipped|deducted|updated your|changed your|saved your)\b/i.test(text))throw Error('Unsupported action claim');
 if(!used.length)throw Error('Missing evidence');
 const rendered=message.replace(/\[\[([^\]]+)\]\]/g,(_,id:string)=>{
  const f=byID.get(id)!;return `${f.label}: ${f.display} (${f.period})`;
 });
 return {message:rendered,evidence:[...new Map(used.map(f=>[f.id,f])).values()]};
}
