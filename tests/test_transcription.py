from pathlib import Path
import sys
import tempfile
import time
import unittest
import wave
import subprocess
import psutil
import hashlib
import json

import numpy as np
import soxr
from transcription import TranscriptionJob, recognize, verify_model


def sample_pcm():
    with wave.open(str(Path(__file__).resolve().parents[1] / 'ui/public/response.wav')) as wav:
        audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype(np.float32) / 32768
        if wav.getframerate() != 16000:
            audio = soxr.resample(audio, wav.getframerate(), 16000)
        return (np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes()


class TranscriptionTests(unittest.TestCase):
    def wait(self, job):
        end = time.monotonic() + 55
        while time.monotonic() < end:
            result = job.poll()
            if result is not None:
                return result
            time.sleep(.02)
        self.fail('No STT result')

    def test_synthetic_japanese_speech_real_model(self):
        job = TranscriptionJob(sample_pcm())
        try:
            result = self.wait(job)
            self.assertNotIn('error', result)
            self.assertIn('何', result['text'])
            self.assertTrue(result['text'].startswith('はい'), result)
        finally:
            job.cancel()

    def test_silence_has_no_text(self):
        self.assertEqual(recognize(bytes(32000)), '')

    def test_missing_model_does_not_download(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(FileNotFoundError):
                verify_model(Path(temp))

    def test_model_integrity_rejects_changes_and_paths_outside_root(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = root / 'model'
            model.mkdir()
            source = model / 'data'
            source.write_bytes(b'model data')
            manifest = {'name': 'model', 'files': {'model/data': hashlib.sha256(b'model data').hexdigest()}}
            (root / 'stt-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            self.assertEqual(verify_model(root), model)
            source.write_bytes(b'changed')
            with self.assertRaises(ValueError):
                verify_model(root)
            manifest['files'] = {'../outside': 'not-a-hash'}
            (root / 'stt-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaises(ValueError):
                verify_model(root)

    def test_cancel_terminates_child(self):
        job = TranscriptionJob(b'\0\0', command=[sys.executable, '-c', 'import time; time.sleep(60)'])
        job.cancel()
        self.assertIsNotNone(job.process.poll())
        self.assertFalse(job.thread.is_alive())

    def test_timeout_terminates_child(self):
        job = TranscriptionJob(b'\0\0', command=[sys.executable, '-c', 'import time; time.sleep(60)'], timeout=.1)
        try:
            self.assertIn('error', self.wait(job))
            self.assertIsNotNone(job.process.poll())
        finally:
            job.cancel()

    def test_crash_returns_error(self):
        job = TranscriptionJob(b'\0\0', command=[sys.executable, '-c', 'raise SystemExit(2)'])
        try:
            self.assertIn('error', self.wait(job))
        finally:
            job.cancel()

    def test_parent_exit_leaves_no_stt_child(self):
        code = "from transcription import TranscriptionJob; import time; j=TranscriptionJob(bytes(480000)); print(j.process.pid, flush=True); time.sleep(60)"
        parent = subprocess.Popen([sys.executable, '-u', '-c', code], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            pid = int(parent.stdout.readline())
            parent.kill();parent.wait(timeout=5)
            try:
                child = psutil.Process(pid)
                child.wait(timeout=5)
            except psutil.NoSuchProcess:
                pass
        finally:
            if parent.poll() is None:
                parent.kill();parent.wait(timeout=5)
            parent.stdout.close()
