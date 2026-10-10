"""Test-only device replay; never included in the shipped worker."""
from pathlib import Path
import sys
import threading
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import sounddevice as sd
from test_transcription import sample_pcm
import jarvis_worker

pcm = np.frombuffer(sample_pcm(), dtype='<i2').astype(np.float32) / 32768
audio = np.concatenate([pcm, np.zeros(32000, dtype=np.float32)])


class Replay:
    def __init__(self, **kwargs):
        self.callback = kwargs['callback']
        self.ended = threading.Event()

    def start(self):
        def run():
            for start in range(0, len(audio), 1280):
                if self.ended.wait(.08):
                    return
                block = audio[start:start+1280].reshape(-1, 1)
                self.callback(block, len(block), None, False)
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()

    def abort(self):
        self.ended.set()

    def close(self):
        self.ended.set()
        self.thread.join(timeout=1)


sd.InputStream = Replay
sd.check_input_settings = lambda **kwargs: None
jarvis_worker.input_devices = lambda _sd: [dict(index=0, name='Replay', hostapi='test', rate=16000)]
jarvis_worker.main()
