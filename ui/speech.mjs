// Only an explicitly selected local Japanese voice may receive answer text.
import {speechChunks} from './speech-text.mjs';
export const localJapaneseVoices=synth=>synth.getVoices().filter(v=>v.localService===true && /^ja(?:[-_]|$)/i.test(v.lang));
export function connectSpeech(bridge, synth, Utterance, voiceWaitMs=3000) {
  let current=null;
  function stop() {
    const run=current;current=null;
    if(run) {
      clearTimeout(run.timer);
      synth.removeEventListener('voiceschanged',run.tryStart);
      if(run.utterance) run.utterance.onstart=run.utterance.onend=run.utterance.onerror=null;
    }
    synth.cancel();
  }
  const off=bridge.onSpeech(message=>{
    stop();
    if(message.type!=='play')return;
    const run={id:message.id,chunks:speechChunks(message.text),index:0,started:false};current=run;
    const report=kind=>{if(current===run)bridge.speechEvent(run.id,kind);};
    const finish=kind=>{if(current!==run)return;report(kind);stop();};
    run.tryStart=()=>{
      if(current!==run || run.utterance)return;
      const voices=localJapaneseVoices(synth);
      const voice=message.voiceURI?voices.find(v=>v.voiceURI===message.voiceURI):voices[0];
      if(!voice)return;
      clearTimeout(run.timer);synth.removeEventListener('voiceschanged',run.tryStart);
      const speakNext=()=>{if(current!==run)return;
      if(run.index>=run.chunks.length){finish('ended');return;}
      try {
        const utterance=new Utterance(run.chunks[run.index++]);run.utterance=utterance;
        utterance.voice=voice;utterance.lang=voice.lang;utterance.volume=message.volume;
        utterance.rate=Number.isFinite(message.rate)?Math.max(.8,Math.min(1.2,message.rate)):1;utterance.pitch=1;
        utterance.onstart=()=>{if(!run.started){run.started=true;report('started');}};
        utterance.onend=()=>{utterance.onstart=utterance.onend=utterance.onerror=null;queueMicrotask(speakNext);};utterance.onerror=()=>finish('error');
        synth.speak(utterance);
      } catch {finish('error');}
      };
      speakNext();
    };
    run.timer=setTimeout(()=>finish('error'),voiceWaitMs);
    synth.addEventListener('voiceschanged',run.tryStart);run.tryStart();
  });
  return ()=>{off();stop();};
}
