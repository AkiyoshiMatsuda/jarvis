const MAX_MS=24*60*60*1000;
function number(text) {
  if(/^\d+(?:\.\d+)?$/.test(text))return Number(text);
  const digits={'〇':0,'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  let total=0,current=0;
  for(const c of text) {
    if(c in digits)current=current*10+digits[c];
    else if(c==='十'||c==='百') {total+=(current||1)*(c==='十'?10:100);current=0;}
    else return NaN;
  }
  return total+current;
}
function parseTimerCommand(input) {
  const text=input.normalize('NFKC').replace(/[\s、。！？!?]/g,'').replace(/分間/g,'分').replace(/秒間/g,'秒').replace(/図って/g,'測って');
  if(/^(?:タイマー(?:を|の)?)?(?:残り時間(?:は|を教えて)?|あと何分|あと何秒)$/.test(text))return {type:'remaining'};
  if(/^(?:タイマーを|タイマー)(?:停止|止めて|やめて|キャンセル|取り消して|解除)(?:して|ください)?$/.test(text))return {type:'cancel'};
  const match=text.match(/^(?:タイマーを?|タイマーは)?([\d.〇零一二三四五六七八九十百時間分秒半]+)(?:の?タイマー(?:を)?(?:セット|開始|かけて|設定)?|を?(?:測って|計って|はかって|測定して|セット|計測して))(?:して|ください|下さい|くれる|お願い)?$/);
  if(!match)return /(?:測って|計って|はかって|計測して)(?:ください|下さい)?$/.test(text) || /タイマー.*(?:セット|設定|かけて)/.test(text)?{type:'invalid'}:null;
  const duration=match[1];let end=0,total=0,previous=Infinity;
  for(const m of duration.matchAll(/([\d.〇零一二三四五六七八九十百]+)(時間|分|秒)(半)?/g)) {
    if(m.index!==end)return {type:'invalid'};
    const unit={時間:3600,分:60,秒:1}[m[2]],n=number(m[1]);
    if(!Number.isFinite(n)||unit>=previous)return {type:'invalid'};
    total+=(n+(m[3]?0.5:0))*unit;previous=unit;end=m.index+m[0].length;
  }
  const durationMs=Math.round(total*1000);
  return end===duration.length && durationMs>=1000 && durationMs<=MAX_MS ? {type:'start',durationMs}:{type:'invalid'};
}
function durationLabel(ms) {
  const seconds=Math.ceil(ms/1000),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
  return `${h?h+'時間':''}${m?m+'分':''}${s?s+'秒':''}`||'0秒';
}
class TimerService {
  constructor({now=Date.now,onChange=()=>{},onExpire=()=>{}}={}) {this.now=now;this.onChange=onChange;this.onExpire=onExpire;this.current=null;this.sequence=0;}
  snapshot() {return this.current?{...this.current,remainingMs:this.current.status==='running'?Math.max(0,this.current.deadline-this.now()):0}:null;}
  start(durationMs) {
    this.tick();
    if(!Number.isInteger(durationMs)||durationMs<1000||durationMs>MAX_MS)return {ok:false,error:'タイマーは1秒〜24時間で指定してください。'};
    if(this.current?.status==='running')return {ok:false,error:'タイマーが動作中です。停止してから新しく設定してください。'};
    this.current={id:++this.sequence,durationMs,deadline:this.now()+durationMs,status:'running'};this.lastSecond=null;this.onChange();return {ok:true};
  }
  cancel() {this.current=null;this.onChange();}
  tick() {
    if(this.current?.status!=='running')return;
    const remaining=this.current.deadline-this.now();
    if(remaining<=0) {this.current.status='finished';this.onChange();this.onExpire({...this.current});return;}
    const second=Math.ceil(remaining/1000);
    if(second!==this.lastSecond) {this.lastSecond=second;this.onChange();}
  }
}
module.exports={TimerService,parseTimerCommand,durationLabel,MAX_MS};
