const {randomUUID}=require('node:crypto');
class QuestionInput {
  constructor(options) {this.options=options;this.current=null;}
  begin() {
    this.cancel();
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        if(this.current?.id!==id)return;
        this.current=null;reject(Error('質問入力の終了通知が届きませんでした。'));
      },this.options.captureTimeoutMs ?? 20000);
      this.current={id,resolve,reject,timer};
      this.options.start(id).catch(e=>{
        if(this.current?.id!==id)return;
        clearTimeout(timer);this.current=null;reject(e);
      });
    });
  }
  report(m) {
    if(m.capture_id!==this.current?.id)return;
    if(m.type==='transcription_started' && !this.current.transcribing) {
      const run=this.current;run.transcribing=true;clearTimeout(run.timer);
      run.timer=setTimeout(()=>{
        if(this.current!==run)return;
        this.current=null;run.reject(Error('文字起こしの応答がタイムアウトしました。'));
      },this.options.transcriptionTimeoutMs ?? 60000);
      this.options.transcribing?.();
    }
    if(m.type==='capture_done') {
      const run=this.current;this.current=null;clearTimeout(run.timer);
      this.options.done(m);run.resolve();
    }
  }
  cancel() {
    const run=this.current;this.current=null;
    if(run){clearTimeout(run.timer);run.resolve();}
  }
}
module.exports={QuestionInput};
