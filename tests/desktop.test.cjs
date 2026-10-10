const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {JsonLines, defaults, readSettings, saveSettings} = require('../desktop/core.cjs');
const {WorkerClient} = require('../desktop/worker-client.cjs');
const {ResponseCycle,ResponseAudio}=require('../desktop/response.cjs');
test('response suppresses duplicates and resumes after playback failure',async()=>{
  let resume=0,errors=0,release;
  const waiting=new Promise(r=>release=r);
  const c=new ResponseCycle({allowed:()=>true,activate:()=>{},pause:()=>waiting,
    play:async()=>{throw Error('missing audio');},stopAudio:()=>{},
    speechError:()=>errors++,fatal:e=>{throw e;},resume:async()=>resume++,cooldownMs:0});
  const first=c.begin(); assert.equal(await c.begin(),false); release();
  assert.equal(await first,true); assert.equal(errors,1); assert.equal(resume,1);
});
test('stop during response prevents later automatic resume',async()=>{
  let release,resumed=false,enabled=true;
  const audio=new ResponseAudio(()=>{},()=>{},1000);
  const c=new ResponseCycle({allowed:()=>enabled,activate:()=>{},pause:async()=>{},
    play:id=>{release=()=>audio.report(id,'ended');return audio.play(id,.8);},
    stopAudio:()=>audio.cancel(),speechError:()=>{},fatal:e=>{throw e;},resume:async()=>{resumed=true;},cooldownMs:0});
  const pending=c.begin(); await new Promise(r=>setImmediate(r));
  enabled=false;c.cancel();release();await pending;
  assert.equal(resumed,false);assert.equal(audio.pending,null);
});
test('audio rejects timeout and ignores stale completion',async()=>{
  const audio=new ResponseAudio(()=>{},()=>{},20);
  const old=audio.play('old',.8);const current=audio.play('new',.8);await old;
  audio.report('old','ended');assert.equal(audio.pending.id,'new');
  await assert.rejects(current,/時間内/);assert.equal(audio.pending,null);
});
test('cancel while microphone pause is pending never starts audio',async()=>{
  let release,played=false,resumed=false;
  const c=new ResponseCycle({allowed:()=>true,activate:()=>{},pause:()=>new Promise(r=>release=r),
    play:async()=>{played=true;},stopAudio:()=>{},speechError:()=>{},fatal:e=>{throw e;},
    resume:async()=>{resumed=true;},cooldownMs:0});
  const pending=c.begin();c.cancel();release();await pending;
  assert.equal(played,false);assert.equal(resumed,false);
});
test('JSONL accepts split UTF-8 and multiple lines', () => {
  const results=[]; const parser=new JsonLines(m=>results.push(m));
  const row={version:1,type:'ready',event_id:'1',name:'マイク'};
  const b=Buffer.from(JSON.stringify(row)+'\n'+JSON.stringify({...row,type:'ack'})+'\n');
  for(const byte of b) parser.push(Buffer.from([byte]));
  assert.equal(results.length,2); assert.equal(results[0].name,'マイク');
});
test('worker timeout is bounded and graceful shutdown leaves no child', async () => {
  const c=new WorkerClient(process.execPath,[path.join(__dirname,'fixtures','worker.cjs')]);
  try {
    await c.start();
    assert.equal((await c.request('ping')).type,'pong');
    await assert.rejects(c.request('ping',{ignore:true},100), /タイムアウト/);
  } finally {await c.stop();}
  assert.equal(c.child,null);
});
test('unexpected worker death is reported', async () => {
  const c=new WorkerClient(process.execPath,[path.join(__dirname,'fixtures','worker.cjs')]);
  try {
    await c.start();
    const fault=new Promise(resolve=>c.once('fault',resolve));
    c.child.kill();
    assert.match((await fault).message,/終了/);
    assert.equal(c.ready,false);
  } finally {await c.stop();}
});
test('JSONL rejects invalid and overlong messages', () => {
  assert.throws(()=>new JsonLines(()=>{}).push(Buffer.from('{"type":"execute"}\n')));
  assert.throws(()=>new JsonLines(()=>{}).push(Buffer.alloc(65537,65)));
});
test('settings persist stopped state; corruption never enables microphone', () => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-test-')); const file=path.join(folder,'settings.json');
  try {
    const s={...defaults(),device:{name:'Mic',hostapi:'WASAPI'},monitoring_enabled:true};
    saveSettings(file,s); assert.equal(readSettings(file).settings.monitoring_enabled,true);
    saveSettings(file,{...s,monitoring_enabled:false}); assert.equal(readSettings(file).settings.monitoring_enabled,false);
    fs.writeFileSync(file,'{broken'); assert.equal(readSettings(file).settings.monitoring_enabled,false);
    assert.ok(readSettings(file).warning);
  } finally {fs.rmSync(folder,{recursive:true});}
});
