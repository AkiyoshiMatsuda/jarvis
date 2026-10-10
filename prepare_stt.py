"""Explicit model download; never called during normal application startup."""
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent / 'models'
NAME = 'vosk-model-ja-0.22'


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def prepare(name=NAME, activate=True):
    if name not in ('vosk-model-ja-0.22', 'vosk-model-small-ja-0.22'):
        raise ValueError('Unsupported model')
    url = f'https://alphacephei.com/vosk/models/{name}.zip'
    ROOT.mkdir(exist_ok=True)
    archive = ROOT / f'{name}.zip'
    manifest = ROOT / ('stt-manifest.json' if activate else f'{name}-manifest.json')
    if manifest.exists():
        recorded = json.loads(manifest.read_text(encoding='utf-8'))
        if recorded.get('name') == name and recorded.get('files'):
            complete = True
            for relative, expected in recorded['files'].items():
                path = (ROOT / relative).resolve()
                if not path.is_relative_to((ROOT / name).resolve()):
                    raise ValueError('STT model hash mismatch')
                if not path.is_file():
                    complete = False
                elif digest(path) != expected:
                    raise ValueError('STT model hash mismatch')
            if complete:
                print('STT model verified')
                return
    if not archive.exists():
        temp = archive.with_suffix('.part')
        with urllib.request.urlopen(url, timeout=120) as response, temp.open('wb') as out:
            downloaded = 0
            while block := response.read(1024 * 1024):
                out.write(block)
                downloaded += len(block)
                if downloaded % (32 * 1024 * 1024) == 0:
                    print(f'Downloaded {downloaded // (1024 * 1024)} MiB', flush=True)
        temp.replace(archive)
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            dest = (ROOT / item.filename).resolve()
            if not dest.is_relative_to((ROOT / name).resolve()):
                raise ValueError('Unexpected model archive path')
        z.extractall(ROOT)
    files = {str(p.relative_to(ROOT)).replace('\\', '/'): digest(p)
             for p in sorted((ROOT / name).rglob('*')) if p.is_file()}
    temp_manifest = manifest.with_suffix('.tmp')
    temp_manifest.write_text(json.dumps({'name': name, 'url': url, 'license': 'Apache-2.0',
        'archive_sha256': digest(archive), 'files': files}, indent=2), encoding='utf-8')
    temp_manifest.replace(manifest)
    print('STT model prepared; file hashes recorded')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--small', action='store_true')
    parser.add_argument('--candidate', action='store_true')
    args = parser.parse_args()
    prepare('vosk-model-small-ja-0.22' if args.small else NAME, activate=not args.candidate)
