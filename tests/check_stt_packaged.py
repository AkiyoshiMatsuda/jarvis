"""Packaged STT and UI validation using synthetic audio, without microphone input."""
import json
from pathlib import Path
import shutil
import subprocess
import time
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_transcription import sample_pcm
from check_desktop import launch, reset_settings, DATA, ROOT


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'validation/step-a2'
    output.mkdir(parents=True, exist_ok=True)
    worker = ROOT / 'release/win-unpacked/resources/worker/jarvis-worker.exe'
    started = time.perf_counter()
    result = subprocess.run([str(worker), '--transcribe'], input=sample_pcm(), capture_output=True, timeout=55,
                            creationflags=subprocess.CREATE_NO_WINDOW, check=True)
    decoded = json.loads(result.stdout)
    assert 'error' not in decoded, decoded
    assert '何' in decoded['text'] and decoded['text'].startswith('はい'), decoded
    duration = time.perf_counter() - started
    reset_settings()
    p = launch('--smoke-test', '--transcript-ui-test')
    try:
        assert p.wait(timeout=60) == 0
        smoke = json.loads((DATA / 'smoke.json').read_text(encoding='utf-8'))
        assert smoke['transcriptRenderAndClear']
        assert '明日の予定を教えてください。' not in (DATA / 'logs/desktop.jsonl').read_text(encoding='utf-8')
        shutil.copy2(DATA / 'preview.png', output / 'preview.png')
    finally:
        if p.poll() is None:
            p.kill();p.wait(timeout=5)
    (output / 'packaged.json').write_text(json.dumps({'synthetic_audio':True, 'transcript':decoded['text'],
        'elapsed_seconds':duration, 'ui_render_and_clear':True, 'text_absent_from_log':True}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('PASS packaged Japanese STT, transcript rendering/clear, no transcript in diagnostic log')


if __name__ == '__main__':
    main()
