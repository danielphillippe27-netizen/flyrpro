import assert from 'node:assert/strict';
import { checkedRetention, checkedRetentionCandidates, dispatchRetentionCandidates, retentionEnabled } from '../retention';
assert.deepEqual(checkedRetention({ retentionDays: null, version: 0 }), { retentionDays: null, version: 0 });
assert.equal(checkedRetention({ retentionDays: 3650, version: 2 }).retentionDays, 3650);
for (const value of [null, [], {}, { retentionDays: 0, version: 0 }, { retentionDays: 3651, version: 0 }, { retentionDays: 1.5, version: 0 }, { retentionDays: '30', version: 0 }, { retentionDays: null, version: -1 }, { retentionDays: 30, version: '1' }, { retentionDays: null, version: 0, userId: 'foreign' }]) assert.throws(() => checkedRetention(value));
console.log('Retention settings validation passed');

async function dispatchChecks() {
  for (const value of [undefined, 'false', 'TRUE', '1', '']) { assert.equal(retentionEnabled(value,'true'),false); assert.equal(retentionEnabled('true',value),false); }
  assert.equal(retentionEnabled('true','true'),true);
  const row={recording_id:'a084ec69-39d6-465a-a7d8-46ae03f40001',policy_version:1};
  assert.deepEqual(checkedRetentionCandidates([row]),[row]);
  for (const value of [null,{},[row,row],[{...row,policy_version:0}],[{...row,policy_version:'1'}],[{...row,recording_id:'foreign'}],[{...row,user_id:'foreign'}]]) assert.throws(()=>checkedRetentionCandidates(value));
  const second={...row,recording_id:'a084ec69-39d6-465a-a7d8-46ae03f40002'};
  let deferred=0, visited=0;
  assert.deepEqual(await dispatchRetentionCandidates([row,second],async item=>{ visited++; if(item===row)throw new Error('failed expiry'); return true; },async()=>{deferred++;}),{recordingsExpired:1,retentionFailures:1,retentionRetryFailures:0});
  assert.equal(visited,2); assert.equal(deferred,1);
  assert.deepEqual(await dispatchRetentionCandidates([row],async()=>false,async()=>{throw new Error('must not defer stale policy');}),{recordingsExpired:0,retentionFailures:0,retentionRetryFailures:0});
  assert.deepEqual(await dispatchRetentionCandidates([row,second],async item=>{if(item===row)throw new Error('failed');return true;},async()=>{throw new Error('retry checkpoint failed');}),{recordingsExpired:1,retentionFailures:1,retentionRetryFailures:1});
  console.log('Retention rollout, candidate validation and failure isolation passed');
}
void dispatchChecks();
