const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TimerService,parseTimerCommand,durationLabel,MAX_MS}=require('../desktop/timer.cjs');
test('timer commands parse minutes, compound durations, Japanese numerals and full-width input',()=>{
  for(const [input,ms] of [['3分測って',180000],['１ 分 ３０ 秒のタイマーをかけて。',90000],['タイマーを1分半セットして',90000],
    ['三十分計ってください',1800000],['三 分 図っ て',180000],['1時間2分3秒測って',3723000],['0.5分測って',30000],['24時間測って',MAX_MS],['30秒間測って',30000]])
    assert.deepEqual(parseTimerCommand(input),{type:'start',durationMs:ms},input);
});
test('recognized duration with a particle starts only when the number is present',()=>{
  assert.deepEqual(parseTimerCommand('三十 秒 を 測っ て'),{type:'start',durationMs:30000});
  assert.deepEqual(parseTimerCommand('1分30秒を計って'),{type:'start',durationMs:90000});
  for(const text of ['分を測って','時間計って','一風図って','を測って'])
    assert.notEqual(parseTimerCommand(text)?.type,'start',text);
});
test('ambiguous, invalid and quoted requests never start a timer',()=>{
  for(const text of ['0分測って','25時間測って','-1分測って','1分2分測って','1.2.3分測って','0.1秒測って','3タイマー'])
    assert.notEqual(parseTimerCommand(text)?.type,'start',text);
  assert.equal(parseTimerCommand('「3分測って」と言えばいいですか'),null);
  assert.equal(parseTimerCommand('夕食を考えて'),null);
  assert.deepEqual(parseTimerCommand('タイマーを止めてください'),{type:'cancel'});
  assert.deepEqual(parseTimerCommand('タイマーの残り時間を教えて'),{type:'remaining'});
});
test('deadline survives delayed ticks, expires once and stays visible until dismissed',()=>{
  let now=1000,expired=0;const timer=new TimerService({now:()=>now,onExpire:()=>expired++});
  assert.equal(timer.start(60000).ok,true);now+=1000;assert.equal(timer.snapshot().remainingMs,59000);
  now+=3600000;timer.tick();timer.tick();assert.equal(expired,1);
  assert.equal(timer.snapshot().status,'finished');assert.equal(timer.snapshot().remainingMs,0);
  timer.cancel();assert.equal(timer.snapshot(),null);assert.equal(expired,1);
});
test('running timer cannot be overwritten; cancellation prevents late notification; restart uses new id',()=>{
  let now=0,expired=0;const timer=new TimerService({now:()=>now,onExpire:()=>expired++});
  timer.start(2000);const first=timer.snapshot();assert.equal(timer.start(3000).ok,false);assert.equal(timer.snapshot().deadline,first.deadline);
  timer.cancel();now=5000;timer.tick();assert.equal(expired,0);timer.start(1000);assert.notEqual(timer.snapshot().id,first.id);
  for(const n of [0,999,NaN,Infinity,MAX_MS+1,1.5])assert.equal(timer.start(n).ok,false);
});
test('remaining time labels round up so a running timer does not show zero early',()=>{
  assert.equal(durationLabel(1),'1秒');assert.equal(durationLabel(3600000),'1時間');assert.equal(durationLabel(61000),'1分1秒');
});
