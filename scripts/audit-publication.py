"""Read-only publication audit. Reports paths/categories, never matching values.

Without a repository, evaluates .gitignore through an isolated temporary Git dir.
Does not stage, commit, push, or claim to audit all historical commits.
"""
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def audit():
    base = ROOT / 'validation'
    base.mkdir(exist_ok=True)
    findings = []
    reviewed = []
    with tempfile.TemporaryDirectory(prefix='publication-', dir=base) as temp:
        assert Path(temp).resolve().is_relative_to(base.resolve())
        actual = (ROOT / '.git').exists()
        command = ['git', '-C', str(ROOT)]
        if not actual:
            subprocess.run(['git', 'init', '--bare', '--quiet', temp], check=True)
            command = ['git', f'--git-dir={temp}', f'--work-tree={ROOT}']
        def git(*args):
            return subprocess.check_output([*command, *args], cwd=ROOT)
        files = sorted(set(x.decode('utf-8') for x in git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split(b'\0') if x))
        patterns = {
            'private_key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
            'github_token': r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})',
            'google_api_key': r'\bAIza[A-Za-z0-9_-]{30,}',
            'google_oauth_secret': r'\bGOCSPX-[A-Za-z0-9_-]{15,}',
            'aws_key': r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
            'embedded_token': r'''["'](?:refresh_token|access_token|client_secret|api_key)["']\s*:\s*["'][A-Za-z0-9_./+=-]{25,}["']''',
            'personal_windows_path': r'[A-Za-z]:\\Users\\(?!Public\b|Default\b)[A-Za-z0-9_.-]+',
            'email_address': r'\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org)|localhost)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
        }
        for relative in files:
            file = ROOT / relative
            if file.is_symlink():
                findings.append({'path': relative, 'category': 'symlink_requires_review'})
                continue
            if not file.is_file():
                continue
            if file.stat().st_size > 10 * 1024 * 1024:
                findings.append({'path': relative, 'category': 'large_file'})
                continue
            raw = file.read_bytes()
            if b'\0' in raw:
                findings.append({'path': relative, 'category': 'binary_requires_review'})
                continue
            text = raw.decode('utf-8-sig', errors='replace')
            for category, pattern in patterns.items():
                for match in re.finditer(pattern, text):
                    # Published npm deprecation notice, not the user's contact details.
                    line = text.splitlines()[text[:match.start()].count('\n')]
                    if category == 'email_address' and relative == 'package-lock.json' and '"deprecated":' in line and 'Old versions of glob' in line:
                        reviewed.append({'path': relative, 'category': 'public_dependency_deprecation_contact'})
                        continue
                    findings.append({'path': relative, 'line': text[:match.start()].count('\n') + 1, 'category': category})
        probes = ['.env', 'credentials.json', 'client_secret_123.json', 'oauth-client.json', 'service-account.json',
                  'google-calendar.enc', 'settings.json', 'logs/desktop.jsonl', 'validation/sample.wav',
                  'release/win-unpacked/JARVIS.exe', 'models/private-model.zip', 'ui/public/response.wav',
                  'ui/public/response.json', '.venv/secret', 'node_modules/secret']
        checked = subprocess.run([*command, 'check-ignore', '--no-index', '--stdin', '-z'],
                                 input=b'\0'.join(p.encode() for p in probes)+b'\0', capture_output=True, cwd=ROOT)
        if checked.returncode not in (0, 1):
            raise RuntimeError('Git ignore verification failed')
        ignored = set(checked.stdout.decode().strip('\0').split('\0'))
        for probe in probes:
            if probe not in ignored: findings.append({'path': probe, 'category': 'ignore_rule_missing'})
        if actual:
            for relative in git('ls-files', '--cached', '--ignored', '--exclude-standard', '-z').decode().split('\0'):
                if relative: findings.append({'path': relative, 'category': 'ignored_but_tracked'})
        result = {'actual_repository': actual, 'history_audited': False, 'candidate_files': len(files),
                  'ignore_probes': len(probes), 'findings': findings, 'reviewed': reviewed, 'files': files}
        (base / 'publication-audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({k:v for k,v in result.items() if k!='files'}, ensure_ascii=True, indent=2))
        return bool(findings)


if __name__ == '__main__':
    raise SystemExit(audit())
