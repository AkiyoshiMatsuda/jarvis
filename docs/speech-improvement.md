# 読み上げ改善

2026-10-10。回答を読み上げる処理を改善しました。

## 操作

画面下部の「読み上げの声」「読み上げの速さ」で選び、「読み上げを試す」で試聴できます。設定は再起動後も保持します。
試聴はAIを使わず、現在の回答や会話履歴を変えません。試聴中はマイクを停止し、終了後に元の状態へ戻ります。

- 速度は0.8〜1.2倍、初期値1倍。
- PC内の日本語音声だけを選択可能。選択した声が消えた場合はエラーを表示します。「自動」を選び直すと利用可能な日本語音声を選びます。
- 声と速度の設定は回答・試聴に適用します。固定の「はい、何でしょう？」は別音声です。

## 読む文章の改善

画面の回答はそのまま、読み上げ用テキストだけを整えます。

| 表示 | 読み上げ用の表現 |
| --- | --- |
| 2026-10-15 | 2026年10月15日 |
| 10/15(木) 10:00〜11:30 | 10月15日、木曜日 10時から11時30分 |
| Markdown見出し・太字 | 記号を除いた本文 |
| 名前付きリンク | リンク名 |
| コードブロック・URL | 画面を見る案内 |

分数1/2、乗算2*3は維持します。文末・改行で区切り、長い文は最大240文字を目安に分割します。途中停止は後続文も止め、開始・終了通知は回答全体で1回ずつです。

## 調査と限界

Windowsの日本語音声にはAyumi・Haruka・Ichiroなどがあります。[Microsoftの一覧](https://support.microsoft.com/ja-jp/accessibility/windows/narrator/appendix-a-supported-languages-and-voices)
声と速度はWeb Speech APIで指定しています。[音声指定](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance)、[速度指定](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/rate)
Narrator用の日本語自然音声Nanami・Keitaもありますが、Narratorで使えることとElectronの一覧に出ることは別です。利用可能と確認していない音声は導入していません。[Microsoftの案内](https://blogs.windows.com/windows-insider/2023/06/29/announcing-windows-11-insider-preview-build-23493/)
別エンジンにはVOICEVOXも候補ですが、追加導入と声ごとの条件・クレジット対応が必要です。[利用条件](https://voicevox.hiroshiba.jp/term/)

改善対象は日時・記号の読み方、区切り、設定です。アクセントや声質はWindowsのエンジンに依存し、人間が耳で評価した自然さのスコアはありません。固有名詞の読みも保証していません。

## 検証

Node自動テスト73件成功。日時・装飾の整形、分数維持、分割、取消、ローカル音声限定、声の消失、設定移行を含みます。
固定応答のない隔離フォルダーで音声生成とキャッシュ検証も確認しました。
証跡はvalidation/speech-improvement-tests.txt、validation/response-build/、同梱版結果はvalidation/speech-improvement/packaged.jsonです。

同梱版でも実際の日本語音声の開始・終了、複数文の再生、声・速度の保存、試聴後の回答維持、途中停止、消音、ロック中の停止、実Ollama回答の読み上げを確認しました。
このPCで選択可能なのはAyumi・Haruka・Ichiro・Sayakaです。自然さの好みは「読み上げを試す」で比較してください。
さらにタイマーの反復通知・停止・音声処理との非競合、マイクの開始・停止・取消・復旧、カレンダーの期間指定・取得取消の回帰確認も成功しました。
証跡は同フォルダーのtimer-regression.txt、desktop-regression.txt、calendar-regression.txtです。
