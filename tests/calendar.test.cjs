const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createHash}=require('node:crypto');
const {parseCalendarCommand,calendarRange,formatCalendar,fetchCalendar,CalendarError,SCOPE}=require('../desktop/calendar.cjs');
const {parseClient,authorize,GoogleCalendar}=require('../desktop/google-calendar.cjs');
const {AnswerCycle}=require('../desktop/answer.cjs');
const client={client_id:'test.apps.googleusercontent.com',client_secret:'test-secret'};
test('extended calendar language covers common periods and rejects edits',()=>{
  for(const [q,kind] of [['来週の予定を教えて','nextWeek'],['来月のスケジュールは何','nextMonth'],['今月の予定を確認したい','month'],['次の予定はいつ？','next'],['明後日の予定ある？','dayAfterTomorrow'],['再来週の予定','weekAfterNext'],['今週末の予定','weekend'],['来週の週末の予定','nextWeekend'],['先月の予定','lastMonth']])assert.equal(parseCalendarCommand(q),kind,q);
  assert.deepEqual(parseCalendarCommand('来週の月曜日の予定'),{kind:'weekday',week:'来週',weekday:1});
  assert.deepEqual(parseCalendarCommand('十月十五日の予定を教えて'),{kind:'date',year:null,month:10,day:15});
  assert.deepEqual(parseCalendarCommand('２０２７年１月１日の予定'),{kind:'date',year:2027,month:1,day:1});
  assert.deepEqual(parseCalendarCommand('三日後の予定'),{kind:'offset',days:3});
  assert.deepEqual(parseCalendarCommand('今後7日間の予定'),{kind:'days',days:7});
  assert.equal(parseCalendarCommand('来月の予定を消して'),null);
});
test('month/week rollover, leap year, weekends and explicit dates have exact exclusive bounds',()=>{
  const now=new Date('2026-12-31T03:00:00Z');
  const check=(q,min,max)=>{const r=calendarRange(parseCalendarCommand(q),now);assert.equal(r.timeMin,min,q);assert.equal(r.timeMax,max,q);};
  check('来週の予定','2027-01-03T15:00:00.000Z','2027-01-10T15:00:00.000Z');
  check('今月の予定','2026-11-30T15:00:00.000Z','2026-12-31T15:00:00.000Z');
  check('来月の予定','2026-12-31T15:00:00.000Z','2027-01-31T15:00:00.000Z');
  check('今週末の予定','2027-01-01T15:00:00.000Z','2027-01-03T15:00:00.000Z');
  check('来週の月曜日の予定','2027-01-03T15:00:00.000Z','2027-01-04T15:00:00.000Z');
  check('2027年1月1日の予定','2026-12-31T15:00:00.000Z','2027-01-01T15:00:00.000Z');
  assert.equal(calendarRange('month',new Date('2028-02-29T00:00Z')).timeMax,'2028-02-29T15:00:00.000Z');
  for(const q of ['2027年2月29日の予定','2月30日の予定','13月1日の予定','今後0日間の予定','366日後の予定'])assert.throws(()=>calendarRange(parseCalendarCommand(q),now),CalendarError,q);
});
test('next event skips ongoing and declined events, keeps ties across pages, stops before later dates',async()=>{
  const now=new Date('2026-10-10T01:00Z');let calls=0;
  const event=(summary,dateTime,extra={})=>({summary,start:{dateTime},end:{dateTime:'2026-10-11T15:00Z'},...extra});
  const result=await fetchCalendar('next',{now,request:async url=>{
    assert.equal(new URL(url).searchParams.get('timeMin'),now.toISOString());calls++;
    return calls===1?{items:[event('進行中','2026-10-10T00:00Z'),event('辞退','2026-10-10T02:00Z',{attendees:[{self:true,responseStatus:'declined'}]}),event('次の会議','2026-10-10T03:00Z')],nextPageToken:'next'}:
      {items:[event('同時刻','2026-10-10T03:00Z'),event('後の予定','2026-10-10T04:00Z')],nextPageToken:'unneeded'};
  }});
  assert.equal(calls,2);assert.match(result.text,/2件/);assert.match(result.text,/次の会議/);assert.match(result.text,/同時刻/);assert.doesNotMatch(result.text,/進行中|辞退|後の予定/);
  const empty=await fetchCalendar('next',{now,request:async()=>({items:[]})});assert.match(empty.text,/365日以内/);
  const allDay=formatCalendar(calendarRange('next',now),[{summary:'今日終日',start:{date:'2026-10-10'},end:{date:'2026-10-11'}},{summary:'明日終日',start:{date:'2026-10-11'},end:{date:'2026-10-12'}}]);
  assert.match(allDay.text,/明日終日/);assert.doesNotMatch(allDay.text,/今日終日/);
});
test('calendar commands handle Vosk spaces but do not intercept unrelated questions or edits',()=>{
  for(const [q,kind] of [['今日の予定','today'],['今日 の 予定 を 教え て','today'],['明日の予定を教えてください。','tomorrow'],['あしたのスケジュールは？','tomorrow'],['今週の予定を読み上げて','week'],['Googleカレンダーで今週の予定','week']])assert.equal(parseCalendarCommand(q),kind,q);
  for(const q of ['今日の予定を追加して','今日の予定という言葉を英訳して','明日の天気','30秒測って'])assert.equal(parseCalendarCommand(q),null,q);
});
test('JST day and Monday week boundaries include past days and cross year/month correctly',()=>{
  assert.equal(calendarRange('today',new Date('2026-10-10T14:59:59Z')).timeMin,'2026-10-09T15:00:00.000Z');
  assert.equal(calendarRange('today',new Date('2026-10-10T15:00:00Z')).timeMin,'2026-10-10T15:00:00.000Z');
  const week=calendarRange('week',new Date('2026-10-11T03:00:00Z'));
  assert.equal(week.timeMin,'2026-10-04T15:00:00.000Z');assert.equal(week.timeMax,'2026-10-11T15:00:00.000Z');
  assert.equal(calendarRange('tomorrow',new Date('2026-12-31T03:00:00Z')).timeMin,'2026-12-31T15:00:00.000Z');
});
test('event output handles all-day exclusive end, overnight, cancelled and declined events',()=>{
  const range=calendarRange('week',new Date('2026-10-10T00:00Z'));
  const events=[{summary:'旅行',start:{date:'2026-10-10'},end:{date:'2026-10-13'}},
    {summary:'夜間作業',start:{dateTime:'2026-10-10T23:30:00+09:00'},end:{dateTime:'2026-10-11T01:00:00+09:00'}},
    {status:'cancelled',summary:'中止'}, {attendees:[{self:true,responseStatus:'declined'}],summary:'辞退'}];
  const {text}=formatCalendar(range,events);assert.match(text,/2件/);assert.match(text,/2026-10-10〜2026-10-12 終日/);assert.match(text,/23:30/);assert.match(text,/01:00/);assert.doesNotMatch(text,/中止|辞退/);
  assert.match(formatCalendar(range,[]).text,/予定はありません/);
  assert.throws(()=>formatCalendar(range,[{start:{dateTime:'bad'}}]),CalendarError);
});
test('all pages are fetched with recurrence expansion, overlap window and fixed primary calendar',async()=>{
  const calls=[];
  const result=await fetchCalendar('today',{accessToken:'token',now:new Date('2026-10-10T01:00Z'),request:async(url,opts)=>{
    calls.push([url,opts]);return calls.length===1?{items:[{summary:'会議',start:{date:'2026-10-10'},end:{date:'2026-10-11'}}],nextPageToken:'second'}:{items:[]};
  }});
  assert.match(result.text,/1件/);assert.equal(calls.length,2);
  const url=new URL(calls[0][0]);assert.equal(url.pathname,'/calendar/v3/calendars/primary/events');assert.equal(url.searchParams.get('singleEvents'),'true');assert.equal(url.searchParams.get('timeMin'),'2026-10-09T15:00:00.000Z');assert.equal(calls[0][1].token,'token');
  assert.equal(new URL(calls[1][0]).searchParams.get('pageToken'),'second');
  await assert.rejects(fetchCalendar('today',{request:async()=>{throw new CalendarError('接続失敗');}}),/接続失敗/);
});
function get(url){return new Promise((resolve,reject)=>{http.get(url,res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);});}
test('desktop OAuth uses external browser, loopback, state and PKCE; invalid state cannot finish auth',async()=>{
  let authUrl,callback;
  const result=await authorize(client,{openExternal:async url=>{
    authUrl=new URL(url);callback=authUrl.searchParams.get('redirect_uri');assert.equal(new URL(callback).hostname,'127.0.0.1');
    assert.equal(await get(callback+'?code=wrong&state=wrong'),400);
    assert.equal(await get(callback+'?code=example&state='+authUrl.searchParams.get('state')),200);
  }});
  assert.equal(result.code,'example');assert.equal(authUrl.origin,'https://accounts.google.com');assert.equal(authUrl.searchParams.get('scope'),SCOPE);
  assert.equal(createHash('sha256').update(result.code_verifier).digest('base64url'),authUrl.searchParams.get('code_challenge'));
  await assert.rejects(get(callback));
});
test('OAuth denial, browser failure, abort and timeout settle without leaving a listener',async()=>{
  await assert.rejects(authorize(client,{openExternal:async url=>{const u=new URL(url);await get(u.searchParams.get('redirect_uri')+'?error=access_denied&state='+u.searchParams.get('state'));}}),/許可/);
  await assert.rejects(authorize(client,{openExternal:async()=>{throw Error('browser');}}),/ブラウザー/);
  const controller=new AbortController();controller.abort();await assert.rejects(authorize(client,{signal:controller.signal}),/取り消し/);
  await assert.rejects(authorize(client,{openExternal:async()=>{},timeoutMs:20}),/接続待ち/);
});
function make(t,extra={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-calendar-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'google-calendar.enc');
  // Test double only. Production uses Electron safeStorage/Windows DPAPI.
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:x=>Buffer.from(x).map(v=>v^123),decryptString:x=>Buffer.from(x).map(v=>v^123).toString()};
  const service=new GoogleCalendar({file,safeStorage,openExternal:async()=>{},...extra});return {service,file,safeStorage};
}
test('credential validation, encrypted persistence, refresh and disconnect never expose tokens in UI',async t=>{
  assert.throws(()=>parseClient(JSON.stringify({web:client})),/デスクトップ/);
  const calls=[];
  const {service,file}=make(t,{auth:async()=>({code:'code',code_verifier:'verifier',redirect_uri:'http://127.0.0.1:1234/oauth2callback'}),request:async(url,options)=>{
    calls.push([url,options]);if(url.endsWith('/token'))return {access_token:'access-value',refresh_token:'refresh-value',scope:SCOPE};return {};
  }});
  await assert.rejects(service.ask('today'),/未接続/);
  service.importClient(JSON.stringify({installed:client}));await service.connect();assert.equal(service.snapshot().connected,true);
  assert.doesNotMatch(fs.readFileSync(file).toString(),/refresh-value|test-secret/);assert.doesNotMatch(JSON.stringify(service.snapshot()),/refresh-value|access-value|test-secret/);
  service.data={};service.load();assert.equal(service.snapshot().connected,true);
  assert.match((await service.ask('today')).text,/予定はありません/);
  assert.ok(calls.some(([,o])=>o.form?.grant_type==='refresh_token'));
  await service.disconnect();assert.equal(service.snapshot().connected,false);assert.ok(calls.some(([u])=>u.endsWith('/revoke')));
});
test('cancelled authorization cannot persist a late token, and no plaintext fallback is allowed',async t=>{
  let complete;
  const {service,file,safeStorage}=make(t,{auth:()=>new Promise(resolve=>complete=resolve),request:async()=>({refresh_token:'late',access_token:'a',scope:SCOPE})});
  service.importClient(JSON.stringify({installed:client}));const pending=service.connect();service.cancel();complete({code:'late'});await pending;assert.equal(service.snapshot().connected,false);
  safeStorage.isEncryptionAvailable=()=>false;assert.throws(()=>service.importClient(JSON.stringify({installed:client})),/保護/);
  assert.doesNotMatch(fs.readFileSync(file).toString(),/late/);
});
test('calendar cancellation prevents stale answers and does not commit to conversation',async()=>{
  let resolve,shown=false,signal;
  const cycle=new AnswerCycle({ask:(_q,options)=>{signal=options.signal;return new Promise(r=>resolve=r);},started:()=>{},complete:()=>{shown=true;},failed:()=>{}});
  const work=cycle.begin('today');cycle.cancel();resolve({text:'予定'});await work;assert.equal(shown,false);assert.equal(signal.aborted,true);
});
test('missing scope never saves a grant; refresh failure is not an empty calendar; revoke failure still clears local access',async t=>{
  const {service}=make(t,{auth:async()=>({code:'code'}),request:async()=>({access_token:'a',refresh_token:'r',scope:'wrong'})});
  service.importClient(JSON.stringify({installed:client}));await service.connect();assert.equal(service.snapshot().connected,false);assert.match(service.snapshot().message,/権限/);
  service.save({...service.data,refreshToken:'r'});service.request=async()=>{throw new CalendarError('認証が期限切れ');};
  await assert.rejects(service.ask('today'),/期限切れ/);
  await service.disconnect();assert.equal(service.snapshot().connected,false);assert.match(service.snapshot().message,/Google側/);
});
test('pagination is bounded and an aborted retrieval stops before requesting another page',async()=>{
  let calls=0;
  await assert.rejects(fetchCalendar('week',{request:async()=>{calls++;return {items:[],nextPageToken:'more'};}}),/多すぎる/);assert.equal(calls,20);
  const controller=new AbortController();calls=0;
  await assert.rejects(fetchCalendar('today',{signal:controller.signal,request:async()=>{calls++;controller.abort();return {items:[],nextPageToken:'more'};}}),{name:'AbortError'});assert.equal(calls,1);
});
