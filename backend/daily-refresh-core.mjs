export async function refreshDaily({cached=false,runStage,readSnapshot,saveStatus,now=()=>new Date().toISOString()}) {
  const state={schema:'daily.refresh.v1',startedAt:now(),finishedAt:null,state:'running',mode:cached?'cached':'network',stage:cached?'signals':'prices',asOf:null,candidates:null,error:null};
  await saveStatus({...state});
  try {
    if(!cached) {
      const result=await runStage('prices');
      if(result.code!==0)throw Object.assign(Error(),{stage:'prices',kind:'stage_failed'});
      state.stage='signals';await saveStatus({...state});
    }
    const result=await runStage('signals');
    if(result.code!==0)throw Object.assign(Error(),{stage:'signals',kind:'stage_failed'});
    const snapshot=await readSnapshot();
    if(snapshot?.schema!=='momentum.daily.v1'||!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.asOf)||!Array.isArray(snapshot.candidates)||!Number.isFinite(Date.parse(snapshot.asOf))||new Date(snapshot.asOf).toISOString().slice(0,10)!==snapshot.asOf)throw Object.assign(Error(),{stage:'signals',kind:'invalid_snapshot'});
    state.state=cached?'cached':'completed';state.asOf=snapshot.asOf;state.candidates=snapshot.candidates.length;state.stage=null;
  }catch(error) {
    state.state='failed';state.error={stage:error.stage||state.stage,kind:error.kind||'execution_failed',message:'갱신을 완료하지 못했습니다. 마지막 성공 자료는 유지합니다.'};
  }
  state.finishedAt=now();await saveStatus({...state});return state;
}
