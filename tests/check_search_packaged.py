"""Search UI/routing integration with synthetic API data, no paid requests."""
import json
import shutil
from check_desktop import launch, reset_settings, DATA, ROOT, wait_gone


def main():
    reset_settings()
    output = ROOT / 'validation/search'
    output.mkdir(parents=True, exist_ok=True)
    (DATA / 'smoke.json').unlink(missing_ok=True)
    p = launch('--smoke-test', '--search-test')
    try:
        assert p.wait(timeout=90) == 0, 'See packaged desktop log'
        result = json.loads((DATA / 'smoke.json').read_text(encoding='utf-8'))
        assert result['searchIntegration']
        shutil.copy2(DATA / 'search-preview.png', output / 'preview.png')
        (output / 'packaged.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        wait_gone(result['workerPid'])
        print('PASS search routing, no API key, citations, cancellation, timer independence, settings and privacy')
    finally:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=5)


if __name__ == '__main__':
    main()
