const https=require('node:https');
const {LocalAIError}=require('./answer.cjs');
class WeatherError extends LocalAIError {}
function weatherJSON(url,{signal,timeoutMs=12000}={}) {
  const target=new URL(url);
  if(target.protocol!=='https:'||!['api.open-meteo.com','geocoding-api.open-meteo.com'].includes(target.hostname))throw new WeatherError('天気の接続先が不正です。');
  return new Promise((resolve,reject)=>{
    const req=https.get(target,{signal},res=>{
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576){req.destroy(new WeatherError('天気の応答が大きすぎます。'));return;}chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>{
        if(res.statusCode!==200)return reject(new WeatherError(res.statusCode===429?'天気サービスが混み合っています。少し待って再試行してください。':'天気サービスから取得できませんでした。'));
        try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(data.error)throw Error();resolve(data);}catch{reject(new WeatherError('天気データを読み取れませんでした。'));}
      });
    });
    const timer=setTimeout(()=>req.destroy(new WeatherError('天気の取得がタイムアウトしました。')),timeoutMs);
    req.on('close',()=>clearTimeout(timer));req.on('error',e=>reject(e instanceof WeatherError||signal?.aborted?e:new WeatherError('天気サービスに接続できません。インターネット接続を確認してください。')));
  });
}
function validateLocation(value) {
  if(value===null||value===undefined)return null;
  if(!Number.isInteger(value.id)||value.id<=0||typeof value.name!=='string'||!value.name.trim()||value.name.length>100||typeof value.admin!=='string'||value.admin.length>100||
    value.country!=='JP'||!Number.isFinite(value.latitude)||value.latitude<20||value.latitude>46||!Number.isFinite(value.longitude)||value.longitude<122||value.longitude>154)
    throw new WeatherError('天気の地域設定が正しくありません。検索し直してください。');
  return {id:value.id,name:value.name,admin:value.admin,country:'JP',latitude:value.latitude,longitude:value.longitude};
}
const plain=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'').slice(0,100):'';
async function searchLocations(name,{request=weatherJSON,signal}={}) {
  if(typeof name!=='string'||name.trim().length<2||name.trim().length>80)throw new WeatherError('地域名は2〜80文字で入力してください。');
  const query=new URLSearchParams({name:name.trim(),count:'10',language:'ja',countryCode:'JP',format:'json'});
  const data=await request('https://geocoding-api.open-meteo.com/v1/search?'+query,{signal});signal?.throwIfAborted();
  if(data.results!==undefined&&!Array.isArray(data.results))throw new WeatherError('地域の検索結果を読み取れませんでした。');
  const result=[];
  for(const row of (data.results??[]).slice(0,10)) {
    if(row.country_code!=='JP')continue;
    try{result.push(validateLocation({id:row.id,name:plain(row.name),admin:plain(row.admin1),country:'JP',latitude:row.latitude,longitude:row.longitude}));}catch{}
  }
  return result;
}
function parseWeatherCommand(input) {
  const text=input.normalize('NFKC').replace(/[\s、。！？!?]/g,'');
  const match=text.match(/^(今日|きょう|明日|あした|あす|明後日|あさって|今|現在|今週|週間|一週間|1週間|今後7日間)?(?:の|は)?(天気予報|天気|気温|降水確率|雨|傘)(.*)$/);
  if(!match)return null;
  const [,period='',subject,ending]=match;
  if(!/^(?:は)?(?:どう|どうですか|何|何度|何度ですか|何パーセント|教えて|を教えて|を見せて|を確認して|が降る|降る|が降りますか|ですか|かな|必要|必要ですか|いる|要る|持っていくべき)?(?:ください|下さい|くれる)?$/.test(ending))return null;
  let kind=/今週|週間|今後/.test(period)?'week':/^(今|現在)$/.test(period)?'current':'day';
  const offset=/明後日|あさって/.test(period)?2:/明日|あした|あす/.test(period)?1:0;
  if(subject==='傘'||subject==='雨'||subject==='降水確率')kind=kind==='current'?'day':kind;
  return {kind,offset,umbrella:subject==='傘'||subject==='雨'};
}
const codes={0:'快晴',1:'おおむね晴れ',2:'晴れ時々曇り',3:'曇り',45:'霧',48:'着氷性の霧',51:'弱い霧雨',53:'霧雨',55:'強い霧雨',56:'弱い着氷性の霧雨',57:'強い着氷性の霧雨',61:'弱い雨',63:'雨',65:'強い雨',66:'弱い着氷性の雨',67:'強い着氷性の雨',71:'弱い雪',73:'雪',75:'強い雪',77:'雪粒',80:'弱いにわか雨',81:'にわか雨',82:'強いにわか雨',85:'弱いにわか雪',86:'強いにわか雪',95:'雷雨',96:'ひょうを伴う雷雨',99:'強いひょうを伴う雷雨'};
const codeName=n=>codes[n]??'天気の詳細は不明';
const dateKey=now=>new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
const value=(n,unit)=>Number.isFinite(n)?`${Math.round(n*10)/10}${unit}`:'不明';
function formatWeather(data,command,location,now,fetchedAt) {
  const label=[location.admin,location.name].filter(Boolean).join(' ');
  const source=`提供：Open-Meteo。取得：${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(fetchedAt))}（日本時間）。`;
  if(command.kind==='current') {
    const c=data.current;if(!c||typeof c.time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(c.time))throw new WeatherError('現在の天気を取得できませんでした。');
    return {text:`${label}の現在の天気（予測値、${c.time.replace('T',' ')}）。${codeName(c.weather_code)}。気温${value(c.temperature_2m,'度')}、体感${value(c.apparent_temperature,'度')}、風速${value(c.wind_speed_10m,'メートル毎秒')}。\n${source}`};
  }
  const daily=data.daily;
  if(!daily||!Array.isArray(daily.time))throw new WeatherError('日別の天気を取得できませんでした。');
  const dates=Array.from({length:command.kind==='week'?7:1},(_,i)=>dateKey(new Date(now.getTime()+(command.kind==='week'?i:command.offset)*86400000)));
  const lines=dates.map(date=>{
    const i=daily.time.indexOf(date);if(i<0)throw new WeatherError('指定日の天気データがありません。少し待って再試行してください。');
    const code=daily.weather_code?.[i],prob=daily.precipitation_probability_max?.[i];
    const probability=Number.isFinite(prob)&&prob>=0&&prob<=100?prob:null;
    let advice='';
    if(command.umbrella)advice=(Object.hasOwn(codes,code)&&code>=51)||probability>=50?' 傘や雨具を用意する目安です。':probability===null?' 降水確率が不明のため、傘の必要性を判断できません。':probability>=30?' 折りたたみ傘があると安心です。':' 降水の可能性は低めです。';
    return `${date}：${codeName(code)}。最高${value(daily.temperature_2m_max?.[i],'度')}、最低${value(daily.temperature_2m_min?.[i],'度')}、1日の最大降水確率${value(probability,'パーセント')}。${advice}`;
  });
  return {text:`${label}の${command.kind==='week'?'今日から7日間':['今日','明日','明後日'][command.offset]}の予報です。\n${lines.join('\n')}\n${source}`};
}
class WeatherService {
  constructor({request=weatherJSON,now=()=>new Date()}={}){this.request=request;this.now=now;this.cache=null;}
  clear(){this.cache=null;}
  async ask(command,location,{signal}={}) {
    location=validateLocation(location);if(!location)throw new WeatherError('天気の地域が未設定です。画面の「天気予報」で地域を選んでください。');
    if(!command||!['day','week','current'].includes(command.kind)||![0,1,2].includes(command.offset))throw new WeatherError('今日・明日・明後日・週間の天気を指定してください。');
    const now=this.now(),key=JSON.stringify([location.latitude,location.longitude,dateKey(now)]);
    if(this.cache?.key===key&&now.getTime()>=this.cache.time&&now.getTime()-this.cache.time<600000)return formatWeather(this.cache.data,command,location,now,this.cache.time);
    const query=new URLSearchParams({latitude:String(location.latitude),longitude:String(location.longitude),timezone:'Asia/Tokyo',forecast_days:'7',temperature_unit:'celsius',wind_speed_unit:'ms',
      daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',current:'weather_code,temperature_2m,apparent_temperature,wind_speed_10m'});
    const data=await this.request('https://api.open-meteo.com/v1/forecast?'+query,{signal});signal?.throwIfAborted();
    const result=formatWeather(data,command,location,now,now.getTime());this.cache={key,time:now.getTime(),data};return result;
  }
}
module.exports={WeatherError,weatherJSON,validateLocation,searchLocations,parseWeatherCommand,formatWeather,WeatherService};
