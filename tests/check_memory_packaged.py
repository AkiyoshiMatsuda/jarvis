"""Personal memory in isolated packaged settings; synthetic preferences only."""
import json
import shutil
from check_desktop import launch, reset_settings, DATA, ROOT, wait_gone


def main():
    reset_settings()
    output = ROOT / 'validation/memory'
    output.mkdir(parents=True, exist_ok=True)
    (DATA / 'smoke.json').unlink(missing_ok=True)
    p = launch('--smoke-test', '--memory-test')
    try:
        assert p.wait(timeout=90) == 0, 'See desktop log'
        result = json.loads((DATA / 'smoke.json').read_text(encoding='utf-8'))
        assert result['memoryIntegration']
        shutil.copy2(DATA / 'memory-preview.png', output / 'preview.png')
        (output / 'packaged.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        wait_gone(result['workerPid'])
        print('PASS encrypted memory, automatic extraction, personalization toggle, edits, deletion, streaming and privacy')
    finally:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=5)


if __name__ == '__main__':
    main()
