const {createHash}=require('node:crypto');
class Reminders {
  constructor({fetch,notify,save=()=>{},seen={},now=Date.now,onChange=()=>{}}) {
    Object.assign(this,{fetch,notify,save,seen,now,onChange});this.items=[];this.notice='';this.next=0;this.controller=null;this.version=0;
  }
  reset(){this.version++;this.controller?.abort();this.controller=null;this.items=[];this.notice='';this.next=0;}
  async tick({enabled,minutes,connected,available,idle}) {
    if(!enabled||!connected||!available){this.reset();return;}
    const now=this.now();
    if(now>=this.next&&!this.controller) {
      const controller=new AbortController(),version=this.version;this.controller=controller;
      const timeout=setTimeout(()=>controller.abort(),45000);
      this.next=now+60000;
      try {
        const items=await this.fetch(controller.signal);
        if(version!==this.version||controller.signal.aborted)return;
        this.items=items;this.notice='';this.fetched=this.now();
      }catch {if(version===this.version){this.items=[];this.notice='予定通知を更新できません。Google接続とネット接続を確認してください。';}}
      finally{clearTimeout(timeout);if(this.controller===controller)this.controller=null;this.onChange();}
      // Delivery occurs on the next tick, using fresh idle/lock state.
      return;
    }
    if(!idle||this.controller||now-this.fetched>90000)return;
    const due=this.items.filter(e=>e.id&&e.start?.dateTime&&e.status!=='cancelled'&&!e.attendees?.some(a=>a.self&&a.responseStatus==='declined'))
      .map(e=>({...e,startMs:Date.parse(e.start.dateTime)})).filter(e=>e.startMs>now&&e.startMs-now<=minutes*60000).sort((a,b)=>a.startMs-b.startMs);
    const fresh=due.map(e=>({...e,key:createHash('sha256').update(e.id+'|'+e.start.dateTime).digest('hex')})).filter(e=>!this.seen[e.key]);
    if(!fresh.length)return;
    this.seen=Object.fromEntries(Object.entries(this.seen).filter(([,until])=>until>now));
    const next={...this.seen};for(const e of fresh)next[e.key]=e.startMs+86400000;
    try{this.save(next);}catch{this.notice='予定通知の記録を保存できません。保存先の権限を確認してください。';this.onChange();return;}
    this.seen=next;
    const rows=fresh.map(e=>({title:typeof e.summary==='string'?e.summary.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,120):'（件名なし）',start:e.startMs}));
    this.notify(rows);this.onChange();
  }
}
module.exports={Reminders};
