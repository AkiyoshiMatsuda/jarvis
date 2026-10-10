import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import './response.css';
import './transcript.css';
import {connectResponseAudio} from './response-audio';
import {connectSpeech,localJapaneseVoices} from './speech.mjs';
import {connectTimerAlarm} from './timer-alarm.mjs';

connectResponseAudio();
connectSpeech(window.jarvis,window.speechSynthesis,window.SpeechSynthesisUtterance);
connectTimerAlarm(window.jarvis,window.AudioContext);
function remaining(ms) {
  const s=Math.ceil(ms/1000);return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');
}

function App() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [question, setQuestion] = useState('');
  const [weatherPlace,setWeatherPlace]=useState('');
  const [page,setPage]=useState('home');
  const [category,setCategory]=useState('audio');
  const [voices,setVoices]=useState([]);
  useEffect(()=>{const update=()=>setVoices(localJapaneseVoices(window.speechSynthesis));update();window.speechSynthesis.addEventListener('voiceschanged',update);return ()=>window.speechSynthesis.removeEventListener('voiceschanged',update);},[]);
  useEffect(() => {
    const off = window.jarvis.subscribe(setData);
    window.jarvis.snapshot().then(setData);
    return off;
  }, []);
  useEffect(()=>{if(data?.state==='SUSPENDED')setQuestion('');},[data?.state]);
  useEffect(()=>{setQuestion('');},[data?.conversationVersion]);
  async function action(name, value) {
    setBusy(true); setMessage('');
    try { const result = await window.jarvis.action(name, value); if (!result.ok) setMessage(result.error); else if(name==='ask-text')setQuestion(''); }
    catch(e) { setMessage(e.message); }
    finally { setBusy(false); }
  }
  if (!data) return <main>JARVISを起動しています…</main>;
  const enabled = data.settings.monitoring_enabled;
  const deviceKey = d => JSON.stringify([d.name, d.hostapi]);
  const selected = data.settings.device ? deviceKey(data.settings.device) : '';
  const known = data.devices.some(d => deviceKey(d) === selected);
  const working=['ACTIVATED','PREPARING_INPUT','CAPTURING','TRANSCRIBING','THINKING','WEATHER','CALENDAR','SPEAKING','TIMER_ALERT'].includes(data.state);
  return <main>
    <header><div><span className="eyebrow">LOCAL VOICE ASSISTANT</span><h1>JARVIS<span className="period">.</span></h1></div><button id="settings-toggle" aria-pressed={page==='settings'} onClick={()=>setPage(page==='home'?'settings':'home')}>{page==='home'?'設定':'ホームに戻る'}</button></header>
    {(data.error || message) && <div role="alert" className="error">{message || data.error}{data.error&&<button disabled={busy} onClick={()=>action('retry')}>再試行</button>}</div>}
    {data.reminderStatus&&<p role="status" className="error">{data.reminderStatus}</p>}
    {data.reminderRows?.length>0&&<section className="panel reminder" role="status"><div className="row"><h3>まもなく予定があります</h3><button onClick={()=>action('reminder-dismiss')}>閉じる</button></div>{data.reminderRows.map((row,i)=><p key={i}><b>{new Date(row.start).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})}</b>　{row.title}</p>)}</section>}
    <div hidden={page!=='home'}>
    <section hidden={!data.timer} className={'panel timer-panel '+(data.timer?.status==='finished'?'timer-finished':'')}>
      <div className="row"><h3>タイマー</h3>{data.timer && <button disabled={busy} onClick={()=>action(data.timer.status==='finished'?'timer-dismiss':'timer-cancel')}>{data.timer.status==='finished'?'アラートを停止':'タイマーを停止'}</button>}</div>
      {data.timer ? <><strong className="timer-clock">{data.timer.status==='finished'?'時間になりました':remaining(data.timer.remainingMs)}</strong>
        <p role="status">{data.timerNotice}{data.timer.status==='finished' && data.timerSoundPending?' 通知音は現在の処理が終わってから鳴ります。':''}</p></>
        : <p>「3分測って」「1分30秒のタイマーをかけて」と話すか、文字で入力してください。</p>}
      <small>会話・監視停止中も継続します。JARVISを終了すると解除されます。スリープ中の終了は復帰後に通知します。</small>
    </section>
    <section className={'status ' + (['LISTENING','ACTIVATED','CAPTURING'].includes(data.state) ? 'active' : '')}>
      <div className="orb"><div /></div>
      <span className="eyebrow">{data.state}</span>
      <h2>{data.label}</h2>
      <p>{data.state === 'PREPARING_INPUT' ? 'まだ話さずお待ちください。「質問を聞いています」と表示されてから話してください。' : data.state === 'SPEAKING' ? '読み上げ中はマイクを停止しています。途中で停止できます。' : data.state === 'WEATHER' ? '設定した地域の天気を取得しています。途中で取り消せます。' : data.state === 'CALENDAR' ? 'Googleから予定を取得しています。途中で取り消せます。' : data.state === 'THINKING' ? 'このPCで回答を生成しています。初回は時間がかかる場合があります。' : data.state === 'TRANSCRIBING' ? 'PC内で日本語を認識しています。取消できます。' : data.state === 'CAPTURING' ? '質問を話してください。無音で終了します（最大15秒）。' : data.state === 'ACTIVATED' ? '返事が終わったら、質問を話してください。' : data.state === 'LISTENING' ? '「Hey Jarvis」と呼びかけてください。' : data.state === 'SUSPENDED' ? 'ロック解除・スリープ復帰を待っています。' : '文字で質問できます。音声を使う場合は監視を開始してください。'}</p>
      {!data.settings.device&&<button onClick={()=>{setCategory('audio');setPage('settings');}}>マイクを設定</button>}
      <button className="primary" disabled={busy || (!enabled && !data.settings.device)}
        onClick={() => action('toggle', !enabled)}>{enabled ? '監視を停止' : '監視を開始'}</button>
      {data.state==='LISTENING' && <button disabled={busy} onClick={()=>action('begin-input')}>質問入力を開始</button>}
      {data.state==='LISTENING' && data.conversation?.length>0 && <button disabled={busy} onClick={()=>action('continue-input')}>続けて話す</button>}
      {working && (data.state==='TIMER_ALERT' ? <button disabled={busy} onClick={()=>action('timer-dismiss')}>通知を閉じる</button> : data.state==='SPEAKING' ? <button disabled={busy} onClick={()=>action('stop-speech')}>読み上げを停止</button> : <button disabled={busy} onClick={()=>action('cancel-input')}>処理を取り消す</button>)}
      <p role="status">{data.inputResult}</p>
      <small>音声認識・AI回答はPC内、予定・天気は外部サービスから取得します。</small>
    </section>
    <section className="panel transcript"><form onSubmit={e=>{e.preventDefault();action('ask-text',question);}}>
      <label htmlFor="question">文字で質問する</label>
      <textarea id="question" value={question} maxLength={2000} rows={3} disabled={busy || working}
        onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing&&question.trim()&&!busy&&!working&&['PAUSED','LISTENING'].includes(data.state)){e.preventDefault();action('ask-text',question);}}} placeholder="質問を入力…（Ctrl＋Enterで送信）" onChange={e=>setQuestion(e.target.value)}/>
      <div className="row"><small>予定はGoogle、天気はOpen-Meteoへ問い合わせます。</small><button disabled={busy || !question.trim() || !['PAUSED','LISTENING'].includes(data.state)}>質問する</button></div>
    </form></section>
    <div className="quick-actions">{['今日の予定','次の予定はいつ','今日の天気','3分測って'].map(q=><button key={q} disabled={busy||working||!['PAUSED','LISTENING'].includes(data.state)} onClick={()=>action('ask-text',q)}>{q}</button>)}</div>
    <section hidden={!data.conversation?.length} className="panel transcript">
      <div className="row"><h3>現在の会話 · {(data.conversation?.length??0)/2}往復</h3>
        <button disabled={busy || ['STARTING','STOPPING','SUSPENDED'].includes(data.state)} onClick={()=>action('new-conversation')}>新しい会話</button></div>
      <small>直近6往復・合計3,000文字まで。10分間の待機、ロック・スリープ・終了で消去します。</small>
      {data.historyTrimmed && <p role="status">履歴の上限を超えたため、古い往復から削除しました。</p>}
      {data.conversation?.length>0 && <details><summary>引き継ぐ会話を見る</summary>
        <div className="conversation-history">{data.conversation.map((m,i)=><div key={i}><b>{m.role==='user'?'あなた':'JARVIS'}</b><p>{m.content}</p></div>)}</div>
      </details>}
    </section>
    {data.transcript && <section className="panel transcript" aria-live="polite">
      <div className="row"><h3>質問</h3><button disabled={working || busy} onClick={()=>action('clear-transcript')}>会話をすべて消去</button></div>
      <p>{data.transcript}</p><small>音声の認識結果には誤りが含まれる場合があります。</small>
    </section>}
    {(data.answer || data.answerNotice) && <section className="panel transcript" aria-live="polite">
      <h3>JARVISの回答</h3>{data.answer && <p>{data.answer}</p>}
      {data.answerNotice && <p role="status">{data.answerNotice}</p>}
      {data.speechNotice && <p role="status">{data.speechNotice}</p>}
      {!data.answer && data.answerNotice && data.transcript && <button disabled={busy || working || !['PAUSED','LISTENING'].includes(data.state)} onClick={()=>action('ask-text',data.transcript)}>同じ質問で再試行</button>}
      <small>予定はGoogleの取得結果を表示します。一般のAI回答は誤ることがあります。予定の追加・変更は行いません。</small>
    </section>}
    </div>
    <div hidden={page!=='settings'} className="settings-page">
    {(working||data.timer)&&<div className="panel"><button onClick={()=>setPage('home')}>会話・タイマーに戻る</button>{data.timer&&<b>　{data.timer.status==='finished'?'タイマー終了':remaining(data.timer.remainingMs)}</b>}{working&&<p>{data.label}</p>}</div>}
    <h2>設定</h2><nav aria-label="設定の分類">{[['audio','音声・起動'],['calendar','カレンダー・通知'],['weather','天気']].map(([key,label])=><button key={key} id={'settings-'+key} aria-pressed={category===key} onClick={()=>setCategory(key)}>{label}</button>)}</nav>
    <section hidden={category!=='calendar'} className="panel transcript">
      <div className="row" id="calendar-settings"><h3>Googleカレンダー</h3><b>{data.calendar?.pending?'接続待ち':data.calendar?.connected?'接続済み':'未接続'}</b></div>
      <p>「今日・明日・来週・今月・来月の予定」「次の予定はいつ」に対応します。</p>
      <details><summary>ほかの聞き方</summary><p>「明後日の予定」「今週末の予定」「再来週の予定」「来週の月曜日の予定」「10月15日の予定」「3日後の予定」「今後7日間の予定」も使えます。</p><p>次の予定は今後365日以内に開始する最も近い予定です。進行中は含めません。年を省略した日付は今年、曜日だけの指定は今日を含む次の該当日です。</p></details>
      <small>メインカレンダーのみ・読み取り専用。日本時間で表示し、今週は月曜〜日曜です。予定は会話履歴やAIに渡しません。</small>
      <p role="status">{data.calendar?.message}</p>
      <div className="row">
        <button disabled={busy||working||data.calendar?.pending||data.calendar?.connected} onClick={()=>action('calendar-import')}>認証設定JSONを読み込む</button>
        {data.calendar?.pending?<button disabled={busy} onClick={()=>action('calendar-cancel')}>接続を取り消す</button>:
          <button disabled={busy||working||!data.calendar?.configured} onClick={()=>action(data.calendar?.connected?'calendar-disconnect':'calendar-connect')}>{data.calendar?.connected?'接続を解除':'Googleに接続'}</button>}
      </div>
      <hr/><h3>予定の事前通知</h3>
      <label className="startup"><input type="checkbox" checked={data.settings.reminders_enabled??false} disabled={busy} onChange={e=>action('reminders-enabled',e.target.checked)}/> 予定の開始前に通知する</label>
      {data.settings.reminders_enabled&&!data.calendar?.connected&&<p role="status">通知を開始するにはGoogleカレンダーに接続してください。</p>}
      <label htmlFor="reminder-minutes">通知のタイミング</label><select id="reminder-minutes" value={data.settings.reminder_minutes??10} disabled={busy} onChange={e=>action('reminder-minutes',Number(e.target.value))}>{[5,10,15,30,60].map(n=><option key={n} value={n}>{n}分前</option>)}</select>
      <p><small>時刻付き予定が対象。起動中に約1分ごとに確認します。会話・タイマー通知中は待機し、ロック・スリープ中は通知しません。開始済み・終日・辞退した予定は対象外です。通知音・自動読み上げはありません。</small></p>
      <details><summary>初回接続の準備</summary><p>Google CloudでGoogle Calendar APIを有効にし、Google Auth Platformで「デスクトップアプリ」のクライアントを作成します。取得したJSONを上のボタンで選択してください。テスト中のアプリでは、ご自分のGoogleアカウントをテストユーザーに追加します。</p><p>「Googleに接続」を押すとブラウザーが開きます。Google画面で予定の読み取りを許可してください。</p></details>
    </section>
    <section hidden={category!=='weather'} className="panel transcript" id="weather-settings">
      <div className="row"><h3>天気予報</h3>{data.settings.weather_location&&<button disabled={busy||working} onClick={()=>action('weather-clear')}>地域を解除</button>}</div>
      <p>{data.settings.weather_location?`設定地域：${data.settings.weather_location.admin} ${data.settings.weather_location.name}`:'地域を設定してください（日本国内）。'}</p>
      <form onSubmit={e=>{e.preventDefault();action('weather-search',weatherPlace);}}>
        <label htmlFor="weather-place">市区町村名</label>
        <input id="weather-place" type="text" value={weatherPlace} maxLength={80} placeholder="例：横浜、Osaka" disabled={busy||working} onChange={e=>setWeatherPlace(e.target.value)}/>
        <button disabled={busy||working||weatherPlace.trim().length<2}>地域を検索</button>
      </form>
      {data.weatherCandidates?.length>0&&<select aria-label="天気の地域候補" defaultValue="" disabled={busy||working} onChange={e=>action('weather-select',Number(e.target.value))}>
        <option value="" disabled>候補を選択して保存</option>{data.weatherCandidates.map(row=><option key={row.id} value={row.id}>{row.admin} {row.name}（{row.latitude.toFixed(2)}, {row.longitude.toFixed(2)}）</option>)}
      </select>}
      <p>「今日の天気」「明日は雨？」「明後日の気温」「週間天気」「今の天気」「傘は必要？」に対応します。</p>
      <small>地域名・座標をOpen-Meteoに送信します。地域はこのPCに保存し、予報は最大10分間再利用します。週間は今日から7日間。傘の案内は1日全体の予報からの目安です。</small>
      <div><button className="text-button" onClick={()=>action('weather-source')}>予報：Open-Meteo ／ 地域検索：GeoNames（出典）</button></div>
    </section>
    <section hidden={category!=='audio'} className="panel"><div className="row"><label htmlFor="microphone">使用するマイク</label>
      <button className="text-button" disabled={busy || enabled || !data.ready} onClick={() => action('refresh')}>一覧を更新</button></div>
      <select id="microphone" value={selected} disabled={busy || enabled || !data.ready}
        onChange={e => {const [name, hostapi] = JSON.parse(e.target.value); action('device', {name,hostapi});}}>
        <option value="" disabled>マイクを選択してください</option>
        {selected && !known && <option value={selected}>未接続: {data.settings.device.name}</option>}
        {data.devices.map(d => <option key={d.index} value={deviceKey(d)}>{d.name} — {d.hostapi}</option>)}
      </select>
      <small>変更する場合は監視を停止してください。音声は保存・送信しません。</small>
      <div className="volume"><label htmlFor="volume">応答音量</label><select id="volume" value={data.settings.response_volume} disabled={busy}
        onChange={e=>action('volume',Number(e.target.value))}>
        {[0,.25,.5,.8,1].map(v=><option value={v} key={v}>{v===0?'消音':`${Math.round(v*100)}%`}</option>)}
      </select></div>
      <label className="startup"><input type="checkbox" checked={data.settings.speech_enabled!==false} disabled={busy}
        onChange={e=>action('speech-enabled',e.target.checked)}/> AIの回答を読み上げる</label>
      <small>PC内の日本語音声を使用します。消音時は文字表示のみです。</small>
      <label htmlFor="speech-voice">読み上げの声</label>
      <select id="speech-voice" disabled={busy||working} value={data.settings.speech_voice??''} onChange={e=>action('speech-voice',e.target.value)}>
        <option value="">自動（PC内の日本語音声）</option>
        {data.settings.speech_voice&&!voices.some(v=>v.voiceURI===data.settings.speech_voice)&&<option value={data.settings.speech_voice}>選択した音声を利用できません</option>}
        {voices.map(v=><option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
      </select>
      <label htmlFor="speech-rate">読み上げの速さ</label>
      <select id="speech-rate" disabled={busy||working} value={data.settings.speech_rate??1} onChange={e=>action('speech-rate',Number(e.target.value))}>
        {[.8,.9,1,1.1,1.2].map(rate=><option key={rate} value={rate}>{rate===1?'標準':rate<1?'ゆっくり':'速め'}（{rate}倍）</option>)}
      </select>
      <button disabled={busy||working||!data.settings.speech_enabled||data.settings.response_volume===0||!['PAUSED','LISTENING'].includes(data.state)} onClick={()=>action('test-speech')}>読み上げを試す</button>
      <label className="startup"><input type="checkbox" checked={data.settings.auto_start} disabled={busy || !data.startupAvailable}
        onChange={e=>action('auto-start',e.target.checked)}/> Windowsログイン時に自動起動</label>
      <small>起動後は保存された監視の開始・停止設定に従います。</small>
    </section>
    <section hidden={category!=='audio'} className="activity"><div><span className="eyebrow">THIS SESSION</span><strong>{data.count}<small> 回検出</small></strong></div>
      <div className="last"><span>最後の呼びかけ</span><b>{data.lastDetection ? new Date(data.lastDetection.at).toLocaleTimeString('ja-JP') : 'まだありません'}</b></div></section>
    </div>
    <footer><p>×で閉じてもトレイに常駐します。<br/>呼びかけると画面を表示し、音声で応答します。</p>
      <div><button onClick={() => action('hide')}>トレイへ</button><button onClick={() => action('quit')}>終了</button></div></footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
