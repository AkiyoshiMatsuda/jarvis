const {test}=require('node:test');
const assert=require('node:assert/strict');
const {askLocal,hasUnexpectedChinese,AnswerCycle}=require('../desktop/answer.cjs');
const {Conversation}=require('../desktop/conversation.cjs');
test('mixed Chinese tail is repaired once without replaying contaminated history',async()=>{
  const chats=[];
  const result=await askLocal('好きな果物は何？',{history:[{role:'user',content:'マンゴーです。'},{role:'assistant',content:'何か关于芒果的建议吗'}],request:async(route,body)=>{
    if(route==='/api/show')return {details:{format:'gguf'}};
    chats.push(body);return {done:true,message:{content:chats.length===1?'マンゴーです。何か关于芒果的建议吗':'マンゴーです。'}};
  }});
  assert.equal(result.text,'マンゴーです。');assert.equal(chats.length,2);
  assert.equal(chats[1].messages.length,2);assert.equal(chats[1].messages.some(m=>m.role==='assistant'),false);
});
test('failed repair is bounded and never reaches history or speech callback',async()=>{
  let chats=0,failed='';const conversation=new Conversation();
  const cycle=new AnswerCycle({conversation,started:()=>{},complete:()=>assert.fail(),failed:e=>failed=e,
    ask:(q,o)=>askLocal(q,{...o,request:async route=>{
      if(route==='/api/show')return {details:{format:'gguf'}};
      chats++;return {done:true,message:{content:'何か关于芒果的建议吗'}};
    }})});
  assert.equal(await cycle.begin('こんにちは'),false);assert.equal(chats,2);
  assert.match(failed,/日本語/);assert.equal(conversation.messages.length,0);
});
test('Japanese shared kanji, requested foreign translation, quotation and code are permitted',()=>{
  for(const [text,question] of [['需要と供給について説明します。','経済を教えて'],['你好，还有什么问题吗？','中国語に翻訳してください'],
    ['「关于」は「〜について」という意味です。','「关于」とは？'],['`关于` を変数名に使います。','コードについて']])
    assert.equal(hasUnexpectedChinese(text,question),false);
  assert.equal(hasUnexpectedChinese('何か关于芒果的建议吗','ありがとう'),true);
});
test('cancellation during repair prevents late completion and history commit',async()=>{
  let release,chats=0;const conversation=new Conversation();
  const cycle=new AnswerCycle({conversation,started:()=>{},failed:()=>assert.fail(),complete:()=>assert.fail(),ask:(q,o)=>askLocal(q,{...o,request:async route=>{
    if(route==='/api/show')return {details:{format:'gguf'}};
    chats++;if(chats===1)return {done:true,message:{content:'何か关于芒果的建议吗'}};
    return new Promise(r=>release=r);
  }})});
  const pending=cycle.begin('こんにちは');while(!release)await new Promise(r=>setImmediate(r));
  cycle.cancel();await pending;release({done:true,message:{content:'こんにちは。'}});
  await new Promise(r=>setImmediate(r));assert.equal(conversation.messages.length,0);
});
