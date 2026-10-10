"""Synthetic timer speech through the shipped STT executable and timer parser.

Run tests/generate_stt_corpus.ps1 first. Does not use or record the microphone.
"""
import json
from pathlib import Path
import subprocess
import time
import wave

import numpy as np
import soxr


def main():
    root = Path(__file__).resolve().parents[1]
    output = root / 'validation/stt-numbers'
    corpus = json.loads((output / 'corpus.json').read_text(encoding='utf-8-sig'))
    worker = root / 'release/win-unpacked/resources/worker/jarvis-worker.exe'
    rows = []
    for index in (1, 3, 5, 6):
        case = corpus[index]
        with wave.open(str(root / case['file'])) as wav:
            audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype(np.float32) / 32768
            audio = soxr.resample(audio, wav.getframerate(), 16000)
        pcm = (np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes()
        started = time.perf_counter()
        result = subprocess.run([str(worker), '--transcribe'], input=pcm, capture_output=True,
                                timeout=45, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        text = json.loads(result.stdout)['text']
        elapsed = time.perf_counter() - started
        command = json.loads(subprocess.check_output(['node', '-e',
            "const p=require('./desktop/timer.cjs').parseTimerCommand;console.log(JSON.stringify(p(process.argv[1])));",
            text], cwd=root))
        rows.append({**case, 'text': text, 'command': command, 'elapsed_seconds': elapsed})
        (output / 'packaged-timers.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
        assert command == {'type': 'start', 'durationMs': case['seconds'] * 1000}, rows[-1]
    print('PASS packaged synthetic timer speech: 3 minutes, 10 minutes, 30 seconds, 1 minute 30 seconds')


if __name__ == '__main__':
    main()
