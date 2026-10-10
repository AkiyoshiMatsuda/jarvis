"""Supervised JSON Lines worker. stdin EOF terminates even during stalled inference."""
import contextlib
import json
import os
import queue
import sys
import threading
import time
import uuid

from jarvis_probe import Frames, Gate, load_model
from question_audio import QuestionAudio
from transcription import TranscriptionJob, child_main

MAX_LINE = 8192


class DeviceUnavailable(RuntimeError):
    pass


def emit(kind, **fields):
    print(json.dumps(dict(version=1, type=kind, event_id=str(uuid.uuid4()), **fields)), flush=True)


def read_commands(commands):
    try:
        # A blocking CRT stdin read can deadlock NumPy DLL initialization on
        # Windows. Poll a nonblocking pipe; never hold its CRT lock across imports.
        fd = sys.stdin.fileno()
        os.set_blocking(fd, False)
        pending = b''
        while True:
            try:
                chunk = os.read(fd, 4096)
            except BlockingIOError:
                time.sleep(.02)
                continue
            except OSError as exc:
                if getattr(exc, 'winerror', None) == 232:
                    time.sleep(.02)
                    continue
                raise
            if not chunk:
                os._exit(0)  # Parent disappeared: OS closes all audio/process handles.
            pending += chunk
            while b'\n' in pending:
                raw, pending = pending.split(b'\n', 1)
                if len(raw) > MAX_LINE:
                    os._exit(2)
                obj = json.loads(raw)
                if (not isinstance(obj, dict) or obj.get('version') != 1
                        or obj.get('type') not in ('pause', 'resume', 'capture', 'shutdown', 'ping', 'devices')
                        or not isinstance(obj.get('request_id'), str) or not 1 <= len(obj['request_id']) <= 100):
                    os._exit(2)
                commands.put_nowait(obj)
            if len(pending) > MAX_LINE:
                os._exit(2)
    except Exception as exc:
        print(f'Protocol input rejected: {exc}', file=sys.stderr, flush=True)
        os._exit(2)


def input_devices(sd):
    return [dict(index=i, name=d['name'], hostapi=sd.query_hostapis(d['hostapi'])['name'],
                 rate=int(d['default_samplerate']))
            for i, d in enumerate(sd.query_devices()) if d['max_input_channels'] > 0]


def main():
    commands = queue.Queue(maxsize=32)
    if '--selfcheck' not in sys.argv:
        threading.Thread(target=read_commands, args=(commands,), daemon=True).start()
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import sounddevice as sd
        model, manifest = load_model()
    if '--selfcheck' in sys.argv:
        for _ in range(30):
            model.predict(np.zeros(1280, dtype=np.int16))
        emit('selfcheck', ok=True, models=manifest)
        return

    audio = queue.Queue(maxsize=10)
    stream = None
    frames = gate = None
    epoch = None
    question = None
    capture_id = None
    capture_deadline = 0
    transcription_job = None
    transcription_meta = None
    dropped = [0]
    last_audio = time.monotonic()

    def stop():
        nonlocal stream, frames, gate, epoch, question, capture_id, transcription_job, transcription_meta
        if transcription_job is not None:
            transcription_job.cancel()
        transcription_job = transcription_meta = None
        if question is not None:
            question.clear()
        question = capture_id = None
        if stream is not None:
            try:
                stream.abort()
            finally:
                stream.close()
                stream = None
        while True:
            try:
                audio.get_nowait()
            except queue.Empty:
                break
        frames = gate = epoch = None
        model.reset()

    def finish_question(reason):
        nonlocal transcription_job, transcription_meta
        meta = dict(capture_id=capture_id, reason=reason, duration=question.samples / question.rate)
        pcm = b''.join(question.chunks) if question.spoke and reason in ('silence', 'limit') else None
        stop()
        if pcm:
            emit('transcription_started', **meta)
            try:
                transcription_job = TranscriptionJob(pcm)
                transcription_meta = meta
            except Exception:
                emit('capture_done', **meta, error='文字起こしを開始できませんでした。再度お試しください。')
        else:
            emit('capture_done', **meta)

    def callback(data, count, timing, status):
        try:
            audio.put_nowait((data.copy(), time.monotonic(), bool(status)))
        except queue.Full:
            dropped[0] += 1

    emit('ready', devices=input_devices(sd), pid=os.getpid(), models=manifest)
    emit('state_changed', state='PAUSED')
    try:
        while True:
            try:
                cmd = commands.get(timeout=0 if stream else .1)
            except queue.Empty:
                cmd = None
            if cmd:
                request_id = cmd['request_id']
                kind = cmd['type']
                try:
                    if kind == 'ping':
                        emit('pong', request_id=request_id)
                    elif kind == 'devices':
                        if stream:
                            raise ValueError('Pause before refreshing microphones')
                        sd._terminate()
                        sd._initialize()
                        emit('ack', request_id=request_id, devices=input_devices(sd))
                    elif kind in ('pause', 'shutdown'):
                        stop()
                        emit('state_changed', state='STOPPING' if kind == 'shutdown' else 'PAUSED')
                        emit('ack', request_id=request_id)
                        if kind == 'shutdown':
                            return
                    elif kind in ('resume', 'capture'):
                        stop()
                        selected = cmd.get('device', {})
                        matches = [d for d in input_devices(sd)
                                   if d['name'] == selected.get('name') and d['hostapi'] == selected.get('hostapi')]
                        if not matches:
                            raise DeviceUnavailable('Selected microphone is missing. Reconnect the same microphone.')
                        if len(matches) > 1:
                            raise ValueError('Selected microphone is ambiguous; select it again.')
                        threshold = cmd.get('threshold', .5)
                        cooldown = cmd.get('cooldown', 2)
                        if (not isinstance(threshold, (int, float)) or not 0 < threshold <= 1
                                or not isinstance(cooldown, (int, float)) or not 0 <= cooldown <= 60
                                or not isinstance(cmd.get('epoch'), str)):
                            raise ValueError('Invalid detection settings')
                        device = matches[0]
                        rate = device['rate']
                        sd.check_input_settings(device=device['index'], channels=1, samplerate=rate, dtype='float32')
                        frames, gate = Frames(rate), Gate(threshold, cooldown)
                        epoch = cmd['epoch']
                        if kind == 'capture':
                            capture_id = cmd.get('capture_id')
                            if not isinstance(capture_id, str) or not 1 <= len(capture_id) <= 100:
                                raise ValueError('Invalid capture ID')
                            question = QuestionAudio()
                        stream = sd.InputStream(device=device['index'], channels=1, samplerate=rate,
                                               dtype='float32', blocksize=round(rate * .08), callback=callback)
                        stream.start()
                        last_audio = time.monotonic()
                        if question is not None:
                            capture_deadline = last_audio + 15
                        emit('state_changed', state='CAPTURING' if question else 'LISTENING', epoch=epoch)
                        emit('ack', request_id=request_id)
                except Exception as exc:
                    stop()
                    recoverable = isinstance(exc, (DeviceUnavailable, sd.PortAudioError)) and not any(
                        word in str(exc).lower() for word in ('permission', 'denied', 'invalid sample rate', 'invalid number of channels'))
                    emit('error', request_id=request_id, message=str(exc), error_type=type(exc).__name__, recoverable=recoverable)
                continue
            if not stream:
                if transcription_job is not None:
                    result = transcription_job.poll()
                    if result is not None:
                        emit('capture_done', **transcription_meta, **result)
                        transcription_job = transcription_meta = None
                continue
            if question is not None and time.monotonic() >= capture_deadline:
                finish_question('limit')
                continue
            try:
                data, captured, gap = audio.get(timeout=.08)
            except queue.Empty:
                if time.monotonic() - last_audio > 3:
                    stop()
                    emit('error', message='Microphone data stopped. Reconnect and retry.', error_type='AudioTimeout', recoverable=True)
                continue
            last_audio = time.monotonic()
            if gap or dropped[0] or last_audio - captured > .5:
                emit('audio_gap', dropped=dropped[0])
                dropped[0] = 0
                if question is not None:
                    completed_id = capture_id
                    stop()
                    emit('capture_done', capture_id=completed_id, reason='audio_gap', duration=0)
                    continue
                model.reset()
                frames = Frames(rate)
                while not audio.empty():
                    audio.get_nowait()
                continue
            for frame in frames.feed(data):
                if question is not None:
                    reason = question.feed(frame)
                    if reason:
                        finish_question(reason)
                        break
                    continue
                before = time.perf_counter()
                score = float(max(model.predict(frame).values()))
                if gate.accept(score, time.monotonic()):
                    emit('detected', epoch=epoch, score=score,
                         processing_ms=(time.perf_counter() - before) * 1000)
    finally:
        stop()


if __name__ == '__main__':
    if '--transcribe' in sys.argv:
        child_main()
        sys.exit(0)
    try:
        main()
    except Exception as exc:
        emit('error', message=str(exc), error_type=type(exc).__name__,
             recoverable=not isinstance(exc, (FileNotFoundError, ValueError, ImportError)))
        sys.exit(1)
