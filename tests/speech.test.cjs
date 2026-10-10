const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate,defaults}=require('../desktop/core.cjs');
async function fixture(voices=[]) {
  const {connectSpeech}=await import('../ui/speech.mjs');
  let listener,changed;
  const spoken=[],events=[];
  const synth={getVoices:()=>voices,speak:u=>spoken.push(u),cancel:()=>{},
    addEventListener:(_n,f)=>changed=f,removeEventListener:(_n,f)=>{if(changed===f)changed=null;}};
  const cleanup=connectSpeech({onSpeech:f=>{listener=f;return ()=>{};},speechEvent:(id,kind)=>events.push([id,kind])},synth,class {constructor(text){this.text=text;}},15);
  return {send:m=>listener(m),spoken,events,cleanup,setVoices:v=>{voices=v;changed?.();}};
}
test('speech selects local Japanese voice, reports actual playback lifecycle',async()=>{
  const f=await fixture([{lang:'ja-JP',localService:false},{lang:'en-US',localService:true},{lang:'ja-JP',localService:true}]);
  try {
    f.send({type:'play',id:'1',text:'こんにちは',volume:.5});
    assert.equal(f.spoken.length,1);const u=f.spoken[0];
    assert.equal(u.voice.localService,true);assert.equal(u.voice.lang,'ja-JP');assert.equal(u.volume,.5);
    assert.equal(f.events.length,0);u.onstart();u.onend();await Promise.resolve();
    assert.deepEqual(f.events,[['1','started'],['1','ended']]);
  } finally {f.cleanup();}
});
test('spoken dates, times and markdown are normalized without changing fractions or multiplication',async()=>{
  const {speechText,speechChunks}=await import('../ui/speech-text.mjs');
  const text=speechText('## 予定\n**会議**\n2026-10-15\n10/15(木) 10:00〜11:30\n[詳細](https://example.com)');
  assert.match(text,/2026年10月15日/);assert.match(text,/10月15日、木曜日 10時から11時30分/);assert.doesNotMatch(text,/[#*]|https/);
  assert.match(speechText('1/2は0.5、2*3は6です。'),/1\/2は0\.5、2\*3は6/);
  const chunks=speechChunks('あ'.repeat(1000)+'。次の文。');assert.ok(chunks.every(s=>s.length<=240));assert.equal(chunks.join(''),'あ'.repeat(1000)+'。次の文。');
});
test('voice preference and rate apply to every sentence with one lifecycle; stop prevents later chunks',async()=>{
  const f=await fixture([{lang:'ja-JP',localService:true,voiceURI:'one'},{lang:'ja-JP',localService:true,voiceURI:'two'}]);
  try {
    f.send({type:'play',id:'chunks',text:'一文目です。二文目です。三文目です。',volume:.5,voiceURI:'two',rate:.9});
    assert.equal(f.spoken[0].voice.voiceURI,'two');assert.equal(f.spoken[0].rate,.9);
    f.spoken[0].onstart();f.spoken[0].onend();await Promise.resolve();assert.equal(f.spoken.length,2);
    f.spoken[1].onstart();const stale=f.spoken[1].onend;f.send({type:'stop'});stale();await Promise.resolve();
    assert.equal(f.spoken.length,2);assert.deepEqual(f.events,[['chunks','started']]);
    f.send({type:'play',id:'done',text:'一文。二文。',volume:1});
    f.spoken[2].onstart();f.spoken[2].onend();await Promise.resolve();f.spoken[3].onstart();f.spoken[3].onend();await Promise.resolve();
    assert.deepEqual(f.events.slice(1),[['done','started'],['done','ended']]);
  } finally {f.cleanup();}
});
test('a missing selected voice does not silently use another voice or a remote service',async()=>{
  const f=await fixture([{lang:'ja-JP',localService:false,voiceURI:'remote'},{lang:'ja-JP',localService:true,voiceURI:'local'}]);
  try{f.send({type:'play',id:'1',text:'確認',volume:1,voiceURI:'remote'});await new Promise(r=>setTimeout(r,25));assert.equal(f.spoken.length,0);assert.deepEqual(f.events,[['1','error']]);}finally{f.cleanup();}
});
test('speech preferences migrate, persist and reject invalid values',()=>{
  assert.equal(validate(defaults()).speech_rate,1);assert.equal(validate(defaults()).speech_voice,'');
  assert.equal(validate({...defaults(),speech_voice:'local',speech_rate:.9}).speech_voice,'local');
  for(const change of [{speech_rate:NaN},{speech_rate:5},{speech_voice:12},{speech_voice:'a'.repeat(513)}])assert.throws(()=>validate({...defaults(),...change}));
});
test('remote-only or missing Japanese voices fail without sending text to synthesis',async()=>{
  const f=await fixture([{lang:'ja-JP',localService:false}]);
  try {f.send({type:'play',id:'1',text:'private',volume:1});await new Promise(r=>setTimeout(r,25));
    assert.equal(f.spoken.length,0);assert.deepEqual(f.events,[['1','error']]);
  } finally {f.cleanup();}
});
test('late voice discovery starts once and stop invalidates stale callbacks',async()=>{
  const f=await fixture();
  try {
    f.send({type:'play',id:'1',text:'こんにちは',volume:1});
    f.setVoices([{lang:'ja-JP',localService:true}]);assert.equal(f.spoken.length,1);
    const stale=f.spoken[0].onend;
    f.send({type:'stop'});stale();assert.deepEqual(f.events,[]);
    f.send({type:'play',id:'2',text:'次',volume:1});stale();
    f.spoken[1].onstart();assert.deepEqual(f.events,[['2','started']]);
  } finally {f.cleanup();}
});
test('stop before voice discovery prevents deferred speech',async()=>{
  const f=await fixture();
  try {f.send({type:'play',id:'1',text:'こんにちは',volume:1});f.send({type:'stop'});
    f.setVoices([{lang:'ja-JP',localService:true}]);await new Promise(r=>setTimeout(r,25));
    assert.equal(f.spoken.length,0);assert.deepEqual(f.events,[]);
  } finally {f.cleanup();}
});
test('old settings enable speech; explicit off persists and invalid input rejected',()=>{
  const old=defaults();delete old.speech_enabled;
  assert.equal(validate(old).speech_enabled,true);
  assert.equal(validate({...old,speech_enabled:false}).speech_enabled,false);
  assert.throws(()=>validate({...old,speech_enabled:'true'}));
});
