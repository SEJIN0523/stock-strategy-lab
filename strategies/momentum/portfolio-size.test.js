import test from 'node:test';
import assert from 'node:assert/strict';
import {workload} from './portfolio-size.js';
test('workload deduplicates a partial buy and cancellation but counts a deferred sell on each day',()=>{
  const order={code:'000001',side:'buy',signalDate:'2026-10-19',reason:'entry'};
  const sale={code:'000002',side:'sell',signalDate:'2026-10-19',reason:'stop'};
  const run={curve:[{date:'2026-10-20',positions:2},{date:'2026-10-21',positions:1}],log:[{...order,date:'2026-10-20',event:'fill'},{...order,date:'2026-10-20',event:'cancel'},{...sale,date:'2026-10-20',event:'defer'},{...sale,date:'2026-10-21',event:'fill'}]};
  const w=workload(run);assert.equal(w.meanDailyOrderAttempts,1.5);assert.equal(w.maximumDailyOrderAttempts,2);assert.equal(w.daysWithOrderAttempts,2);assert.equal(w.meanHoldings,1.5);assert.equal(w.filledOrders,2);
  assert.equal(workload(run,'2026-10-20').observedSessions,1);assert.equal(workload(run,'2026-10-20').filledOrders,1);
});
