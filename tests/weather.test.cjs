const {test}=require('node:test');
const assert=require('node:assert/strict');
const {WeatherService,WeatherError,parseWeatherCommand,searchLocations,validateLocation,formatWeather,weatherJSON}=require('../desktop/weather.cjs');
const {defaults,validate}=require('../desktop/core.cjs');
const location={id:1,name:'検証市',admin:'検証県',country:'JP',latitude:35,longitude:139};
const now=new Date('2026-12-31T03:00:00Z');
function forecast(){return {current:{time:'2026-12-31T12:00',weather_code:0,temperature_2m:10,apparent_temperature:9,wind_speed_10m:2},daily:{time:Array.from({length:7},(_,i)=>new Date(now.getTime()+i*86400000).toISOString().slice(0,10)),weather_code:[0,61,3,71,95,45,2],temperature_2m_max:[12,13,14,15,16,17,18],temperature_2m_min:[1,2,3,4,5,6,7],precipitation_probability_max:[10,80,null,30,90,0,20]}};}
test('weather intents accept speech spaces, rain and umbrella; reject general questions and edits',()=>{
  for(const [text,kind,offset] of [['今日の天気','day',0],['明日 の 天気 を 教え て','day',1],['明後日の気温','day',2],['明日は雨？','day',1],['傘は必要？','day',0],['週間天気','week',0],['今週の天気','week',0],['今の天気','current',0],['明日の降水確率は何パーセント','day',1]]){
    const cmd=parseWeatherCommand(text);assert.equal(cmd?.kind,kind,text);assert.equal(cmd.offset,offset,text);
  }
  for(const text of ['天気とは何ですか','天気の仕組みを教えて','明日の予定','傘を買って','雨についての詩を書いて'])assert.equal(parseWeatherCommand(text),null,text);
});
test('only valid saved Japanese locations survive migration and search selection',async()=>{
  assert.equal(validate(defaults()).weather_location,null);assert.deepEqual(validate({...defaults(),weather_location:location}).weather_location,location);
  assert.throws(()=>validateLocation({...location,latitude:Infinity}),WeatherError);assert.throws(()=>validateLocation({...location,country:'US'}),WeatherError);
  let requested;
  const rows=await searchLocations('東京',{request:async url=>{requested=new URL(url);return {results:[{id:1,name:'東京',admin1:'東京都',country_code:'JP',latitude:35.6,longitude:139.7},{id:2,name:'foreign',country_code:'US',latitude:35,longitude:139}]};}});
  assert.equal(rows.length,1);assert.equal(requested.searchParams.get('countryCode'),'JP');assert.equal(requested.searchParams.get('language'),'ja');
  await assert.rejects(searchLocations('東'),/2〜80/);
  assert.deepEqual(await searchLocations('none',{request:async()=>({})}),[]);
});
test('forecast formatting preserves missing probability and gives bounded umbrella advice',()=>{
  const data=forecast();
  const tomorrow=formatWeather(data,parseWeatherCommand('明日は雨'),location,now,now.getTime());assert.match(tomorrow.text,/2027-01-01/);assert.match(tomorrow.text,/80パーセント/);assert.match(tomorrow.text,/傘や雨具/);assert.match(tomorrow.text,/Open-Meteo/);
  const missing=formatWeather(data,parseWeatherCommand('明後日の傘は必要'),location,now,now.getTime());assert.match(missing.text,/不明/);assert.doesNotMatch(missing.text,/低め|0パーセント/);
  assert.match(formatWeather(data,parseWeatherCommand('週間天気'),location,now,now.getTime()).text,/2027-01-06/);
  assert.match(formatWeather(data,parseWeatherCommand('今の天気'),location,now,now.getTime()).text,/予測値/);
  assert.throws(()=>formatWeather({},parseWeatherCommand('今日の天気'),location,now,now.getTime()),WeatherError);
});
test('forecast cache expires in ten minutes, at midnight and on region change without stale fallback',async()=>{
  let time=new Date(now),calls=0,fail=false;
  const service=new WeatherService({now:()=>time,request:async url=>{calls++;const u=new URL(url);assert.equal(u.searchParams.get('timezone'),'Asia/Tokyo');assert.equal(u.searchParams.get('wind_speed_unit'),'ms');if(fail)throw new WeatherError('offline');return forecast();}});
  await assert.rejects(service.ask(parseWeatherCommand('今日の天気'),null),/地域が未設定/);
  await service.ask(parseWeatherCommand('今日の天気'),location);await service.ask(parseWeatherCommand('明日の天気'),location);assert.equal(calls,1);
  time=new Date(now.getTime()+600000);await service.ask(parseWeatherCommand('今日の天気'),location);assert.equal(calls,2);
  await service.ask(parseWeatherCommand('今日の天気'),{...location,latitude:36});assert.equal(calls,3);
  time=new Date('2026-12-31T15:00:00Z');await service.ask(parseWeatherCommand('今日の天気'),location);assert.equal(calls,4);
  service.clear();fail=true;await assert.rejects(service.ask(parseWeatherCommand('今日の天気'),location),/offline/);
});
test('cancelled weather cannot populate cache; network destinations are fixed',async()=>{
  const controller=new AbortController();const service=new WeatherService({now:()=>now,request:async()=>{controller.abort();return forecast();}});
  await assert.rejects(service.ask(parseWeatherCommand('今日の天気'),location,{signal:controller.signal}),{name:'AbortError'});assert.equal(service.cache,null);
  assert.throws(()=>weatherJSON('https://example.com/'),WeatherError);assert.throws(()=>weatherJSON('http://api.open-meteo.com/'),WeatherError);
});
