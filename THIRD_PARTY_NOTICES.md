# 外部コンポーネントと公開範囲

公開対象はソース・設定例・依存の指定です。モデル本体、依存パッケージ本体、Windows生成音声、ビルド済みアプリは含めません。

| 資産 | 取得元・条件 | 扱い |
| --- | --- | --- |
| openWakeWordコード | [公式](https://github.com/dscripka/openWakeWord)、Apache-2.0 | 依存バージョンのみ |
| openWakeWord学習済みモデル | [公式License節](https://github.com/dscripka/openWakeWord#license)、CC BY-NC-SA 4.0 | 本体を除外。URL・ハッシュのみ |
| Vosk日本語ja-0.22 | [モデル一覧](https://alphacephei.com/vosk/models)、Apache-2.0 | 本体を除外。URL・ハッシュのみ |
| Qwen2.5 7B | [モデル情報](https://ollama.com/library/qwen2.5:7b) | Ollamaで別途取得 |
| Windows音声 | [Microsoft API](https://learn.microsoft.com/en-us/uwp/api/windows.media.speechsynthesis.speechsynthesizer) | 各PCで固定応答を生成。生成物は除外 |
| Electron・React・Viteと依存 | package-lock.jsonと各配布物のLICENSE | node_modulesとビルド生成物を除外 |
| Pythonライブラリ | requirements-build.lock.txtと各配布物のライセンス | 仮想環境・同梱ワーカーを除外 |

openWakeWordの学習済みモデルには非商用・表示・継承条件があります。GitHub Releasesへモデル入り実行ファイルを添付する場合は、各ライセンス文書・著作権表示・Windows生成音声の配布条件を別途確認してください。今回の確認はバイナリ配布の承認ではありません。
プロジェクト自身のLICENSEは未設定です。MITなどの再利用許諾は所有者が選択するものであり、依存先のライセンスをプロジェクト全体へ自動適用していません。
