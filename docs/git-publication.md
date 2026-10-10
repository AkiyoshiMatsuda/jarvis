# GitHub公開前のファイル整理

## 2026-10-10の再点検結果（現行）

対象はソース公開です。実際のGit除外ルールで公開候補を列挙し、認証キー・トークン・秘密鍵・メールアドレス・ユーザーフォルダー名・バイナリ・大容量ファイルを点検しました。実際の秘密情報・個人情報の検出はありません。
package-lock.jsonのメール形式は、依存パッケージの公開済み非推奨通知の連絡先と確認しました。
rootに.gitはなく、初期化・コミット・pushはしていません。別の場所や過去の公開履歴を監査したという意味ではありません。

除外をOAuth設定、秘密鍵、ローカルDB、バックアップ、エクスポート、圧縮ファイル、.npmrc/.pypirc/.netrcへ拡充しました。
**Windows生成のui/public/response.wavとresponse.jsonもGit対象外** に変更しました。各PCで `npm run build:ui` / `npm run package` 時に必要なら生成します。既存の作業フォルダー内の音声は保持しています。
以下の「初回整備の記録」にある固定音声を残す方針は、この変更で置き換わりました。

### 未解消の依存関係

`npm audit --omit=dev` は0件。開発依存を含めると中程度8件、高・緊急0件です。
8件はビルド経路のsprintf-js@1.1.3の同一問題と上位依存への波及です。[公開アドバイザリ](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
確認時の最新版も1.1.3でした。npmの提案はelectron-builderを26.15.3から26.5.0へ戻す変更であり、自動適用していません。互換性のある修正版は確認できず、未解消として残します。
結果はvalidation/npm-audit.jsonとvalidation/npm-audit-runtime.json。npm監査はPython依存・Electron実行ファイルを含む全体の完全な安全性評価ではありません。

### ソースと実行ファイル

モデル本体・ビルド成果物を含めないソース公開が対象です。[外部コンポーネントの条件](../THIRD_PARTY_NOTICES.md) に記録したとおり、openWakeWord学習済みモデルには非商用などの条件があります。GitHub Releasesへ同梱版を添付する場合は追加確認が必要です。
プロジェクトのLICENSEは未設定です。オープンソースとして再利用を許可する場合は所有者がライセンスを選択してください。
package.jsonのprivate:trueはnpmへの誤公開防止で、GitHubの公開・非公開設定ではありません。

### 再確認（cmd）

```bat
cd /d D:\Jarvis
.venv\Scripts\python.exe scripts\audit-publication.py
npm audit
```

値そのものを出さず、ファイル名・行番号・検出種類だけを報告します。結果はvalidation/publication-audit.jsonです。
Gitがない場合はvalidation内の一時Gitディレクトリで判定し、rootをGit初期化しません。
パターン検査はすべての情報漏洩を保証しません。Git作成後はpush前にgit status --shortとgit diff --cachedを確認してください。git add -fによる除外ルールの回避は避けてください。

## 初回整備の記録

2026-10-10。`.gitignore` を整備した。作業時点でプロジェクト直下に `.git` はなく、
Git初期化・リモート設定・コミット・pushは行っていない。

## 除外対象

- Python仮想環境、Node依存パッケージ、キャッシュ
- `build/`、`dist/`、`release/`、`ui-dist/` の生成物
- `validation/`、`logs/`、`.smoke-data/`、録音・キャプチャ用フォルダー
- ダウンロードしたモデル本体・圧縮ファイル
- `.env`、認証情報JSON、秘密鍵、端末固有の `settings.json`・`*.local.json`
- エディター設定、一時ファイル、クラッシュダンプ、OS補助ファイル

## 残すもの

ソースコード、テスト、ドキュメント、依存関係のロックファイル、
`ui/public/response.wav` などアプリに必要な固定音声、モデル取得情報のmanifestを残す。
`config.json` は閾値と抑止時間だけを含む既定設定なので残す。
環境設定の雛形として `.env.example` と `.env.sample` は除外しない。

隔離した一時Gitリポジトリでルールを確認し、16種類のローカル・秘密情報パスが除外され、
11種類のソース・資産パスが残ることを確認した。

`.gitignore` はすでに追跡済みのファイルや過去のコミットを消すものではない。
今後認証情報を追加する際はソースコードに直接書き込まず、push前にステージ対象を確認する。
モデルや同梱音声の公開・配布にあたっては、それぞれの利用条件も確認する。
