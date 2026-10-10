export function connectTimerAlarm(bridge,AudioContext) {
  let current=null;
  function stop() {
    const run=current;current=null;
    if(!run)return;
    for(const oscillator of run.oscillators) {oscillator.onended=null;try{oscillator.stop();}catch{}oscillator.disconnect();}
    run.context.close().catch(()=>{});
  }
  const off=bridge.onTimerAlarm(async message=>{
    stop();if(message.type!=='play')return;
    let run;
    try {
      const context=new AudioContext();run={context,oscillators:[]};current=run;
      await context.resume();if(current!==run)return;
      const gain=context.createGain();gain.gain.value=Math.max(0,Math.min(1,message.volume))*.4;gain.connect(context.destination);
      for(let i=0;i<4;i++) {
        const oscillator=context.createOscillator();oscillator.type='triangle';oscillator.frequency.value=i%2?1046:784;oscillator.connect(gain);run.oscillators.push(oscillator);
        if(i===3)oscillator.onended=()=>{if(current===run){bridge.timerAlarmEvent(message.id,'ended');stop();}};
        oscillator.start(context.currentTime+i*.4);oscillator.stop(context.currentTime+i*.4+.25);
      }
      bridge.timerAlarmEvent(message.id,'started');
    } catch {if(!run || current===run){bridge.timerAlarmEvent(message.id,'error');stop();}}
  });
  return ()=>{off();stop();};
}
