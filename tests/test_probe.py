import unittest
import numpy as np
from jarvis_probe import Frames, Gate


class ProbeTests(unittest.TestCase):
    def test_continuous_high_score_does_not_repeat(self):
        gate = Gate(.5, 2)
        self.assertTrue(gate.accept(.8, 10))
        self.assertFalse(gate.accept(.8, 13))
        self.assertFalse(gate.accept(.1, 13.1))
        self.assertTrue(gate.accept(.8, 13.2))

    def test_cooldown(self):
        gate = Gate(.5, 2)
        self.assertTrue(gate.accept(.8, 10))
        gate.accept(.1, 10.1)
        self.assertFalse(gate.accept(.8, 11))
        self.assertTrue(gate.accept(.8, 12))

    def test_pcm_clips_without_integer_wrap(self):
        frame = next(Frames(16000).feed(np.full((1280, 1), 2, dtype=np.float32)))
        self.assertEqual(frame.dtype, np.int16)
        self.assertTrue(np.all(frame == 32767))

    def test_streaming_conversion(self):
        for rate in (16000, 44100, 48000):
            frames = Frames(rate)
            result = []
            for _ in range(100):
                result.extend(frames.feed(np.zeros((round(rate * .08), 1), dtype=np.float32)))
            self.assertTrue(98 <= len(result) <= 100)
            self.assertTrue(all(len(f) == 1280 and np.all(f == 0) for f in result))
            self.assertLess(len(frames.pending), 1280)


if __name__ == '__main__':
    unittest.main()
