const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Conversation,validateHistory,MAX_CHARS}=require('../desktop/conversation.cjs');
const {AnswerCycle,askLocal}=require('../desktop/answer.cjs');
const {ResponseCycle}=require('../desktop/response.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('history is sent in role order only to verified local model',async()=>{
  const c=new Conversation();c.commit('好きな果物はマンゴー',{text:'覚えました。'},c.version);
  let sent;
  await askLocal('何が好き？',{history:c.context(),request:async(route,body)=>{
    if(route==='/api/show')return {details:{format:'gguf'}};
    sent=body;return {done:true,message:{content:'マンゴーです。'}};
  }});
  assert.deepEqual(sent.messages.slice(1),[...c.context(),{role:'user',content:'何が好き？'}]);
  assert.equal(sent.tools,undefined);
  c.context()[0].content='changed';assert.equal(c.context()[0].content,'好きな果物はマンゴー');
});
test('history retains complete pairs within both limits',()=>{
  const c=new Conversation();
  for(let i=0;i<8;i++)c.commit(`q${i}`,{text:`a${i}`},c.version);
  assert.equal(c.context().length,12);assert.equal(c.context()[0].content,'q2');
  c.commit('long',{text:'a'.repeat(MAX_CHARS-4)},c.version);
  assert.equal(c.context().length,2);assert.equal(c.trimmed,true);
  c.commit('too long',{text:'a'.repeat(MAX_CHARS)},c.version);
  assert.equal(c.context().length,0);
  c.clear();assert.equal(c.trimmed,false);
});
test('history rejects system roles, incomplete pairs and over-budget text',()=>{
  for(const h of [[{role:'system',content:'x'},{role:'assistant',content:'a'}],[{role:'user',content:'q'}],
    [{role:'user',content:'x'.repeat(MAX_CHARS)},{role:'assistant',content:'a'}]])assert.throws(()=>validateHistory(h));
});
test('reset or cancel cannot commit late answers; successful earlier turns survive cancellation',async()=>{
  const conversation=new Conversation();conversation.commit('first',{text:'answer'},0);
  let resolve,completed=0;
  const cycle=new AnswerCycle({conversation,ask:()=>new Promise(r=>resolve=r),started:()=>{},complete:()=>completed++,failed:()=>assert.fail()});
  let running=cycle.begin('cancel');cycle.cancel();await running;resolve({text:'late'});await wait(0);
  assert.equal(conversation.context().length,2);assert.equal(completed,0);
  running=cycle.begin('reset');conversation.clear();resolve({text:'stale'});await running;
  assert.equal(conversation.context().length,0);assert.equal(completed,0);
});
test('failed and truncated answers never enter history; retry uses prior context once',async()=>{
  const conversation=new Conversation();let mode='fail',seen;
  const cycle=new AnswerCycle({conversation,started:()=>{},failed:()=>{},complete:()=>{},ask:async(_q,o)=>{
    seen=o.history;if(mode==='fail')throw Error('failure');return {text:'answer',truncated:mode==='partial'};
  }});
  await cycle.begin('q');assert.equal(conversation.context().length,0);
  mode='partial';await cycle.begin('q');assert.equal(conversation.context().length,0);
  mode='success';await cycle.begin('q');assert.deepEqual(seen,[]);assert.equal(conversation.context().length,2);
  await cycle.begin('next');assert.equal(seen.length,2);assert.equal(conversation.context().length,4);
});
test('idle timeout clears history while active operations suspend the timer',async()=>{
  let expired=0;const c=new Conversation({idleMs:15,onExpire:()=>expired++});
  c.commit('q',{text:'a'},0);c.idle(true);c.idle(false);await wait(25);
  assert.equal(c.context().length,2);assert.equal(expired,0);
  c.idle(true);await wait(25);assert.equal(c.context().length,0);assert.equal(expired,1);
  c.idle(true,true);c.clear();await wait(25);assert.equal(expired,1);
});
test('voice follow-up skips greeting and returns to listening after no speech',async()=>{
  let played=0,resumed=0,captured=0;
  const c=new ResponseCycle({allowed:()=>true,activate:()=>{},pause:async()=>{},play:async()=>played++,stopAudio:()=>{},
    input:async()=>captured++,answer:async()=>{},resume:async()=>resumed++,cooldownMs:0,fatal:()=>assert.fail()});
  assert.equal(await c.begin({greet:false}),true);assert.equal(played,0);assert.equal(captured,1);assert.equal(resumed,1);
});
