const https=require('node:https');
const {LocalAIError}=require('./answer.cjs');
const SCOPE='https://www.googleapis.com/auth/calendar.events.readonly';
class CalendarError extends LocalAIError {}
function googleJSON(url,{form,token,signal,timeoutMs=15000}={}) {
  const target=new URL(url);
  if(target.protocol!=='https:' || !['oauth2.googleapis.com','www.googleapis.com'].includes(target.hostname))throw new CalendarError('Googleの接続先が不正です。');
  return new Promise((resolve,reject)=>{
    const body=form?new URLSearchParams(form).toString():null;
    const req=https.request(target,{method:body?'POST':'GET',signal,headers:{
      ...(body?{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}:{}),
      ...(token?{Authorization:`Bearer ${token}`}:{})}},res=>{
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){req.destroy(new CalendarError('Googleの応答が大きすぎます。'));return;}chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>{
        let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{return reject(new CalendarError('Googleの応答を読み取れませんでした。'));}
        if(res.statusCode<200||res.statusCode>=300) {
          const message=data.error==='invalid_grant'||res.statusCode===401?'Googleの認証が期限切れです。接続し直してください。':
            res.statusCode===403?'カレンダーを取得できません。Calendar APIの有効化と読み取り権限を確認してください。':
            res.statusCode===429?'Googleへのアクセスが混み合っています。少し待って再試行してください。':'Googleとの通信に失敗しました。接続設定を確認してください。';
          return reject(Object.assign(new CalendarError(message),{status:res.statusCode}));
        }
        resolve(data);
      });
    });
    const timer=setTimeout(()=>req.destroy(new CalendarError('Googleへの接続がタイムアウトしました。')),timeoutMs);
    req.on('close',()=>clearTimeout(timer));req.on('error',e=>reject(e instanceof CalendarError||signal?.aborted?e:new CalendarError('Googleに接続できません。インターネット接続を確認してください。')));
    req.end(body);
  });
}
const {parseCalendarCommand}=require('./calendar-period.cjs');
function calendarRange(kind,now) {
  try{return require('./calendar-period.cjs').calendarRange(kind,now);}catch(e){throw new CalendarError(e.message);}
}
const clean=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').trim().slice(0,120):'';
function eventTime(value) {
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new CalendarError('予定の日時を読み取れませんでした。');
  return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
}
const included=e=>e.status!=='cancelled'&&!e.attendees?.some(a=>a.self&&a.responseStatus==='declined');
const startsAt=e=>Date.parse(e.start?.dateTime??(e.start?.date+'T00:00:00+09:00'));
function formatCalendar(range,events) {
  let items=events.filter(included);
  if(range.next) {
    items=items.filter(e=>startsAt(e)>=Date.parse(range.timeMin)).sort((a,b)=>startsAt(a)-startsAt(b));
    if(items.length)items=items.filter(e=>startsAt(e)===startsAt(items[0]));
  }
  if(!items.length)return {text:range.next?'今後365日以内に開始する予定はメインカレンダーに見つかりませんでした。（日本時間・進行中の予定は対象外）':`${range.label}のメインカレンダーに予定はありません。（日本時間）`};
  const lines=items.slice(0,50).map(e=>{
    let time;
    if(e.start?.date) {
      const start=e.start.date,end=e.end?.date;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end??''))throw new CalendarError('終日予定の日時を読み取れませんでした。');
      const last=new Date(new Date(end+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
      time=`${start}${last!==start?'〜'+last:''} 終日`;
    } else time=`${eventTime(e.start?.dateTime)}〜${eventTime(e.end?.dateTime)}`;
    return `${time}：${clean(e.summary)||'（件名なし）'}`;
  });
  const dateOnly=s=>new Date(Date.parse(s)+9*3600000).toISOString().slice(0,10);
  const heading=range.next?`次に開始する予定は${items.length}件です。（メインカレンダー・日本時間）`:
    `${range.label}のメインカレンダーは${items.length}件です。（日本時間${range.week?'・月曜から日曜':''}）\n対象期間：${dateOnly(range.timeMin)}〜${dateOnly(new Date(Date.parse(range.timeMax)-1).toISOString())}`;
  return {text:heading+'\n'+lines.join('\n')+(items.length>50?'\n表示・読み上げは先頭50件です。残りはGoogleカレンダーで確認してください。':'' )};
}
async function fetchCalendar(kind,{accessToken,signal,request=googleJSON,now=new Date(),raw=false}={}) {
  const range=raw?{timeMin:now.toISOString(),timeMax:new Date(now.getTime()+86400000).toISOString()}:calendarRange(kind,now),events=[];let pageToken;
  for(let page=0;page<20;page++) {
    signal?.throwIfAborted();
    const query=new URLSearchParams({timeMin:range.timeMin,timeMax:range.timeMax,singleEvents:'true',orderBy:'startTime',showDeleted:'false',maxResults:'250',timeZone:'Asia/Tokyo',
      fields:'items(id,summary,start,end,status,attendees(self,responseStatus)),nextPageToken',...(pageToken?{pageToken}:{})});
    const data=await request('https://www.googleapis.com/calendar/v3/calendars/primary/events?'+query,{token:accessToken,signal});
    if(!Array.isArray(data.items)&&data.items!==undefined)throw new CalendarError('予定一覧を読み取れませんでした。');
    events.push(...(data.items??[]));pageToken=data.nextPageToken;
    if(range.next) {
      const future=events.filter(e=>included(e)&&startsAt(e)>=Date.parse(range.timeMin));
      // Google returns start-time order. Read across page boundaries to keep simultaneous events.
      if(future.length && events.some(e=>startsAt(e)>startsAt(future[0])))return formatCalendar(range,events);
    }
    if(!pageToken)return raw?events:formatCalendar(range,events);
  }
  throw new CalendarError('予定が多すぎるため全件を確認できませんでした。今日または明日の予定を指定してください。');
}
module.exports={SCOPE,CalendarError,googleJSON,parseCalendarCommand,calendarRange,formatCalendar,fetchCalendar};

