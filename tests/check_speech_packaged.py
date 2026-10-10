"""Local speech and real AI integration with isolated settings, no microphone input."""
import json
import shutil
import sys
from pathlib import Path
from check_desktop import launch, reset_settings, DATA, ROOT, wait_gone


def main():
    reset_settings()
    output = Path(sys.argv[1]) if len(sys.argv)>1 else ROOT / 'validation/step-a4'
    output.mkdir(parents=True, exist_ok=True)
    (DATA / 'smoke.json').unlink(missing_ok=True)
    p = launch('--smoke-test', '--speech-test', '--answer-test')
    try:
        assert p.wait(timeout=330) == 0, 'See packaged desktop log'
        result = json.loads((DATA / 'smoke.json').read_text(encoding='utf-8'))
        for key in ('speechCompleted', 'speechPreferencesAndPreview', 'speechStopPreservesAnswer', 'speechOffAndMute',
                    'speechLockClears', 'localAnswer', 'aiAnswerSpoken', 'answerCancelAndClear'):
            assert result[key], key
        logs = (DATA / 'logs/desktop.jsonl').read_text(encoding='utf-8')
        assert '2足す3はいくつですか' not in logs
        assert result['answerText'] not in logs
        shutil.copy2(DATA / 'answer-preview.png', output / 'preview.png')
        (output / 'packaged.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        wait_gone(result['workerPid'])
        print('PASS packaged local Japanese speech, completion, stop, mute, saved off, lock, AI answer, private logs, child exit')
    finally:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=5)


if __name__ == '__main__':
    main()
