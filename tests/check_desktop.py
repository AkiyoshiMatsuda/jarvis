"""Packaged app integration test. Uses isolated settings and the Realtek mic briefly."""
import json
from pathlib import Path
import subprocess
import time
import psutil

ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / 'release' / 'win-unpacked' / 'JARVIS.exe'
DATA = EXE.parent / '.smoke-data'


def launch(*flags):
    info = subprocess.STARTUPINFO()
    info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    info.wShowWindow = 0
    return subprocess.Popen([str(EXE), *flags], startupinfo=info, cwd=EXE.parent)


def reset_settings():
    DATA.mkdir(exist_ok=True)
    path = DATA / 'settings.json'
    if path.exists():
        settings = json.loads(path.read_text(encoding='utf-8'))
        settings['monitoring_enabled'] = False
        path.write_text(json.dumps(settings), encoding='utf-8')


def wait_file(path, process):
    end = time.monotonic() + 60
    while time.monotonic() < end:
        if path.exists():
            return json.loads(path.read_text(encoding='utf-8'))
        if process.poll() is not None:
            raise AssertionError(f'App exited: {process.returncode}. See {DATA / "logs"}')
        time.sleep(.1)
    raise AssertionError('App readiness timed out')


def wait_gone(pid):
    try:
        psutil.Process(pid).wait(timeout=8)
    except psutil.NoSuchProcess:
        pass


def main():
    reset_settings()
    smoke_file = DATA / 'smoke.json'
    smoke_file.unlink(missing_ok=True)
    p = launch('--smoke-test', '--smoke-mic-test', '--response-test', '--phase4-test')
    try:
        assert p.wait(timeout=120) == 0, 'Packaged smoke test failed'
        result = json.loads(smoke_file.read_text())
        assert result['resumePauseRestart'] and result['closeHidesWindow'] and result['workerStillReady']
        assert result['responseCycle'] and result['stopDuringResponse']
        assert result['questionCancelAndStop']
        print('PASS question: bounded capture completion, cancel to listening, stop to paused')
        assert result['automaticRecovery'] and result['cancelRecovery'] and result['sessionStatePreserved']
        print('PASS phase4: automatic crash recovery, cancel recovery, lock/resume state preservation')
        print('PASS response: playback start/end, duplicate suppression, return to listening, stop during response')
        wait_gone(result['workerPid'])
        print('PASS packaged: microphone resume/pause, saved pause after restart, close-to-tray, normal exit')
    finally:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=10)

    hold_file = DATA / 'hold.json'
    hold_file.unlink(missing_ok=True)
    p = launch('--hold-test', '--smoke-mic-test')
    try:
        held = wait_file(hold_file, p)
        assert held['state'] == 'LISTENING'
        second = launch('--hold-test')
        assert second.wait(timeout=10) == 0
        assert p.poll() is None
        print('PASS packaged: second launch exits, first instance continues')
        p.kill()
        p.wait(timeout=10)
        wait_gone(held['worker'])
        print('PASS packaged: forced parent exit also terminates microphone worker')
    finally:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=10)
        reset_settings()


if __name__ == '__main__':
    main()
