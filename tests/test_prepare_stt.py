import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import prepare_stt


class PrepareSttTests(unittest.TestCase):
    def test_manifest_without_model_extracts_cached_archive(self):
        # A fresh checkout includes the manifest, but ignores the model files.
        with tempfile.TemporaryDirectory() as temp, patch.object(prepare_stt.urllib.request, 'urlopen') as network:
            root = Path(temp)
            name = prepare_stt.NAME
            relative = f'{name}/model.dat'
            (root / 'stt-manifest.json').write_text(json.dumps({'name': name, 'files': {
                relative: hashlib.sha256(b'model').hexdigest()}}), encoding='utf-8')
            with zipfile.ZipFile(root / f'{name}.zip', 'w') as archive:
                archive.writestr(relative, b'model')
            with patch.object(prepare_stt, 'ROOT', root):
                prepare_stt.prepare()
                self.assertEqual((root / relative).read_bytes(), b'model')
                prepare_stt.prepare()
                (root / relative).write_bytes(b'changed')
                with self.assertRaises(ValueError):
                    prepare_stt.prepare()
            network.assert_not_called()

    def test_candidate_keeps_active_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            name = prepare_stt.NAME
            active = root / 'stt-manifest.json'
            active.write_text('active manifest', encoding='utf-8')
            with zipfile.ZipFile(root / f'{name}.zip', 'w') as archive:
                archive.writestr(f'{name}/model.dat', b'model')
            with patch.object(prepare_stt, 'ROOT', root):
                prepare_stt.prepare(activate=False)
            self.assertEqual(active.read_text(encoding='utf-8'), 'active manifest')
            self.assertTrue((root / f'{name}-manifest.json').is_file())
