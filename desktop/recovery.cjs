class Recovery {
  constructor({allowed,attempt,status,delays=[1000,2000,4000,8000,16000],stableMs=60000}) {
    Object.assign(this,{allowed,attempt,status,delays,stableMs});
    this.count=0;this.generation=0;this.timer=null;this.stable=null;this.running=false;this.halted=false;
  }
  cancel() {this.generation++;clearTimeout(this.timer);clearTimeout(this.stable);this.timer=this.stable=null;this.running=false;}
  reset() {this.cancel();this.count=0;this.halted=false;}
  healthy() {
    if(this.stable || this.halted) return;
    this.stable=setTimeout(()=>{this.count=0;this.stable=null;},this.stableMs);
  }
  fail(error) {
    clearTimeout(this.stable);this.stable=null;
    if(error.permanent) {this.cancel();this.halted=true;this.status('ERROR',error,this.count);return;}
    if(!this.allowed()) {this.cancel();this.status('INACTIVE',error,this.count);return;}
    if(this.timer || this.running) return;
    if(this.halted || this.count>=this.delays.length) {this.halted=true;this.status('ERROR',error,this.count);return;}
    const delay=this.delays[this.count++], generation=this.generation;
    this.status('RECOVERING',error,this.count,delay);
    this.timer=setTimeout(async()=>{
      this.timer=null;
      const valid=()=>this.generation===generation && this.allowed() && !this.halted;
      if(!valid()) return;
      this.running=true;
      try {
        await this.attempt(valid);
        if(valid()) {this.running=false;this.healthy();}
      } catch(e) {if(valid()){this.running=false;this.fail(e);}}
    },delay);
  }
}
module.exports={Recovery};
