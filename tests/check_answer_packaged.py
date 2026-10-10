"""Real local model and renderer IPC; no microphone needed."""
import json
import shutil
from check_desktop import launch, reset_settings, DATA, ROOT


def main():
    reset_settings()
    output = ROOT / 'validation/step-a3'
    output.mkdir(parents=True, exist_ok=True)
    p = launch('--smoke-test', '--answer-test')
    try:
        assert p.wait(timeout=150) == 0, 'See packaged desktop log'
        result = json.loads((DATA / 'smoke.json').read_text(encoding='utf-8'))
        assert result['localAnswer'] and result['answerCancelAndClear']
        logs = (DATA / 'logs/desktop.jsonl').read_text(encoding='utf-8')
        assert '2足す3はいくつですか' not in logs
        assert result['answerText'] not in logs
        shutil.copy2(DATA / 'answer-preview.png', output / 'preview.png')
        (output / 'packaged.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print('PASS packaged local AI answer, rendering, cancellation, clear, paused microphone, private logs')
    finally:
        if p.poll() is None:
            p.kill();p.wait(timeout=5)


if __name__ == '__main__':
    main()
