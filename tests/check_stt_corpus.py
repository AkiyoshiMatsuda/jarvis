import json, time, wave, subprocess
from pathlib import Path
import numpy as np
import soxr, psutil
from vosk import Model, KaldiRecognizer, SetLogLevel
SetLogLevel(-1)
root=Path('validation/stt-numbers')
corpus=json.loads((root/'corpus.json').read_text(encoding='utf-8-sig'))
results=[]
for name in ('vosk-model-small-ja-0.22','vosk-model-ja-0.22'):
    started=time.perf_counter(); model=Model('models/'+name)
    load=time.perf_counter()-started
    rows=[]
    for row in corpus:
        with wave.open(row['file']) as w:
            audio=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(np.float32)/32768
            audio=soxr.resample(audio,w.getframerate(),16000)
        pcm=(np.clip(audio,-1,1)*32767).astype('<i2').tobytes()
        rec=KaldiRecognizer(model,16000); texts=[]; started=time.perf_counter()
        for offset in range(0,len(pcm),8000):
            if rec.AcceptWaveform(pcm[offset:offset+8000]): texts.append(json.loads(rec.Result()).get('text',''))
        texts.append(json.loads(rec.FinalResult()).get('text',''))
        rows.append({**row,'text':' '.join(filter(None,texts)), 'elapsed':time.perf_counter()-started})
    parsed=json.loads(subprocess.check_output(['node','-e',"const p=require('./desktop/timer.cjs').parseTimerCommand;let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(s).map(x=>p(x.text)))));"],input=json.dumps(rows).encode()))
    for row,command in zip(rows,parsed): row['command']=command; row['correct']=(command is None if not row['seconds'] else command=={'type':'start','durationMs':row['seconds']*1000})
    result={'model':name,'load_seconds':load,'rss_mb':psutil.Process().memory_info().rss/1048576,'correct':sum(r['correct'] for r in rows),'rows':rows}
    results.append(result); (root/'comparison.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print(name,load,result['rss_mb'],result['correct'],len(rows),flush=True)
    del rec,model

