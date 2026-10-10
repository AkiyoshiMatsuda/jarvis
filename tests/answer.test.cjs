const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AnswerCycle,askLocal,LocalAIError}=require('../desktop/answer.cjs');
const {ResponseCycle}=require('../desktop/response.cjs');
const tick=()=>new Promise(r=>setImmediate(r));
test('only local model gets question, with no conversation history or tools',async()=>{
  const requests=[];
  const request=async(route,body)=>{
    requests.push({route,body});return route==='/api/show'?{details:{format:'gguf'}}:
      {done:true,message:{content:'回答です。'},done_reason:'stop'};
  };
  assert.equal((await askLocal('質問',{request})).text,'回答です。');
  assert.equal(requests[0].body.messages,undefined);
  assert.equal(requests[1].body.messages.length,2);
  assert.equal(requests[1].body.messages[1].content,'質問');
  assert.equal(requests[1].body.tools,undefined);
  assert.equal(requests[1].body.keep_alive,'10m');
  assert.match(requests[1].body.messages[0].content,/文末の問いかけまで、自然な日本語/);
  assert.match(requests[1].body.messages[0].content,/求められていない提案や追加質問を末尾に付けない/);
});
test('cloud or unknown model blocked before sending question',async()=>{
  for(const info of [{remote_host:'cloud',details:{format:'gguf'}},{remote_model:'qwen',details:{format:'gguf'}},{}]) {
    let calls=0;
    await assert.rejects(askLocal('private',{request:async()=>{calls++;return info;}}),/クラウド/);
    assert.equal(calls,1);
  }
});
test('empty and oversized input do not reach provider',async()=>{
  for(const input of ['', '  ', 'x'.repeat(2001),null]) {
    await assert.rejects(askLocal(input,{request:()=>assert.fail('should not send')}),/2000/);
  }
});
test('missing model and connection failure give actionable local errors',async()=>{
  await assert.rejects(askLocal('question',{request:async()=>{throw Object.assign(Error('private'),{code:'ECONNREFUSED'});}}),/Ollamaを起動/);
  await assert.rejects(askLocal('question',{request:async()=>{throw new LocalAIError('AIモデルがありません。');}}),/モデルがありません/);
});
test('empty answer fails and truncation is exposed',async()=>{
  const request=content=>async route=>route==='/api/show'?{details:{format:'gguf'}}:{done:true,message:{content},done_reason:'length'};
  await assert.rejects(askLocal('a',{request:request('')}),/取得/);
  assert.equal((await askLocal('a',{request:request('short')})).truncated,true);
});
test('cancel returns promptly and late success never reaches UI',async()=>{
  let release,signal,completions=0,failures=0;
  const c=new AnswerCycle({ask:(_q,o)=>{signal=o.signal;return new Promise(r=>release=r);},started:()=>{},complete:()=>completions++,failed:()=>failures++});
  const pending=c.begin('first');assert.equal(await c.begin('duplicate'),false);
  c.cancel();assert.equal(await pending,false);assert.equal(signal.aborted,true);
  release({text:'late'});await tick();assert.equal(completions,0);assert.equal(failures,0);
});
test('timeout settles even if provider ignores abort',async()=>{
  let error;
  const c=new AnswerCycle({ask:()=>new Promise(()=>{}),started:()=>{},complete:()=>assert.fail(),failed:e=>error=e,timeoutMs:10});
  assert.equal(await c.begin('question'),false);assert.match(error,/時間内/);assert.equal(c.current,null);
});
test('provider error does not leak question or arbitrary error to UI',async()=>{
  let error;
  const c=new AnswerCycle({ask:async()=>{throw Error('private question');},started:()=>{},complete:()=>{},failed:e=>error=e});
  await c.begin('private question');assert.equal(error.includes('private'),false);
});
test('voice cycle waits for answer and stop never restarts microphone',async()=>{
  let asked=0,resumed=0,finish;
  const c=new ResponseCycle({allowed:()=>true,activate:()=>{},pause:async()=>{},play:async()=>{},stopAudio:()=>{},input:async()=>{},
    answer:()=>{asked++;return new Promise(r=>finish=r);},resume:async()=>resumed++,fatal:()=>assert.fail(),cooldownMs:0});
  const pending=c.begin();while(!finish)await new Promise(r=>setTimeout(r,1));
  assert.equal(resumed,0);c.cancel();finish();await pending;
  assert.equal(asked,1);assert.equal(resumed,0);
});
test('voice answer completes before microphone resumes',async()=>{
  const order=[];
  const c=new ResponseCycle({allowed:()=>true,activate:()=>{},pause:async()=>{},play:async()=>{},stopAudio:()=>{},
    input:async()=>order.push('text'),answer:async()=>order.push('answer'),resume:async()=>order.push('resume'),fatal:()=>assert.fail(),cooldownMs:0});
  assert.equal(await c.begin(),true);assert.deepEqual(order,['text','answer','resume']);
});
