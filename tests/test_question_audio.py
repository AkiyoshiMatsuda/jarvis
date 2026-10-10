import unittest
from array import array
from question_audio import QuestionAudio


class QuestionTests(unittest.TestCase):
    def feed(self, question, amplitude, seconds):
        result = None
        for _ in range(round(seconds / .08)):
            result = question.feed(array('h', [amplitude] * 1280))
            if result:
                break
        return result

    def test_no_speech_discards_memory(self):
        q = QuestionAudio()
        self.assertEqual(self.feed(q, 0, 6), 'no_speech')
        self.assertLessEqual(q.samples, 81280)
        q.clear()
        self.assertEqual(q.chunks, [])

    def test_speech_then_silence(self):
        q = QuestionAudio()
        self.assertIsNone(self.feed(q, 1000, .4))
        self.assertEqual(self.feed(q, 0, 1.2), 'silence')

    def test_noise_is_bounded(self):
        q = QuestionAudio()
        self.assertEqual(self.feed(q, 1000, 16), 'limit')
        self.assertLessEqual(q.samples, 241280)

    def test_short_click_not_speech(self):
        q = QuestionAudio()
        self.feed(q, 2000, .08)
        self.assertEqual(self.feed(q, 0, 6), 'no_speech')


if __name__ == '__main__':
    unittest.main()
