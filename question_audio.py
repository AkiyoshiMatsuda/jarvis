"""Bounded, in-memory question input. Energy gate is not speech recognition."""
import math


class QuestionAudio:
    def __init__(self, rate=16000):
        self.rate = rate
        self.samples = 0
        self.voice_samples = 0
        self.quiet_samples = 0
        self.spoke = False
        self.chunks = []

    def feed(self, frame):
        self.chunks.append(frame.tobytes())
        count = len(frame)
        self.samples += count
        rms = math.sqrt(sum(float(x) ** 2 for x in frame) / max(count, 1)) / 32768
        if rms >= .012:
            self.voice_samples += count
            self.quiet_samples = 0
            if self.voice_samples >= self.rate * .24:
                self.spoke = True
        else:
            self.quiet_samples += count
            if not self.spoke:
                self.voice_samples = 0
        if self.samples >= self.rate * 15:
            return 'limit'
        if self.spoke and self.quiet_samples >= self.rate * 1.2:
            return 'silence'
        if not self.spoke and self.samples >= self.rate * 5:
            return 'no_speech'
        return None

    def clear(self):
        self.chunks.clear()
