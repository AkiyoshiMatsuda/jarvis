const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Recovery}=require('../desktop/recovery.cjs');
const {setLogin,loginOptions}=require('../desktop/login.cjs');
const {validate,defaults}=require('../desktop/core.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('five attempts, duplicate faults coalesced, permanent error halts',async()=>{
  let attempts=0,last;
  const r=new Recovery({allowed:()=>true,attempt:async()=>{attempts++;throw Error('unplugged');},status:s=>last=s,delays:[1,1,1,1,1]});
  r.fail(Error('crash'));r.fail(Error('duplicate'));
  await sleep(100);assert.equal(attempts,5);assert.equal(last,'ERROR');
  r.reset();r.fail(Object.assign(Error('missing model'),{permanent:true}));await sleep(10);
  assert.equal(attempts,5);assert.equal(r.halted,true);r.cancel();
});
test('pause cancels pending attempt and in-flight continuation',async()=>{
  let enabled=true,calls=0,release,valid;
  const r=new Recovery({allowed:()=>enabled,attempt:async check=>{calls++;valid=check;await new Promise(r=>release=r);},status:()=>{},delays:[10]});
  r.fail(Error());enabled=false;r.cancel();await sleep(30);assert.equal(calls,0);
  enabled=true;r.fail(Error()); // cancellation preserves attempts; explicit reset is required after exhaustion
  r.reset();r.fail(Error());await sleep(30);enabled=false;r.cancel();assert.equal(valid(),false);release();await sleep(1);
  assert.equal(r.stable,null);
});
test('brief success does not reset failure budget; stable success does',async()=>{
  const r=new Recovery({allowed:()=>true,attempt:async()=>{},status:()=>{},delays:[1,1],stableMs:60});
  r.fail(Error());await sleep(20);assert.equal(r.count,1);
  r.fail(Error());await sleep(20);assert.equal(r.count,2);
  await sleep(80);assert.equal(r.count,0);r.cancel();
});
test('legacy settings default autostart off and login setting is verified',()=>{
  assert.equal(validate({...defaults(),auto_start:undefined}).auto_start,false);
  assert.throws(()=>validate({...defaults(),auto_start:'yes'}));
  let saved;
  const fake={setLoginItemSettings:s=>saved=s,getLoginItemSettings:()=>({openAtLogin:false,launchItems:saved.openAtLogin?[{...saved,scope:'user'}]:[]})};
  setLogin(fake,true);assert.equal(saved.openAtLogin,true);assert.deepEqual(saved.args,['--login-start']);
  setLogin(fake,false);assert.equal(saved.openAtLogin,false);
  assert.equal(loginOptions('C:\\app\\JARVIS.exe').name,'JARVIS Local');
});
