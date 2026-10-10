"""Packaged weather routing/cancellation with synthetic forecast data."""
import json
import shutil
from check_desktop import launch, reset_settings, DATA, ROOT, wait_gone


def main():
    reset_settings()
    output = ROOT / 'validation/weather'
    output.mkdir(parents=True, exist_ok=True)
    (DATA / 'smoke.json').unlink(missing_ok=True)
    p = launch('--smoke-test', '--weather-test')
    try:
        assert p.wait(timeout=90) == 0, 'See packaged desktop log'
        result = json.loads((DATA / 'smoke.json').read_text(encoding='utf-8'))
        for key in ('weatherUnset', 'weatherPeriods', 'weatherCancelAndTimer', 'weatherFailureAndClear', 'weatherPrivate'):
            assert result[key], key
        shutil.copy2(DATA / 'weather-preview.png', output / 'preview.png')
        (output / 'packaged.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        wait_gone(result['workerPid'])
        print('PASS packaged weather periods, missing region, cancellation, timer independence, failure, privacy')
    finally:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=5)


if __name__ == '__main__':
    main()
