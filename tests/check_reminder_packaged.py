"""Synthetic calendar reminders and settings navigation; no Google account."""
import json
import shutil
from check_desktop import launch, reset_settings, DATA, ROOT, wait_gone


def main():
    reset_settings()
    output = ROOT / 'validation/reminders'
    output.mkdir(parents=True, exist_ok=True)
    (DATA / 'smoke.json').unlink(missing_ok=True)
    p = launch('--smoke-test', '--reminder-test')
    try:
        assert p.wait(timeout=90) == 0, 'See packaged desktop log'
        result = json.loads((DATA / 'smoke.json').read_text(encoding='utf-8'))
        assert result['remindersAndSettings']
        for name in ('settings-preview.png', 'home-preview.png'):
            shutil.copy2(DATA / name, output / name)
        (output / 'packaged.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        wait_gone(result['workerPid'])
        print('PASS reminders, timer independence, dismissal, privacy, settings navigation and persistence')
    finally:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=5)


if __name__ == '__main__':
    main()
