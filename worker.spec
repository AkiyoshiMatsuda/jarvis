from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs
import json
from pathlib import Path

stt_name = json.loads(Path('models/stt-manifest.json').read_text(encoding='utf-8'))['name']
if stt_name not in ('vosk-model-small-ja-0.22', 'vosk-model-ja-0.22'):
    raise ValueError('Unsupported STT model')

a = Analysis(['jarvis_worker.py'], pathex=[],
    binaries=collect_dynamic_libs('onnxruntime') + collect_dynamic_libs('soxr') + collect_dynamic_libs('vosk'),
    datas=[('models/*.onnx', 'models'), ('models/manifest.json', 'models')]
          + [(f'models/{stt_name}', f'models/{stt_name}'), ('models/stt-manifest.json', 'models')]
          + collect_data_files('openwakeword') + collect_data_files('_sounddevice_data'),
    hiddenimports=['sounddevice', 'soxr', 'onnxruntime'],
    excludes=['tkinter', 'matplotlib', 'IPython', 'pytest'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='jarvis-worker', console=True)
coll = COLLECT(exe, a.binaries, a.datas, name='jarvis-worker')
