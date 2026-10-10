const {test}=require('node:test');
const assert=require('node:assert/strict');
const {QuestionInput}=require('../desktop/question.cjs');
const {ResponseCycle}=require('../desktop/response.cjs');
const {readLogin,setLogin}=require('../desktop/login.cjs');
const {diagnosticMessage}=require('../desktop/core.cjs');
test('stalled transcription has a bounded wait',async()=>{
  let id;
  const input=new QuestionInput({start:async v=>{id=v;},done:()=>{},transcriptionTimeoutMs:10});
  const pending=input.begin();input.report({type:'transcription_started',capture_id:id});
  await assert.rejects(pending,/タイムアウト/);assert.equal(input.current,null);
});
test('recognized text never enters diagnostic messages',()=>{
  const event={type:'capture_done',capture_id:'one',text:'private question',duration:2};
  const diagnostic=diagnosticMessage(event);
  assert.equal('text' in diagnostic,false);assert.equal(diagnostic.duration,2);
  assert.equal(event.text,'private question');
});
test('transcription state and cancellation reject stale recognition results',async()=>{
  let id,states=0,results=0;
  const input=new QuestionInput({start:async v=>{id=v;},transcribing:()=>states++,done:()=>results++});
  const pending=input.begin();
  input.report({type:'transcription_started',capture_id:id});
  input.report({type:'transcription_started',capture_id:id});
  assert.equal(states,1);input.cancel();await pending;
  input.report({type:'capture_done',capture_id:id,text:'stale'});
  assert.equal(results,0);assert.equal(input.current,null);
});
test('cancelled capture ignores late events and cannot resume response',async()=>{
  let id,resumed=0;
  const input=new QuestionInput({start:async value=>{id=value;},done:()=>{throw Error('stale event');}});
  const c=new ResponseCycle({allowed:()=>true,activate:()=>{},pause:async()=>{},play:async()=>{},stopAudio:()=>{},
    input:()=>input.begin(),resume:async()=>resumed++,cooldownMs:0,fatal:e=>{throw e;}});
  const pending=c.begin();
  while(!id) await new Promise(r=>setTimeout(r,1));
  c.cancel();input.cancel();input.report({type:'capture_done',capture_id:id});await pending;
  assert.equal(resumed,0);
});
test('capture completion resumes once and rejects duplicate detection',async()=>{
  let id,done=0,resumed=0;
  const input=new QuestionInput({start:async v=>{id=v;},done:()=>done++});
  const c=new ResponseCycle({allowed:()=>true,activate:()=>{},pause:async()=>{},play:async()=>{},stopAudio:()=>{},
    input:()=>input.begin(),resume:async()=>resumed++,cooldownMs:0,fatal:e=>{throw e;}});
  const pending=c.begin();while(!id)await new Promise(r=>setTimeout(r,1));
  assert.equal(await c.begin(),false);
  input.report({type:'capture_done',capture_id:id});input.report({type:'capture_done',capture_id:id});
  assert.equal(await pending,true);assert.equal(done,1);assert.equal(resumed,1);
});
test('custom startup name, disabled entry and unrelated entries are distinguished',()=>{
  const entry={name:'JARVIS Local',path:process.execPath,args:['--login-start'],scope:'user',enabled:true};
  let items=[entry];const app={getLoginItemSettings:()=>({openAtLogin:false,launchItems:items}),setLoginItemSettings:()=>{}};
  assert.equal(readLogin(app),true);
  items=[{...entry,enabled:false}];assert.equal(readLogin(app),false);assert.throws(()=>setLogin(app,true));
  items=[{...entry,name:'other'}];assert.equal(readLogin(app),false);
  // Electron launchItems.args omits switches such as --login-start.
  items=[{...entry,args:[]}];assert.equal(readLogin(app),true);
});
