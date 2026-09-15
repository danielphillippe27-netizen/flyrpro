import type { FieldContext } from '../intelligence';
export const user='00000000-0000-4000-8000-000000000001',workspace='00000000-0000-4000-8000-000000000002',rep='00000000-0000-4000-8000-000000000003',campaign='00000000-0000-4000-8000-000000000004';
export function fixture():FieldContext{return {
 stage_defs:[],version:2,actor:user,role:'owner',scope:'self',timezone:'America/Toronto',sales_timezone:'America/Toronto',as_of:'2026-09-15T16:00:00Z',local_day:'2026-09-15',first_day:'2026-03-19',days:90,
 people:[{id:user,name:'Daniel'}],campaigns:[{id:campaign,name:'North',territory:null}],goals:[{rep:user,daily:75,weekly:500}],
 available:['visits','sessions','leads','activities','contacts','goals','sales','tasks','tasks_current','cohorts','pipeline','sales_goals'],unavailable:['qr','landing','farms'],currency:'CAD',lifetime:null,priorities:[],
 rows:[
  {rep:user,campaign,day:'2026-09-15',values:{doors:'42',conversations:'18',leads:'4',appointments:'2',revenue_minor:'900719925474099300',verified_sales:'3'}},
  {rep:user,campaign,day:'2026-09-14',values:{doors:'100',conversations:'20',leads:'4',appointments:'2',verified_sales:'2',leads_sold:'1',lead_sale_days:'5',tasks_due:'4',tasks_done:'2',tasks_cancelled:'1',tasks_on_time:'1'}},
  {rep:user,campaign,day:'2026-09-07',values:{doors:'50',conversations:'20',leads:'2',appointments:'1'}},
  {rep:user,campaign,day:null,values:{overdue_reminders:'2',overdue_tasks:'1',pipeline_minor:'900719925474099300',open_opportunities:'1'}}
 ]
};}
