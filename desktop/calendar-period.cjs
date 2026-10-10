const DAY=86400000,JST=9*3600000;
const aliases={今日:'today',きょう:'today',本日:'today',明日:'tomorrow',あした:'tomorrow',あす:'tomorrow',明後日:'dayAfterTomorrow',あさって:'dayAfterTomorrow',昨日:'yesterday',きのう:'yesterday',
  今週:'week',こんしゅう:'week',来週:'nextWeek',らいしゅう:'nextWeek',再来週:'weekAfterNext',先週:'lastWeek',
  今月:'month',こんげつ:'month',来月:'nextMonth',らいげつ:'nextMonth',再来月:'monthAfterNext',先月:'lastMonth',
  週末:'weekend',今週末:'weekend',今週の週末:'weekend',来週末:'nextWeekend',来週の週末:'nextWeekend',
  次:'next',次の:'next',この次:'next',直近:'next',これから:'next'};
function numeral(value) {
  if(/^\d+$/.test(value))return Number(value);
  const digits='〇一二三四五六七八九';let sum=0,n=0;
  for(const c of value.replace(/零/g,'〇')) {
    if(digits.includes(c))n=n*10+digits.indexOf(c);
    else {const unit={十:10,百:100,千:1000}[c];if(!unit)return NaN;sum+=(n||1)*unit;n=0;}
  }
  return sum+n;
}
function parseCalendarCommand(input) {
  const text=input.normalize('NFKC').replace(/[\s、。！？!?]/g,'');
  const m=text.match(/^(?:Googleカレンダー(?:で|の)?|グーグルカレンダー(?:で|の)?)?(.+?)(?:の)?(?:予定|スケジュール)(?:は(?:何|なに|何ですか|どう|いつ|いつですか|ある|ありますか|入ってる)?|が(?:ある|ありますか)|ある|を(?:教えて|見せて|確認して|確認したい|読み上げて|チェックして)|教えて|見せて)?(?:ください|下さい|くれる|くれますか|もらえる|ほしい)?$/i);
  if(!m)return null;
  let period=m[1].replace(/の$/,'');
  if(Object.hasOwn(aliases,period))return aliases[period];
  period=period.replace(/[〇零一二三四五六七八九十百千\d]+(?=年|月|日)/g,x=>String(numeral(x)));
  let part=period.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日$/) || period.match(/^(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})$/);
  if(part)return {kind:'date',year:part[1]?Number(part[1]):null,month:Number(part[2]),day:Number(part[3])};
  part=period.match(/^(今週|来週|再来週|今度)?の?([月火水木金土日])曜(?:日)?$/);
  if(part)return {kind:'weekday',week:part[1]??'今度',weekday:'日月火水木金土'.indexOf(part[2])};
  part=period.match(/^(\d{1,3})日後$/);
  if(part)return {kind:'offset',days:Number(part[1])};
  part=period.match(/^(?:今後|これから)(\d{1,3})日間?$/);
  if(part)return {kind:'days',days:Number(part[1])};
  // Recognizable but invalid calendar periods should not be sent to the LLM.
  if(/^(?:\d|今|来|再来|先|次|明|昨|これから|直近|週末)/.test(period))return {kind:'invalid'};
  return null;
}
function calendarRange(command,now=new Date()) {
  const jst=new Date(now.getTime()+JST),y=jst.getUTCFullYear(),m=jst.getUTCMonth(),d=jst.getUTCDate();
  const midnight=(year,month,day)=>Date.UTC(year,month,day)-JST;
  const today=midnight(y,m,d),monday=today-((jst.getUTCDay()+6)%7)*DAY;
  let start=today,end=today+DAY,label,week=false,next=false;
  const relative={today:[0,'今日'],tomorrow:[1,'明日'],dayAfterTomorrow:[2,'明後日'],yesterday:[-1,'昨日']};
  const weeks={week:[0,'今週'],nextWeek:[1,'来週'],weekAfterNext:[2,'再来週'],lastWeek:[-1,'先週']};
  const months={month:[0,'今月'],nextMonth:[1,'来月'],monthAfterNext:[2,'再来月'],lastMonth:[-1,'先月']};
  if(typeof command==='string'&&relative[command]) {const [offset,name]=relative[command];start=today+offset*DAY;end=start+DAY;label=name;}
  else if(typeof command==='string'&&weeks[command]) {const [offset,name]=weeks[command];start=monday+offset*7*DAY;end=start+7*DAY;label=name;week=true;}
  else if(typeof command==='string'&&months[command]) {const [offset,name]=months[command];start=midnight(y,m+offset,1);end=midnight(y,m+offset+1,1);label=name;}
  else if(command==='weekend'||command==='nextWeekend') {start=monday+(command==='weekend'?5:12)*DAY;end=start+2*DAY;label=command==='weekend'?'今週末':'来週末';}
  else if(command==='next') {start=now.getTime();end=start+365*DAY;label='次の予定';next=true;}
  else if(command?.kind==='date') {
    const year=command.year??y;
    if(!Number.isInteger(year)||year<1900||year>9999||!Number.isInteger(command.month)||!Number.isInteger(command.day))throw Error('指定された日付が正しくありません。');
    start=midnight(year,command.month-1,command.day);const check=new Date(start+JST);
    if(check.getUTCFullYear()!==year||check.getUTCMonth()!==command.month-1||check.getUTCDate()!==command.day)throw Error('指定された日付が存在しません。');
    end=start+DAY;label=`${year}年${command.month}月${command.day}日`;
  } else if(command?.kind==='weekday') {
    if(!Number.isInteger(command.weekday)||command.weekday<0||command.weekday>6||!['今週','来週','再来週','今度'].includes(command.week))throw Error('曜日を確認してください。');
    start=command.week==='今度'?today+(command.weekday-jst.getUTCDay()+7)%7*DAY:monday+({今週:0,来週:7,再来週:14}[command.week]+(command.weekday+6)%7)*DAY;
    end=start+DAY;label=`${command.week}の${'日月火水木金土'[command.weekday]}曜日`;
  } else if(['offset','days'].includes(command?.kind)) {
    if(!Number.isInteger(command.days)||command.days<(command.kind==='days'?1:0)||command.days>365)throw Error('日数は1〜365日の範囲で指定してください。');
    if(command.kind==='offset'){start=today+command.days*DAY;end=start+DAY;label=`${command.days}日後`;}
    else {end=today+command.days*DAY;label=`今日から${command.days}日間`;}
  } else throw Error('予定の期間を確認できませんでした。「来週の予定」「10月15日の予定」のように指定してください。');
  return {timeMin:new Date(start).toISOString(),timeMax:new Date(end).toISOString(),label,week,next};
}
module.exports={parseCalendarCommand,calendarRange};
