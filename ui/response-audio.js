export function connectResponseAudio() {
  let current=null;
  function stop() {
    if (!current) return;
    current.audio.onplaying=current.audio.onended=current.audio.onerror=null;
    current.audio.pause(); current.audio.removeAttribute('src'); current.audio.load(); current=null;
  }
  const unsubscribe=window.jarvis.onResponse(message=>{
    if(message.type==='stop') {stop();return;}
    if(message.type!=='play') return;
    stop();
    const audio=new Audio(new URL('./response.wav',window.location.href).href);
    audio.volume=Math.max(0,Math.min(1,message.volume));
    current={audio,id:message.id};
    const report=kind=>{if(current?.id===message.id) window.jarvis.responseEvent(message.id,kind);};
    audio.onplaying=()=>report('started');
    audio.onended=()=>{report('ended');stop();};
    audio.onerror=()=>{report('error');stop();};
    audio.play().catch(()=>{if(current?.id===message.id){report('error');stop();}});
  });
  return ()=>{unsubscribe();stop();};
}
