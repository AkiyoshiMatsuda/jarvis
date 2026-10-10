"""Synthetic audio only: old disposable STT vs retained model."""
import json
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from transcription import TranscriptionJob, shutdown_transcription
from test_transcription import sample_pcm

root = Path(__file__).resolve().parents[1]
rows = []
try:
    for mode in ('cold', 'warm'):
        shutdown_transcription()
        for i in range(3):
            start = time.perf_counter()
            command = [sys.executable, '-u', str(root / 'jarvis_worker.py'), '--transcribe'] if mode == 'cold' else None
            job = TranscriptionJob(sample_pcm(), command=command)
            while (result := job.poll()) is None:
                time.sleep(.01)
            assert 'はい' in result.get('text', ''), result
            rows.append(dict(mode=mode, run=i+1, elapsed_ms=round((time.perf_counter()-start)*1000)))
            print(rows[-1], flush=True)
            if mode == 'cold':
                job.cancel()
    # Per-request recognizer must not retain the previous utterance.
    silence = TranscriptionJob(bytes(32000))
    while (result := silence.poll()) is None:
        time.sleep(.01)
    assert result == {'text': ''}, result
finally:
    shutdown_transcription()
(root / 'validation/stt-speed.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
