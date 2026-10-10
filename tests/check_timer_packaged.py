"""Timer and audio sequencing, plus brief Realtek microphone pause/resume checks."""
import json
import shutil
from check_desktop import launch, reset_settings, DATA, ROOT, wait_gone


def main():
    reset_settings()
    output = ROOT / 'validation/timer'
    output.mkdir(parents=True, exist_ok=True)
    (DATA / 'smoke.json').unlink(missing_ok=True)
    p = launch('--smoke-test', '--timer-test', '--smoke-mic-test')
    try:
        assert p.wait(timeout=90) == 0, 'See packaged desktop log'
        result = json.loads((DATA / 'smoke.json').read_text(encoding='utf-8'))
        for key in ('timerCommands', 'timerDoesNotInterruptAnswer', 'timerAlarmAfterAnswer', 'timerLockDeferred', 'timerMute',
                    'timerDefersDuringSpeech', 'timerMicResumes', 'timerStopPreservesPause', 'timerRepeats','timerRepeatStops'):
            assert result[key], key
        shutil.copy2(DATA / 'timer-preview.png', output / 'preview.png')
        (output / 'packaged.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        wait_gone(result['workerPid'])
        print('PASS timer commands without LLM, independent countdown, deferred alarm, real audio, lock, mute, child exit')
    finally:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=5)


if __name__ == '__main__':
    main()
