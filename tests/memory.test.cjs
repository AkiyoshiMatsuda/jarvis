const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Memory,memoryCommand}=require('../desktop/memory.cjs');
function fixture(extract){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-memory-'));const file=path.join(dir,'memory.enc');const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s.split('').reverse().join('')),decryptString:b=>b.toString().split('').reverse().join('')};const memory=new Memory({file,storage,extract});return {memory,finish:()=>{fs.rmSync(file,{force:true});fs.rmSync(file+'.tmp',{force:true});fs.rmdirSync(dir);}};}
test('grounded auto memory, expiry, encrypted reload, limited context and disabled use',async()=>{
 const {memory:m,finish}=fixture(async()=>({add:[{quote:'私はPythonを勉強しています',days:30},{quote:'私は医師です',days:180}]}));
 try{m.queue('私はPythonを勉強しています');await m.tick({idle:true});assert.equal(m.items.length,1);assert.match(m.context('学習'),/Python/);assert.ok(!fs.readFileSync(m.file).includes(Buffer.from('Python')));m.items=[];m.load();assert.equal(m.items.length,1);m.enabled=false;assert.equal(m.context('学習'),'');m.enabled=true;m.now=()=>Date.now()+31*86400000;assert.equal(m.context('学習'),'');assert.equal(m.snapshot().items[0].status,'expired');}finally{finish();}
});
test('retirement archives instead of deleting; edits and explicit delete are durable',async()=>{
 const {memory:m,finish}=fixture();try{m.add('私はコーヒーが好き');const id=m.items[0].id;m.extract=async()=>({add:[{quote:'私は紅茶が好き',days:180}],retire:[id]});m.queue('私は紅茶が好き');await m.tick({idle:true});assert.equal(m.items[0].status,'archived');m.edit(id,'私は水が好き');assert.match(m.context('好み'),/水/);m.remove(id);assert.ok(!m.items.some(r=>r.id===id));m.clear();m.load();assert.equal(m.items.length,0);}finally{finish();}
});
test('foreground/clear cancels pending extraction and prevents resurrection',async()=>{
 let release;const {memory:m,finish}=fixture(()=>new Promise(r=>release=r));try{m.queue('短い回答が好き');const job=m.tick({idle:true});m.clear();release({add:[{quote:'短い回答が好き',days:180}]});await job;assert.equal(m.items.length,0);m.queue('次の情報');await m.tick({idle:false});assert.equal(m.run,null);}finally{finish();}
});
test('secret filtering, invalid TTL, hallucinations and explicit memory commands',async()=>{
 const {memory:m,finish}=fixture(async()=>({add:[{quote:'短い回答が好き',days:9999}]}));try{assert.throws(()=>m.add('パスワードは12345'));m.queue('api_key=secret');assert.equal(m.pending,null);m.queue('短い回答が好き');await m.tick({idle:true});assert.equal(m.items.length,0);assert.deepEqual(memoryCommand('短い回答が好き、覚えて'),{kind:'add',text:'短い回答が好き、'});assert.equal(memoryCommand('記憶をすべて忘れて').kind,'clear');assert.equal(memoryCommand('Pythonを忘れて').text,'Python');}finally{finish();}
});
test('partial results are not committed and cancelled streams cannot update display',async()=>{
 const {AnswerCycle}=require('../desktop/answer.cjs');let release,partial,shown=[];const c=new AnswerCycle({ask:(_q,o)=>{partial=o.onPartial;partial('途中');return new Promise(r=>release=r);},started:()=>{},partial:x=>shown.push(x),complete:()=>assert.fail('late commit'),failed:()=>{}});const job=c.begin('質問');c.cancel();partial('後から');release({text:'回答'});await job;assert.deepEqual(shown,['途中']);
});
test('corrupt encrypted storage is not overwritten by learning until explicit clear',()=>{
 const {memory:m,finish}=fixture();try{fs.writeFileSync(m.file,'broken');m.load();assert.throws(()=>m.add('私はリンゴが好き'));assert.equal(fs.readFileSync(m.file,'utf8'),'broken');m.clear();m.add('私はリンゴが好き');assert.equal(m.items.length,1);}finally{finish();}
});
