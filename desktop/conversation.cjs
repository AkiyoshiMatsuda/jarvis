const MAX_TURNS=6,MAX_CHARS=3000,IDLE_MS=10*60*1000;
function validateHistory(history) {
  if(!Array.isArray(history) || history.length>MAX_TURNS*2 || history.length%2)throw Error('Invalid history');
  let size=0;
  const result=history.map((m,i)=>{
    if(m?.role!==(i%2?'assistant':'user') || typeof m.content!=='string' || !m.content.trim())throw Error('Invalid history');
    size+=m.content.length;return {role:m.role,content:m.content};
  });
  if(size>MAX_CHARS)throw Error('History too large');
  return result;
}
class Conversation {
  constructor({onExpire=()=>{},idleMs=IDLE_MS}={}) {
    this.messages=[];this.version=0;this.trimmed=false;this.onExpire=onExpire;this.idleMs=idleMs;
  }
  context() {return this.messages.map(m=>({...m}));}
  clear() {clearTimeout(this.timer);this.messages=[];this.trimmed=false;this.version++;}
  idle(enabled,hasContent=this.messages.length>0) {
    clearTimeout(this.timer);
    if(enabled && hasContent) {
      this.timer=setTimeout(()=>{this.clear();this.onExpire();},this.idleMs);
      this.timer.unref?.();
    }
  }
  commit(question,result,version) {
    if(version!==this.version || result.truncated)return;
    this.messages.push({role:'user',content:question.trim()},{role:'assistant',content:result.text});
    while(this.messages.length>MAX_TURNS*2 || this.messages.reduce((n,m)=>n+m.content.length,0)>MAX_CHARS) {
      this.messages.splice(0,2);this.trimmed=true;
    }
  }
}
module.exports={Conversation,validateHistory,MAX_TURNS,MAX_CHARS,IDLE_MS};
