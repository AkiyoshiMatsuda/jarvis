const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {createOllamaStarter}=require('../desktop/ollama.cjs');
const refused=()=>Object.assign(Error('offline'),{code:'ECONNREFUSED'});
test('existing Ollama service is reused without spawning',async()=>{
  await createOllamaStarter({check:async()=>{},launch:()=>assert.fail()})();
});
test('concurrent requests start local Ollama once, with hidden window and loopback binding',async()=>{
  let ready=false,spawns=0;
  const ensure=createOllamaStarter({localAppData:'C:\\Users\\test\\AppData\\Local',exists:()=>true,check:async()=>{if(!ready)throw refused();},wait:async()=>{ready=true;},
    launch:(exe,args,options)=>{spawns++;assert.ok(exe.endsWith('ollama.exe'));assert.deepEqual(args,['serve']);assert.equal(options.windowsHide,true);assert.equal(options.env.OLLAMA_HOST,'127.0.0.1:11434');const child=new EventEmitter();child.unref=()=>{};return child;}});
  await Promise.all([ensure(),ensure()]);assert.equal(spawns,1);
});
test('missing executable and unresponsive service report actionable errors',async()=>{
  await assert.rejects(createOllamaStarter({check:async()=>{throw refused();},localAppData:'C:\\test',exists:()=>false})(),/見つかりません/);
  await assert.rejects(createOllamaStarter({check:async()=>{throw Error('timeout');},launch:()=>assert.fail()})(),/応答を確認/);
});
test('aborted caller does not launch service',async()=>{
  const c=new AbortController();c.abort();await assert.rejects(createOllamaStarter({check:()=>assert.fail()})({signal:c.signal}),{name:'AbortError'});
});
