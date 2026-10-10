"""Validate pooled packaged recognizer on synthesized timer phrases."""
import json
import queue
import struct
import subprocess
import threading
import time
import wave
from pathlib import Path
import numpy as np
import soxr

root = Path(__file__).resolve().parents[1]
output = root / 'validation/stt-numbers'
corpus = json.loads((output / 'corpus.json').read_text(encoding='utf-8-sig'))
worker = root / 'release/win-unpacked/resources/worker/jarvis-worker.exe'
p = subprocess.Popen([str(worker), '--transcribe-server'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
results = queue.Queue()
def read():
    for line in p.stdout:
        results.put(json.loads(line))
reader = threading.Thread(target=read, daemon=True)
reader.start()
rows = []
try:
    for index in (1, 3, 5, 6):
        case = corpus[index]
        with wave.open(str(root / case['file'])) as wav:
            audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype(np.float32) / 32768
            audio = soxr.resample(audio, wav.getframerate(), 16000)
        pcm = (np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes()
        start = time.perf_counter()
        p.stdin.write(struct.pack('<I', len(pcm)) + pcm)
        p.stdin.flush()
        result = results.get(timeout=45)
        text = result['text']
        parsed = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(require('./desktop/timer.cjs').parseTimerCommand(process.argv[1])))", text], cwd=root))
        assert parsed == {'type': 'start', 'durationMs': case['seconds']*1000}, (case, result)
        rows.append({'seconds': case['seconds'], 'elapsed_ms': round((time.perf_counter()-start)*1000), 'recognized': True})
    p.stdin.close()
    assert p.wait(timeout=5) == 0
    (output / 'warm-packaged.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
    print('PASS retained packaged STT: 3 min, 10 min, 30 sec, 1 min 30 sec, clean EOF exit')
finally:
    if p.poll() is None:
        p.kill()
        p.wait(timeout=5)
    reader.join(timeout=2)
    p.stdout.close()
    if not p.stdin.closed:
        p.stdin.close()
