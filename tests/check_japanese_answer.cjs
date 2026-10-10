// Synthetic prompts only. Model quality check, not a universal language detector.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {askLocal}=require('../desktop/answer.cjs');
const {Conversation}=require('../desktop/conversation.cjs');
(async()=>{
  const cases=[];
  const conversation=new Conversation();
  async function check(question,history,expected) {
    const result=await askLocal(question,{history,signal:AbortSignal.timeout(100000)});
    assert.equal(result.truncated,false);
    assert.doesNotMatch(result.text,/关于|芒果|建议|什么|吗|还有|需要|你/,'Chinese wording in Japanese response');
    assert.match(result.text,expected);
    cases.push({question,answer:result.text});return result;
  }
  for(const question of ['こんにちは','私の好きな果物はマンゴーです。覚えてください。','私の好きな果物は何ですか？']) {
    const result=await check(question,conversation.context(),question==='こんにちは'?/こんにちは/:/マンゴー/);
    conversation.commit(question,result,conversation.version);
  }
  const contaminated=[{role:'user',content:'私の好きな果物はマンゴーです。'},
    {role:'assistant',content:'マンゴーですね。何か关于芒果的建议吗'}];
  await check('ありがとう',contaminated,/どういたしまして|こちらこそ|ありがとう/);
  await check('私の好きな果物は何ですか？',contaminated,/マンゴー/);
  const dir=path.join(__dirname,'../validation/japanese-answer-fix');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'local-model.json'),JSON.stringify({synthetic:true,cases},null,2));
  console.log('PASS 5 real-model Japanese replies, including mixed-language history');
})().catch(e=>{console.error(e);process.exitCode=1;});
