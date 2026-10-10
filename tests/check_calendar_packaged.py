"""Packaged calendar UI/integration with synthetic API data, no Google account."""
import json
import shutil
from check_desktop import launch, reset_settings, DATA, ROOT, wait_gone


def main():
    reset_settings()
    output = ROOT / 'validation/calendar'
    output.mkdir(parents=True, exist_ok=True)
    (DATA / 'smoke.json').unlink(missing_ok=True)
    p = launch('--smoke-test', '--calendar-test')
    try:
        assert p.wait(timeout=90) == 0, 'See packaged desktop log'
        result = json.loads((DATA / 'smoke.json').read_text(encoding='utf-8'))
        for key in ('calendarNotConnected', 'calendarPeriods', 'extendedCalendarPeriods', 'calendarCancelAndTimer', 'calendarPrivate'):
            assert result[key], key
        shutil.copy2(DATA / 'calendar-preview.png', output / 'preview.png')
        (output / 'packaged.json').write_text(json.dumps({'synthetic_google_data': True, **result}, ensure_ascii=False, indent=2), encoding='utf-8')
        wait_gone(result['workerPid'])
        print('PASS packaged calendar periods, missing account, cancellation, timer independence, encrypted storage, no agenda in logs/history')
    finally:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=5)


if __name__ == '__main__':
    main()
