"""Phase 1 local wake-word probe. Audio is never written to disk."""
import argparse
from collections import deque
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import platform
import queue
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent
MODEL_NAMES = ('hey_jarvis_v0.1.onnx', 'melspectrogram.onnx', 'embedding_model.onnx')
BASE_URL = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare():
    folder = ROOT / 'models'
    folder.mkdir(exist_ok=True)
    manifest_path = folder / 'manifest.json'
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    entries = {}
    for name in MODEL_NAMES:
        path = folder / name
        if not path.exists():
            print('Downloading ' + name, file=sys.stderr)
            request = urllib.request.Request(BASE_URL + name, headers={'User-Agent': 'JarvisPhase1'})
            temp = path.with_suffix('.part')
            with urllib.request.urlopen(request, timeout=120) as response, temp.open('wb') as out:
                while block := response.read(1024 * 1024):
                    out.write(block)
            temp.replace(path)
        sha = digest(path)
        if name in old and old[name]['sha256'] != sha:
            raise ValueError(f'Model hash changed: {name}. Inspect the file before replacing the manifest.')
        entries[name] = {'sha256': sha, 'url': BASE_URL + name, 'bytes': path.stat().st_size}
    manifest_path.write_text(json.dumps(entries, indent=2), encoding='utf-8')
    print('Models prepared; hashes recorded in models/manifest.json')


def load_model():
    from openwakeword.model import Model
    folder = ROOT / 'models'
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    for name in MODEL_NAMES:
        if digest(folder / name) != manifest[name]['sha256']:
            raise ValueError('Model hash mismatch: ' + name)
    return Model(wakeword_models=[str(folder / MODEL_NAMES[0])], inference_framework='onnx',
                 melspec_model_path=str(folder / MODEL_NAMES[1]),
                 embedding_model_path=str(folder / MODEL_NAMES[2])), manifest


class Gate:
    def __init__(self, threshold, cooldown):
        self.threshold, self.cooldown = threshold, cooldown
        self.next_time = 0.0
        self.armed = True

    def accept(self, score, now):
        if score < self.threshold:
            self.armed = True
        if score >= self.threshold and self.armed and now >= self.next_time:
            self.armed = False
            self.next_time = now + self.cooldown
            return True
        return False


class Frames:
    def __init__(self, rate):
        import numpy as np
        import soxr
        self.np = np
        self.pending = np.empty(0, dtype=np.float32)
        self.converter = soxr.ResampleStream(rate, 16000, 1, dtype='float32') if rate != 16000 else None

    def feed(self, audio):
        np = self.np
        audio = audio.mean(axis=1).astype(np.float32)
        if self.converter:
            audio = self.converter.resample_chunk(audio)
        self.pending = np.concatenate((self.pending, audio))
        while len(self.pending) >= 1280:
            frame, self.pending = self.pending[:1280], self.pending[1280:]
            yield (np.clip(frame, -1, 32767 / 32768) * 32768).astype(np.int16)


class SafeHandler(RotatingFileHandler):
    warned = False

    def handleError(self, record):
        if not self.warned:
            print('WARNING: diagnostic log cannot be written.', file=sys.stderr)
            self.warned = True


class Events:
    def __init__(self):
        self.session = str(uuid.uuid4())
        self.logger = logging.getLogger('jarvis')
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False
        try:
            (ROOT / 'logs').mkdir(exist_ok=True)
            handler = SafeHandler(ROOT / 'logs' / 'probe.jsonl', maxBytes=5 * 1024 * 1024,
                                  backupCount=2, encoding='utf-8')
            handler.setFormatter(logging.Formatter('%(message)s'))
            self.logger.addHandler(handler)
        except OSError as exc:
            print(f'WARNING: diagnostic log unavailable: {exc}', file=sys.stderr)

    def emit(self, kind, **fields):
        data = dict(version=1, event_id=str(uuid.uuid4()), session=self.session,
                    time=datetime.now(timezone.utc).isoformat(), monotonic=time.monotonic(), type=kind, **fields)
        line = json.dumps(data, ensure_ascii=True)
        self.logger.info(line)
        print(line, flush=True)


def devices():
    import sounddevice as sd
    for index, device in enumerate(sd.query_devices()):
        if device['max_input_channels'] > 0:
            print(json.dumps(dict(index=index, name=device['name'],
                  hostapi=sd.query_hostapis(device['hostapi'])['name'],
                  channels=device['max_input_channels'], default_rate=device['default_samplerate']),
                  ensure_ascii=False))


def listen(args, events):
    import numpy as np
    import psutil
    import sounddevice as sd
    config = json.loads(args.config.read_text(encoding='utf-8-sig'))
    threshold, cooldown = config['threshold'], config['cooldown_seconds']
    if not 0 < threshold <= 1 or not 0 <= cooldown <= 60:
        raise ValueError('Invalid threshold or cooldown')
    events.emit('state_changed', state='STARTING')
    model, manifest = load_model()
    device = sd.query_devices(args.device, 'input')
    hostapi = sd.query_hostapis(device['hostapi'])['name']
    if device['name'] != args.expect_name:
        raise ValueError('Device name changed. Run devices again and explicitly select the microphone.')
    rate = args.rate or int(device['default_samplerate'])
    sd.check_input_settings(device=args.device, channels=1, samplerate=rate, dtype='float32')
    frames = Frames(rate)
    gate = Gate(threshold, cooldown)
    audio_queue = queue.Queue(maxsize=10)
    dropped = [0]

    def callback(indata, count, timing, status):
        try:
            audio_queue.put_nowait((indata.copy(), time.monotonic(), str(status)))
        except queue.Full:
            dropped[0] += 1

    process = psutil.Process()
    process.cpu_percent()
    packages = {d.metadata['Name']: d.version for d in importlib.metadata.distributions()}
    events.emit('environment', python=sys.version, windows=platform.platform(), cpu=platform.processor(),
                packages=packages, models=manifest, config=config, device_index=args.device,
                device_name=device['name'], hostapi=hostapi, input_rate=rate, input_channels=1,
                input_dtype='float32', inference_format='16000 Hz mono int16 / 1280 samples',
                condition=args.condition, stage=args.stage)
    times = deque(maxlen=10000)
    total = 0
    started = last_stats = time.monotonic()
    prior_dropped = 0
    try:
        with sd.InputStream(device=args.device, channels=1, samplerate=rate, dtype='float32',
                            blocksize=round(rate * .08), callback=callback):
            events.emit('state_changed', state='LISTENING')
            while not args.seconds or time.monotonic() - started < args.seconds:
                try:
                    data, captured, status = audio_queue.get(timeout=3)
                except queue.Empty:
                    raise RuntimeError('No microphone data for 3 seconds. Check the selected device.')
                if status or dropped[0] != prior_dropped or time.monotonic() - captured > .5:
                    events.emit('audio_gap', status=status, dropped_blocks=dropped[0])
                    prior_dropped = dropped[0]
                    model.reset()
                    frames = Frames(rate)
                    while True:
                        try:
                            audio_queue.get_nowait()
                        except queue.Empty:
                            break
                    continue
                for frame in frames.feed(data):
                    before = time.perf_counter()
                    scores = model.predict(frame)
                    times.append((time.perf_counter() - before) * 1000)
                    score = float(max(scores.values()))
                    now = time.monotonic()
                    if gate.accept(score, now):
                        total += 1
                        events.emit('detected', score=score, count=total,
                                    processing_ms=times[-1], queue_age_ms=(now - captured) * 1000)
                if time.monotonic() - last_stats >= 5:
                    events.emit('metrics', elapsed_seconds=time.monotonic() - started,
                                detections=total, cpu_percent=process.cpu_percent(),
                                rss_mb=process.memory_info().rss / 1024**2,
                                inference_median_ms=float(np.median(times)) if times else None,
                                inference_p95_ms=float(np.percentile(times, 95)) if times else None,
                                dropped_blocks=dropped[0])
                    last_stats = time.monotonic()
    except KeyboardInterrupt:
        pass
    finally:
        while True:
            try:
                audio_queue.get_nowait()
            except queue.Empty:
                break
        events.emit('state_changed', state='STOPPED', detections=total,
                    elapsed_seconds=time.monotonic() - started)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('prepare', help='Download the three ONNX models; requires network')
    sub.add_parser('devices', help='List input devices without opening the microphone')
    sub.add_parser('selfcheck', help='Verify models and run silence inference; no microphone')
    run = sub.add_parser('listen', help='Explicitly start microphone capture; Ctrl+C stops')
    run.add_argument('--device', type=int, required=True)
    run.add_argument('--expect-name', required=True, help='Exact device name from devices')
    run.add_argument('--rate', type=int, help='Default is selected device native sample rate')
    run.add_argument('--seconds', type=float, default=0, help='0 means until Ctrl+C')
    run.add_argument('--condition', required=True, help='Distance and room noise')
    run.add_argument('--stage', choices=['tuning', 'evaluation'], required=True)
    run.add_argument('--config', type=Path, default=ROOT / 'config.json')
    args = parser.parse_args()
    events = None
    try:
        if args.command == 'prepare':
            prepare()
        elif args.command == 'devices':
            devices()
        elif args.command == 'selfcheck':
            import numpy as np
            model, _ = load_model()
            for _ in range(30):
                scores = model.predict(np.zeros(1280, dtype=np.int16))
                if not all(np.isfinite(s) and 0 <= s <= 1 for s in scores.values()):
                    raise ValueError('Invalid model scores')
            print('PASS: hashes, ONNX loading and 30 silence frames (no microphone).')
        else:
            if args.seconds < 0:
                raise ValueError('--seconds must be non-negative')
            events = Events()
            listen(args, events)
        return 0
    except Exception as exc:
        if events:
            events.emit('error', error_type=type(exc).__name__, message=str(exc), state='ERROR')
        print(f'{type(exc).__name__}: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
