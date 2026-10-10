const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {askLocal}=require('../desktop/answer.cjs');
(async()=>{
  const start=performance.now();
  const result=await askLocal('日本語で一文だけ答えてください。2足す3はいくつですか？');
  assert.match(result.text,/5|５|五/);
  assert.match(result.text,/[ぁ-んァ-ン一-龯]/);
  assert.ok(result.text.length<200,'Expected a short answer');
  assert.equal(result.truncated,false);
  const dir=path.join(__dirname,'../validation/step-a3');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'local-answer.json'),JSON.stringify({synthetic_question:true,...result,elapsed_ms:performance.now()-start},null,2));
  console.log('PASS real local AI answer');
})().catch(e=>{console.error(e);process.exitCode=1;});
