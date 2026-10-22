import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshDaily } from './daily-refresh-core.mjs';
const snapshot={schema:'momentum.daily.v1',asOf:'2026-10-21',candidates:[{}]};
test('daily refresh updates prices before building and only then marks completion',async()=>{
  const calls=[],states=[];
  const r=await refreshDaily({runStage:async stage=>(calls.push(stage),{code:0}),readSnapshot:async()=>snapshot,saveStatus:async s=>states.push(s)});
  assert.deepEqual(calls,['prices','signals']);assert.equal(r.state,'completed');assert.equal(r.asOf,'2026-10-21');assert.equal(states[0].state,'running');assert.equal(states.at(-1).candidates,1);
});
test('failed price update does not build or relabel an old snapshot as freshly updated',async()=>{
  const calls=[];
  const r=await refreshDaily({runStage:async s=>(calls.push(s),{code:1}),readSnapshot:async()=>{throw Error('must not read');},saveStatus:async()=>{}});
  assert.deepEqual(calls,['prices']);assert.equal(r.state,'failed');assert.equal(r.asOf,null);assert.equal(r.error.stage,'prices');
});
test('cached mode skips the API stage and explicitly retains its cached status',async()=>{
  const calls=[];
  const r=await refreshDaily({cached:true,runStage:async s=>(calls.push(s),{code:0}),readSnapshot:async()=>snapshot,saveStatus:async()=>{}});
  assert.deepEqual(calls,['signals']);assert.equal(r.state,'cached');assert.equal(r.mode,'cached');
});
test('a failed or malformed signal snapshot never becomes a successful refresh',async()=>{
  const r=await refreshDaily({runStage:async()=>({code:0}),readSnapshot:async()=>({schema:'bad'}),saveStatus:async()=>{}});
  assert.equal(r.state,'failed');assert.equal(r.error.kind,'invalid_snapshot');
});
