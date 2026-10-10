# Phase 2 — 常駐・プロセス管理・初期パッケージ

実装日: 2026-10-08。Phase 1の基本発話検出はユーザーが確認済み。
数値による精度・誤起動・遅延の受け入れ判定は未完了のまま、ユーザーの指示でPhase 2に進んだ。

## 実装

- Electronメイン + React/Viteの最小画面。トレイ常駐、単一起動、閉じる操作で非表示。
- 明示的なマイク選択、開始・停止、選択・監視設定の原子的保存。
- マイク名とホストAPIで再解決し、未接続・曖昧な同名デバイスでは取得しない。
  永続的なデバイス固有IDではないため、同名機器の入れ替わりまでは識別できない。
- JSON Linesで `ready` / `ack` / `state_changed` / `detected` / `error` / `pong`。
  要求は `pause` / `resume` / `shutdown` / `ping`、一覧更新用に `devices` を追加。
- 起動待ち30秒、命令応答10秒、ping間隔5秒・応答待ち5秒、終了命令待ち2秒。
  終了命令後はstdinを閉じ、1.5秒後も終了しなければプロセスツリーを強制終了する。
- 子の異常終了・応答停止をERRORにして手動再試行。再起動時は監視設定を再確認。
- 古い子・停止前の検出をプロセス参照と監視世代IDで除外。
- stdin切断時に子が自分を終了し、親の強制終了時にも音声取得を残さない。
  Windowsでブロッキングstdin読み込みとNumPy DLL初期化が競合したため、
  非ブロッキングパイプ読み込みに変更して起動・切断試験を行った。
- ロック・スリープイベントで停止する最低限の接続も追加。
  OS復帰を含めた繰り返し実機評価と有限回自動復旧はPhase 4に残す。
- rendererはNodeアクセスなし、contextIsolation / sandbox有効、CSP・外部遷移拒否。
- PyInstallerのPython・ONNX・モデル同梱ワーカーとElectronをフォルダー形式に梱包。

## 検証コマンド（cmd、D:\Jarvis）

```bat
cd /d D:\Jarvis
npm test
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

実マイクの統合テストを明示的に行う場合（Realtek/WASAPIを短時間取得）:

```bat
set JARVIS_TEST_MIC=1
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_worker.py -v
set JARVIS_TEST_MIC=
```

同梱アプリのテスト（別設定で非表示起動し、実マイクと強制終了を検証）:

```bat
.\.venv\Scripts\python.exe tests\check_desktop.py
```

## 開発と再構築（cmd）

日常の起動には不要です。コードを変更した場合のみ実行します。
初回の依存関係・モデル取得にはネットワークが必要です。

```bat
cd /d D:\Jarvis
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-build.lock.txt
.\.venv\Scripts\python.exe jarvis_probe.py prepare
.\.venv\Scripts\python.exe prepare_stt.py
npm ci
npm run package
```

開発版の起動は `npm start`。ビルド済み同梱版は `start-jarvis.cmd`。
依存関係は `package-lock.json` と `requirements-build.lock.txt` で固定する。

## 残る作業

- Phase 1の数値評価、発話に対するデスクトップ版の検出確認。
- Phase 3: 呼びかけ時の画面表示・固定TTS・再反応抑止・表示遅延測定。
- Phase 4: ログイン起動、有限回自動復旧、スリープ・ロック反復試験、8時間試験。
- ネット切断下の実機評価、開発ツール未導入の別PCでの依存関係確認。
- 一般配布用のインストーラー・署名・モデルのライセンス条件整理。

別PCの動作保証やMVP全体の完了は、このPhaseの完了に含めない。
