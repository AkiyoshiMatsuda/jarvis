"""Real two-turn local AI, renderer and lifecycle checks; no microphone input."""
import json
import shutil
import sys
from check_desktop import launch, reset_settings, DATA, ROOT, wait_gone


def main():
    reset_settings()
    output = ROOT / (sys.argv[1] if len(sys.argv)>1 else 'validation/step-a5')
    output.mkdir(parents=True, exist_ok=True)
    (DATA / 'smoke.json').unlink(missing_ok=True)
    p = launch('--smoke-test', '--conversation-test', '--speech-test', '--answer-test')
    try:
        assert p.wait(timeout=400) == 0, 'See packaged desktop log'
        result = json.loads((DATA / 'smoke.json').read_text(encoding='utf-8'))
        for key in ('followUpContext', 'newConversationClears', 'resetDuringGeneration', 'lockClearsHistory', 'idleExpiry',
                    'speechCompleted', 'speechStopPreservesAnswer', 'speechOffAndMute', 'speechLockClears', 'aiAnswerSpoken'):
            assert result[key], key
        for file in (DATA / 'settings.json', DATA / 'logs/desktop.jsonl'):
            if file.exists():
                assert 'マンゴー' not in file.read_text(encoding='utf-8'), 'Conversation leaked to persistent data'
        shutil.copy2(DATA / 'conversation-preview.png', output / 'preview.png')
        (output / 'packaged.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        wait_gone(result['workerPid'])
        print('PASS packaged two-turn local conversation, reset, cancellation, lock, idle expiry, speech regression, private logs/settings, child exit')
    finally:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=5)


if __name__ == '__main__':
    main()
