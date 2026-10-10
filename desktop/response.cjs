const {randomUUID} = require('node:crypto');

// Cancelling invalidates every continuation before a stop is processed.
class ResponseCycle {
  constructor(options) { this.options=options; this.current=null; }
  cancel() {
    const run=this.current; this.current=null;
    if (run) { run.finishWait?.(); this.options.stopAudio(); }
  }
  async begin({greet=true}={}) {
    if (this.current || !this.options.allowed()) return false;
    const run={id:randomUUID()}; this.current=run;
    const valid=()=>this.current===run && this.options.allowed();
    try {
      this.options.activate({greet});
      await this.options.pause();
      if (!valid()) return false;
      try { if(greet) await this.options.play(run.id); }
      catch(e) { if (valid()) this.options.speechError(e); }
      if (!valid()) return false;
      await new Promise(resolve=>{
        const timer=setTimeout(resolve,this.options.cooldownMs ?? 700);
        run.finishWait=()=>{clearTimeout(timer);resolve();};
      });
      if (!valid()) return false;
      if (this.options.input) await this.options.input();
      if (!valid()) return false;
      if (this.options.answer) await this.options.answer();
      if (!valid()) return false;
      await this.options.resume();
      return true;
    } catch(e) { if (valid()) this.options.fatal(e); return false; }
    finally { if (this.current===run) this.current=null; }
  }
}

class ResponseAudio {
  constructor(send, onStarted, timeoutMs=10000) {
    this.send=send; this.onStarted=onStarted; this.timeoutMs=timeoutMs; this.pending=null;
  }
  play(id,volume,extra={}) {
    this.cancel();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        if (this.pending?.id!==id) return;
        this.pending=null; this.send({type:'stop'});
        reject(Error('音声応答が時間内に完了しませんでした。'));
      },this.timeoutMs);
      this.pending={id,resolve,reject,timer,started:false};
      this.send({type:'play',id,volume,...extra});
    });
  }
  report(id,event) {
    const pending=this.pending;
    if (!pending || pending.id!==id) return;
    if (event==='started') {
      if (!pending.started) {pending.started=true;this.onStarted();}
      return;
    }
    if (!['ended','error'].includes(event)) return;
    clearTimeout(pending.timer); this.pending=null;
    if(event==='error') pending.reject(Error('応答音声を再生できません。音声ファイルと出力デバイスを確認してください。'));
    else pending.resolve();
  }
  cancel() {
    if(this.pending) {clearTimeout(this.pending.timer);this.pending.resolve();this.pending=null;}
    this.send({type:'stop'});
  }
}
module.exports={ResponseCycle,ResponseAudio};
