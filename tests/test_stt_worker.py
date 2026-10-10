from pathlib import Path
import json
import queue
import subprocess
import sys
import threading
import time
import unittest


class SttWorkerTests(unittest.TestCase):
    def test_capture_to_transcript_and_cancel(self):
        fixture = Path(__file__).parent / 'fixtures/replay_worker.py'
        p = subprocess.Popen([sys.executable, '-u', str(fixture)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        events = queue.Queue()
        def read():
            for line in p.stdout:
                events.put(json.loads(line))
        reader = threading.Thread(target=read, daemon=True); reader.start()
        def until(predicate):
            end = time.monotonic() + 60
            while time.monotonic() < end:
                event = events.get(timeout=10)
                if predicate(event):
                    return event
            self.fail('No expected event')
        def send(kind, **fields):
            p.stdin.write((json.dumps(dict(version=1, type=kind, request_id=kind, **fields))+'\n').encode()); p.stdin.flush()
        def capture(id):
            send('capture', device={'name':'Replay','hostapi':'test'},epoch='test',capture_id=id)
        try:
            until(lambda m:m['type']=='ready')
            capture('one')
            until(lambda m:m['type']=='transcription_started')
            send('ping')
            done = until(lambda m:m['type']=='capture_done')
            self.assertIn('何', done['text'])
            self.assertEqual(done['capture_id'], 'one')
            capture('two')
            until(lambda m:m['type']=='transcription_started')
            send('pause')
            until(lambda m:m.get('request_id')=='pause' and m['type']=='ack')
            send('ping')
            until(lambda m:m['type']=='pong')
            time.sleep(.3)
            self.assertFalse(any(m['type']=='capture_done' and m.get('capture_id')=='two' for m in list(events.queue)))
            send('shutdown');self.assertEqual(p.wait(timeout=5),0)
        finally:
            if p.poll() is None:
                p.kill();p.wait(timeout=5)
            reader.join(timeout=2)
            p.stdin.close();p.stdout.close()
