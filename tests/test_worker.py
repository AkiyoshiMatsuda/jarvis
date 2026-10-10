"""Integration checks. Set JARVIS_TEST_MIC=1 for a short real microphone test."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
COMMAND = [os.environ['JARVIS_WORKER_EXE']] if os.environ.get('JARVIS_WORKER_EXE') else [sys.executable, '-u', str(ROOT / 'jarvis_worker.py')]


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.p = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, cwd=ROOT)
        self.events = queue.Queue()
        self.errors = []
        def read():
            for line in self.p.stdout:
                self.events.put(json.loads(line))
        def errors():
            for line in self.p.stderr:
                self.errors.append(line.decode('utf-8', errors='replace'))
        self.reader = threading.Thread(target=read, daemon=True)
        self.err_reader = threading.Thread(target=errors, daemon=True)
        self.reader.start()
        self.err_reader.start()
        try:
            self.ready = self.until(lambda m: m['type'] == 'ready')
        except Exception:
            self.tearDown()
            raise

    def until(self, predicate, timeout=30):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                msg = self.events.get(timeout=min(1, end-time.monotonic()))
            except queue.Empty:
                if self.p.poll() is not None:
                    self.fail('Worker exited: ' + ''.join(self.errors))
                continue
            if predicate(msg):
                return msg
        self.fail('Timed out: ' + ''.join(self.errors))

    def request(self, kind, **fields):
        request_id = str(uuid.uuid4())
        self.p.stdin.write((json.dumps(dict(version=1, type=kind, request_id=request_id, **fields)) + '\n').encode())
        self.p.stdin.flush()
        return self.until(lambda m: m.get('request_id') == request_id)

    def tearDown(self):
        if self.p.poll() is None:
            self.p.stdin.close()
            try:
                self.p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.p.kill()
                self.p.wait(timeout=5)
        self.reader.join(timeout=2)
        self.err_reader.join(timeout=2)
        for pipe in (self.p.stdin, self.p.stdout, self.p.stderr):
            pipe.close()

    def test_pause_ping_shutdown(self):
        self.assertEqual(self.request('ping')['type'], 'pong')
        self.assertEqual(self.request('pause')['type'], 'ack')
        self.assertIsInstance(self.request('devices')['devices'], list)
        self.assertEqual(self.request('shutdown')['type'], 'ack')
        self.assertEqual(self.p.wait(timeout=5), 0)

    def test_missing_device_does_not_fallback(self):
        self.assertEqual(self.request('resume', device={'name':'missing','hostapi':'missing'}, epoch='t')['type'], 'error')
        self.assertEqual(self.request('ping')['type'], 'pong')

    def test_parent_pipe_loss_exits(self):
        self.p.stdin.close()
        self.assertEqual(self.p.wait(timeout=5), 0)

    def test_malformed_command_exits(self):
        self.p.stdin.write(b'{"type":"execute"}\n')
        self.p.stdin.flush()
        self.assertEqual(self.p.wait(timeout=5), 2)

    @unittest.skipUnless(os.environ.get('JARVIS_TEST_MIC') == '1', 'Explicit microphone test not enabled')
    def test_real_microphone_resume_pause_resume(self):
        device = next(d for d in self.ready['devices']
                      if d['name'] == 'マイク (Realtek(R) Audio)' and d['hostapi'] == 'Windows WASAPI')
        for i in range(2):
            self.assertEqual(self.request('resume', device=device, epoch=str(i))['type'], 'ack')
            time.sleep(.5)
            self.assertEqual(self.request('pause')['type'], 'ack')
        self.assertEqual(self.request('ping')['type'], 'pong')


if __name__ == '__main__':
    unittest.main()
