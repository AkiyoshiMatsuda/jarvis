"""Offline STT in a disposable child; audio is only passed through anonymous pipes."""
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time

MAX_PCM = 16_000 * 2 * 16


def verify_model(root):
    manifest = json.loads((root / 'stt-manifest.json').read_text(encoding='utf-8'))
    if not manifest.get('files'):
        raise ValueError('Missing model hashes')
    for relative, digest in manifest['files'].items():
        path = (root / relative).resolve()
        if not path.is_relative_to(root.resolve()):
            raise ValueError('STT model hash mismatch')
        with path.open('rb') as source:
            actual = hashlib.file_digest(source, 'sha256').hexdigest()
        if actual != digest:
            raise ValueError('STT model hash mismatch')
    return root / manifest['name']


def recognize(pcm, root=None):
    if not pcm or len(pcm) > MAX_PCM or len(pcm) % 2:
        raise ValueError('Invalid PCM length')
    from vosk import Model, KaldiRecognizer, SetLogLevel
    SetLogLevel(-1)
    folder = verify_model(root or Path(__file__).resolve().parent / 'models')
    model = Model(str(folder))
    recognizer = KaldiRecognizer(model, 16000)
    texts = []
    for offset in range(0, len(pcm), 8000):
        if recognizer.AcceptWaveform(pcm[offset:offset+8000]):
            texts.append(json.loads(recognizer.Result()).get('text', ''))
    texts.append(json.loads(recognizer.FinalResult()).get('text', ''))
    return ' '.join(t for t in texts if t).strip()[:4000]


def child_main():
    # A killed parent must not leave inference running. Also covers pipe-loss exit.
    import psutil
    parent = psutil.Process(os.getppid())
    def watch():
        try:
            while parent.is_running():
                time.sleep(.2)
        except psutil.Error:
            pass
        os._exit(0)
    threading.Thread(target=watch, daemon=True).start()
    try:
        pcm = sys.stdin.buffer.read(MAX_PCM + 1)
        result = {'text': recognize(pcm)}
    except Exception:
        result = {'error': '文字起こしに失敗しました。モデルと実行環境を確認してください。'}
    print(json.dumps(result), flush=True)


class TranscriptionJob:
    def __init__(self, pcm, command=None, timeout=45):
        if len(pcm) > MAX_PCM:
            raise ValueError('Audio too long')
        self.results = queue.Queue(maxsize=1)
        command = command or ([sys.executable, '--transcribe'] if getattr(sys, 'frozen', False)
                              else [sys.executable, '-u', str(Path(__file__).with_name('jarvis_worker.py')), '--transcribe'])
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        def run():
            try:
                out, _ = self.process.communicate(pcm, timeout=timeout)
                result = json.loads(out) if self.process.returncode == 0 else {'error': '文字起こし処理が終了しました。再度お試しください。'}
                if not isinstance(result, dict) or not isinstance(result.get('text', ''), str):
                    raise ValueError('Invalid STT response')
                result = {'text': result['text'][:4000]} if 'text' in result else {'error': '文字起こしに失敗しました。モデルと実行環境を確認してください。'}
            except subprocess.TimeoutExpired:
                self.process.kill(); self.process.communicate()
                result = {'error': '文字起こしが45秒以内に完了しませんでした。再度お試しください。'}
            except Exception:
                if self.process.poll() is None:
                    self.process.kill(); self.process.communicate()
                result = {'error': '文字起こしに失敗しました。再度お試しください。'}
            self.results.put(result)
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()

    def poll(self):
        try:
            return self.results.get_nowait()
        except queue.Empty:
            return None

    def cancel(self):
        if self.process.poll() is None:
            self.process.kill()
        self.thread.join(timeout=3)
