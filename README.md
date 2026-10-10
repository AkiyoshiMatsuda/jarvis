# JARVIS — ローカル音声アシスタント

## まずはアプリを起動する（会話・タイマー・Googleカレンダー・天気予報対応 / cmd）

コマンドプロンプトを開き、次の2行を順番に実行してください。

マイク・音声・自動起動・カレンダー・天気の設定は右上の「設定」にまとめています。[予定の事前通知](docs/calendar-reminders.md) は「設定 → カレンダー・通知」で有効にできます。

```bat
cd /d D:\Jarvis
start-jarvis.cmd
```

`D:\Jarvis\start-jarvis.cmd` をエクスプローラーでダブルクリックしても起動できます。
Python仮想環境の有効化や開発サーバーの起動は不要です。

1. 初回は監視停止の状態で開きます。「使用するマイク」から自分のマイクを選びます。
   例: `マイク (Realtek(R) Audio) — Windows WASAPI`。名前の付いた実デバイスを選んでください。
2. 「監視を開始」を押し、「呼びかけを待っています」と表示されるまで待ちます。
3. 「Hey Jarvis」と発話すると画面が表示され、「はい、何でしょう？」と応答します。
   返事の後に「質問を聞いています」と表示されます。無音または最大15秒で待機に戻ります。
   発話を検出した場合はPC内で日本語を文字起こしし、ローカルAIの回答を表示・読み上げします。
   声を使えない場合は「文字で質問する」から質問できます。マイクの開始は不要です。
   「質問入力を開始」でも開始でき、「入力を取り消す」で待機へ戻れます。
   音量は「応答音量」で変更できます（次の応答から反映）。
   「AIの回答を読み上げる」でオン・オフを保存できます。消音時は文字表示のみです。
   「読み上げを停止」では回答文を残して音声を止めます。
   続けて質問すると直前の会話を引き継ぎます。「新しい会話」で履歴をリセットできます。
   音声で続ける場合は監視中に「続けて話す」を押すか、再び「Hey Jarvis」と呼びかけてください。
4. 「監視を停止」でマイクを解放します。停止状態は次回起動にも引き継がれます。
5. ×で閉じると画面だけが隠れます。画面右下のトレイ（隠れていれば「^」）の
   JARVISアイコンをダブルクリックすると再表示します。右クリックから停止・再開・終了もできます。
6. 完全に終了するには、画面またはトレイの「終了」を選びます。

監視を有効にしたまま終了すると、次回起動時も選んだマイクで監視します。
ログイン時に起動したい場合は、画面の「Windowsログイン時に自動起動」をオンにしてください。
応答中に「監視を停止」を押すと再生も停止し、監視は再開しません。
応答音はWindows音声合成で生成した固定音声を同梱しているため、通常動作にネット接続は不要です。
音声応答中はマイクを停止します。固定の返事が終わったら質問の受付を開始し、AIの読み上げ・アラート後は700 ms待って監視を再開します。
画面表示では入力フォーカスを奪わず、タスクバー点滅も使用します。全画面アプリの上に表示できるとは限りません。
Phase 1のコマンド版を使用中の場合は、Ctrl+Cで終了してからアプリを使ってください。

実行ファイル: `release\win-unpacked\JARVIS.exe`。
移動する場合は `win-unpacked` フォルダーを丸ごとコピーしてください。exe単体では動作しません。
設定は `%APPDATA%\jarvis-local\settings.json`、診断ログは同じ場所の `logs` に保存します。
設定が破損した場合は監視を停止して案内します。異常時は「再試行」で音声プロセスを再起動できます。
マイク切断・音声プロセス異常では最大5回自動復旧を試みます。上限後は「再試行」を押してください。
復旧中でも「監視を停止」で再試行を取り消せます。ロック中やスリープ中は監視を停止します。

開発・再ビルド手順と検証範囲は [Phase 2の記録](docs/phase2.md) を参照してください。
音声応答の仕組み・検証範囲は [Phase 3の記録](docs/phase3.md) を参照してください。
自動起動・復旧と残りの実機評価は [Phase 4の記録](docs/phase4.md) を参照してください。
質問入力と自動起動の修正・確認手順は [Step A-1の記録](docs/step-a1.md) を参照してください。
日本語のローカル文字起こしは [Step A-2の記録](docs/step-a2.md) を参照してください。
日本語の回答読み上げとテスト方法は [Step A-4の記録](docs/step-a4.md) を参照してください。
会話の継続・消去・保持上限は [Step A-5の記録](docs/step-a5.md) を参照してください。
「3分測って」で開始できるタイマーの操作は [タイマー機能](docs/timer.md) を参照してください。
地域を選んで「今日の天気」「明日は雨？」と聞く操作は [天気予報機能](docs/weather.md) を参照してください。天気の取得にはインターネット接続が必要です。
音声受付・Ollamaの自動起動・反復アラートの修正は [修正記録](docs/audio-ollama-alert-fix.md) を参照してください。
時間指定の音声認識モデルの更新と検証結果は [音声認識の改善](docs/stt-number-improvement.md) を参照してください。
Googleカレンダーの初回接続と「今日・明日・今週の予定」は [設定手順](docs/google-calendar.md) を参照してください。
GitHubへの公開対象の整理は [Git公開前のファイル整理](docs/git-publication.md) を参照してください。
声・速度・試聴と日時の読み方は [読み上げ改善](docs/speech-improvement.md) を参照してください。
ローカルAIの回答・文字入力・Ollamaの準備は [Step A-3の記録](docs/step-a3.md) を参照してください。

## GitHubから取得して初めてビルドする場合（cmd）

Windows、日本語のWindows音声、Node.js/npm、Python 3.14が必要です。
ソースにはモデル本体・生成音声・実行ファイルを含めません。初回はダウンロードが必要です。

```bat
cd /d D:\Jarvis
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-build.lock.txt
npm ci
.venv\Scripts\python.exe jarvis_probe.py prepare
.venv\Scripts\python.exe prepare_stt.py
npm run package
start-jarvis.cmd
```

固定応答はビルド中に自動生成します。Pythonの音声テストを先に実行する場合は、`npm run prepare:response` で生成してください。
内部でWindows PowerShellを使いますが、上記の操作はすべてcmdから実行できます。
Ollamaは別途 [Step A-3](docs/step-a3.md)、Google接続は [設定手順](docs/google-calendar.md) を参照してください。
再配布条件は [外部コンポーネント](THIRD_PARTY_NOTICES.md) を参照してください。

## Phase 1 — コマンドで音声検出を測定する

「Hey Jarvis」をローカルで検出して、ターミナルに `detected` イベントを表示します。
以下は計画書のPhase 1用コマンドです。デスクトップアプリとは別に起動します。

## 実行（コマンドプロンプト / cmd）

この環境では `.venv`、依存ライブラリ、モデルを配置済みです。

コマンドプロンプト（cmd）を開き、以下を順番に1行ずつ実行してください。

① 作業ディレクトリへ移動します。`/d` によりCドライブからでもDドライブへ移動できます。

```bat
cd /d D:\Jarvis
```

② モデルの動作を確認します。`PASS:` が出たら次へ進みます。

```bat
.\.venv\Scripts\python.exe jarvis_probe.py selfcheck
```

③ マイクの番号（`index`）と名前（`name`）を確認します。

```bat
.\.venv\Scripts\python.exe jarvis_probe.py devices
```

一覧から実際に使うマイクの番号と名前を選び、次を実行します。
以下は作成時に認識されたRealtekマイクの例です。番号は再接続などで変わるので確認してください。

④ 60秒間の音声検出を開始します。番号が違う場合は `9` を置き換えてください。
cmdでは名前や条件を半角の二重引用符（`"`）で囲みます。

```bat
.\.venv\Scripts\python.exe jarvis_probe.py listen --device 9 --expect-name "マイク (Realtek(R) Audio)" --stage tuning --condition "静音・普段の席・距離50cm" --seconds 60
```

`LISTENING` 表示後、1秒ほど待って「Hey Jarvis」と発話してください。検出時には
`"type": "detected"` とスコアが出ます。`--seconds` を省略すると継続します。
60秒で自動終了します。繰り返す場合は5秒ほど間隔を空けて発話してください。
この段階では音声の返事はなく、検出結果を文字で表示します。
**Ctrl+Cで停止し、マイクを解放します。** マイク切断時はエラーで終了するため、再接続後に一覧を確認して再実行します。
名前の照合は番号変更対策ですが、同名デバイスの個体識別までは保証しません。
サウンドマッパー等の既定デバイスではなく、具体的なマイクを選んでください。

## 検出設定と記録

- `config.json`: 閾値（初期0.5）、抑止時間（初期2秒）。実測前の暫定値です。
- `logs/probe.jsonl`: UTC時刻・セッションID・設定・環境・モデルハッシュ・検出・5秒ごとの負荷。
  5 MiB×最大3ファイルでローテーションします。長時間評価で必要なログは別途保管してください。
- CPUはこのPythonプロセスの値（1コア使用で100%、複数コアでは100%超の可能性）。
  メモリはRSS。推論時間の中央値・p95は直近最大10,000フレームです。
- `processing_ms` は推論処理時間、`queue_age_ms` はコールバック後の経過時間です。
  **どちらも発話終了からの検出遅延ではありません。** リサンプラー等の遅延も別途評価が必要です。
- 音声は上限付きキューと推論用メモリだけで処理し、録音・送信しません。
  通常の `listen` / `selfcheck` にモデル取得処理はありません。
- ネイティブ周波数のモノラルfloat32入力をストリーミング変換し、16 kHz・int16・80 ms単位で推論します。
  入力モノラル非対応の場合は起動エラーになります。`--rate 16000` 等で入力形式の検証もできます。
- 高スコア継続中の重複と抑止時間内の再検出を抑えます。二重反応の実機評価は必要です。
- バッファ超過・入力異常・古いデータを検知すると履歴を捨て、`audio_gap` を記録します。

## 環境を再構築する場合

Windows x64 / Python 3.14で導入・検証しています。

```bat
cd /d D:\Jarvis
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt
.\.venv\Scripts\python.exe jarvis_probe.py prepare
.\.venv\Scripts\python.exe jarvis_probe.py selfcheck
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

`prepare` のみネットワークを使用し、公式v0.5.1リリースの3つのONNXモデルを取得します。
`models/manifest.json` は取得時のSHA-256を記録し、起動時に検証します。
これは取得後の変更検知であり、第三者の署名による真正性検証ではありません。

参考: [openWakeWord公式](https://github.com/dscripka/openWakeWord)、
[Hey Jarvisモデル](https://github.com/dscripka/openWakeWord/blob/main/docs/models/hey_jarvis.md)。
ライブラリと学習済みモデルのライセンスは異なります。公式記載ではコードはApache-2.0、
同梱学習済みモデルはCC BY-NC-SA 4.0です。個人検証用として扱い、配布前に採用資産の条件を再確認してください。

次は `docs/phase1-evaluation.md` に沿って本人の声で測定してください。
