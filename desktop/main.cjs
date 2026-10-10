const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, powerMonitor, Notification, dialog, shell, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readSettings, saveSettings, diagnosticMessage } = require('./core.cjs');
const { WorkerClient } = require('./worker-client.cjs');
const { ResponseCycle, ResponseAudio } = require('./response.cjs');
const {Recovery}=require('./recovery.cjs');
const {setLogin,readLogin}=require('./login.cjs');
const {QuestionInput}=require('./question.cjs');
const {AnswerCycle,askLocal,MODEL}=require('./answer.cjs');
const {Conversation}=require('./conversation.cjs');
const {TimerService,parseTimerCommand,durationLabel}=require('./timer.cjs');
const {createOllamaStarter}=require('./ollama.cjs');
const ensureOllama=createOllamaStarter();
const {parseCalendarCommand,CalendarError}=require('./calendar.cjs');
const {GoogleCalendar}=require('./google-calendar.cjs');
const {WeatherService,WeatherError,searchLocations,parseWeatherCommand}=require('./weather.cjs');
const weather=new WeatherService();
const {Reminders}=require('./reminders.cjs');
let reminders,reminderPoll,reminderRows=[],reminderToast;

const root = path.resolve(__dirname, '..');
const smoke = process.argv.includes('--smoke-test') || process.argv.includes('--hold-test');
if (smoke) app.setPath('userData', path.join(app.isPackaged ? path.dirname(process.execPath) : root, '.smoke-data'));
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
const loaded = readSettings(settingsFile);
let settings = loaded.settings;
let state = 'STARTING', error = loaded.warning, devices = [], count = 0, lastDetection = null;
let win, tray, client, quitting = false, locked = false, sleeping = false, epoch = null, revision = 0;
let operation = Promise.resolve();
let restartQueue=Promise.resolve(), recoveryAttempt=0;
let response, responseAudio, questionInput, inputResult='', transcript='', detectedAt = 0;
let answerCycle, answer='', answerNotice='', manualAnswer=null;
let calendar,calendarCycle;
let weatherCycle,weatherCandidates=[],weatherSearch=null;
let speechAudio, speechRun=null, speechNotice='', speechStarted=0;
let timerAudio,alarmRun=null,pendingAlarm=null,timerPoll,rendererReady=false,timerNotice='',timerNotification,timerAlarmStarted=0;
let nextAlarmAt=0;
const timerService=new TimerService({onChange:()=>publish(),onExpire:timer=>{
  pendingAlarm=timer.id;nextAlarmAt=Date.now();timerNotice='時間になりました。停止するまで繰り返し通知します。';
  if(!locked&&!sleeping&&!win?.isDestroyed()) {win?.showInactive();win?.flashFrame(true);}
  if(Notification.isSupported()&&!smoke) {
    try {timerNotification?.close();timerNotification=new Notification({title:'JARVIS — タイマー終了',body:`${durationLabel(timer.durationMs)}のタイマーが終了しました。`,silent:true});
      timerNotification.on('click',()=>{if(!locked&&!sleeping)show();});
      timerNotification.on('failed',()=>{if(timerService.current?.id===timer.id){timerNotice='時間になりました。Windows通知を表示できなかったため、この画面でお知らせしています。';publish();}});timerNotification.show();}catch{}
  }
  publish();
}});
const conversation=new Conversation({onExpire:()=>{
  clearDisplayed();inputResult='10分間操作がなかったため会話を消去しました。';publish();
}});
function clearDisplayed() {transcript='';answer='';answerNotice='';speechNotice='';inputResult='';}
function clearConversation() {conversation.clear();clearDisplayed();}
const labels = {STARTING:'準備中', LISTENING:'呼びかけを待っています', PAUSED:'監視を停止しています',
  ACTIVATED:'はい、何でしょう？', RECOVERING:'音声監視を復旧しています', SUSPENDED:'ロック・スリープのため停止中', ERROR:'確認が必要です', STOPPING:'終了中'};
labels.CAPTURING='質問を聞いています';
labels.PREPARING_INPUT='マイクを準備しています';
labels.TRANSCRIBING='文字に変換しています';
labels.THINKING='AIが回答を考えています';
labels.CALENDAR='Googleカレンダーの予定を確認しています';
labels.WEATHER='天気予報を確認しています';
labels.SPEAKING='回答を読み上げています';
labels.TIMER_ALERT='タイマーの終了をお知らせしています';
function allowed() { return settings.monitoring_enabled && !locked && !sleeping && !quitting; }
const recovery=new Recovery({allowed,attempt:valid=>restart(valid),status:(next,e,attempt,delay)=>{
  recoveryAttempt=attempt;
  error=next==='RECOVERING'?`${e.message} (${attempt}/5・${delay/1000}秒後に再試行)`:
    next==='ERROR'?`${e.message} 自動復旧を停止しました。マイクを確認して再試行してください。`:e.message;
  setState(next==='INACTIVE'?(locked||sleeping?'SUSPENDED':'PAUSED'):next);
}});
function fault(e) {cancelResponse();epoch=null;++revision;recovery.fail(e);}
function snapshot() { return {reminderRows,reminderStatus:reminders?.notice??'',state, label:labels[state], weatherCandidates,calendar:calendar?.snapshot(),timer:timerService.snapshot(),timerNotice,timerSoundPending:pendingAlarm!==null,inputResult, transcript, answer, answerNotice, speechNotice, conversation:conversation.context(), conversationVersion:conversation.version, historyTrimmed:conversation.trimmed, aiModel:MODEL, error, devices, settings, count, lastDetection, recoveryAttempt, startupAvailable:app.isPackaged&&!smoke, ready:!!client?.ready}; }
function log(type, data) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(dir, {recursive:true});
    const file = path.join(dir, 'desktop.jsonl');
    if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) {
      if (fs.existsSync(file + '.2')) fs.unlinkSync(file + '.2');
      if (fs.existsSync(file + '.1')) fs.renameSync(file + '.1', file + '.2');
      fs.renameSync(file, file + '.1');
    }
    fs.appendFileSync(file, JSON.stringify({time:new Date().toISOString(), type, ...data}) + '\n');
  } catch { error = '診断ログを保存できません。保存先の空き容量・権限を確認してください。'; }
}
function publish() {
  if (win && !win.isDestroyed()) win.webContents.send('snapshot', snapshot());
  if (tray) {
    const timer=timerService.snapshot();
    tray.setToolTip(`JARVIS — ${labels[state]}${timer?timer.status==='finished'?' / タイマー終了':` / 残り${durationLabel(timer.remainingMs)}`:''}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'JARVISを開く', click:show}, {label:labels[state], enabled:false}, {type:'separator'},
      {label:settings.monitoring_enabled?'監視を停止':'監視を開始', enabled:settings.monitoring_enabled || !!settings.device,
       click:() => act('toggle', !settings.monitoring_enabled)},
      {label:'音声プロセスを再試行', click:() => act('retry')}, {type:'separator'},
      {label:'終了', click:() => app.quit()}
    ]));
  }
}
function show() { if (win) { win.show(); win.focus(); } }
function cancelAlarm() {const run=alarmRun;alarmRun=null;run?.finishWait?.();timerAudio?.cancel();}
async function deliverTimerAlarm() {
  if(timerService.current?.status==='finished' && pendingAlarm===null && !alarmRun && Date.now()>=nextAlarmAt)pendingAlarm=timerService.current.id;
  if(pendingAlarm===null||!rendererReady||quitting||locked||sleeping||alarmRun||response?.current||manualAnswer||answerCycle?.current||!['PAUSED','LISTENING'].includes(state))return;
  if(timerService.current?.id!==pendingAlarm) {pendingAlarm=null;return;}
  pendingAlarm=null;
  nextAlarmAt=Date.now()+5000;
  if(settings.response_volume===0){publish();return;}
  const run={};alarmRun=run;epoch=null;++revision;setState('TIMER_ALERT');
  try {
    if(client?.ready)await client.request('pause');
    if(alarmRun!==run)return;
    await timerAudio.play(randomUUID(),settings.response_volume);
    if(alarmRun!==run)return;
    await new Promise(resolve=>{const t=setTimeout(resolve,700);run.finishWait=()=>{clearTimeout(t);resolve();};});
  } catch {if(alarmRun===run){timerNotice='タイマーが終了しました。通知音を再生できませんでした。';publish();}}
  finally {if(alarmRun===run){nextAlarmAt=Date.now()+5000;alarmRun=null;await reconcile().catch(fault);}}
}
function stopTimer() {
  pendingAlarm=null;timerService.cancel();timerNotice='';timerNotification?.close();
  win?.flashFrame(false);
}
function timerCommand(command) {
  if(command.type==='start') {
    const result=timerService.start(command.durationMs);
    if(!result.ok)return result.error;
    timerNotice='';pendingAlarm=null;nextAlarmAt=0;timerNotification?.close();publish();
    return `${durationLabel(command.durationMs)}のタイマーを開始しました。`;
  }
  if(command.type==='cancel') {const existed=!!timerService.current;stopTimer();return existed?'タイマーを停止しました。':'動作中のタイマーはありません。';}
  if(command.type==='remaining') {const timer=timerService.snapshot();return !timer?'動作中のタイマーはありません。':timer.status==='finished'?'タイマーは終了しています。':`残り${durationLabel(timer.remainingMs)}です。`;}
  return '時間を1秒〜24時間で指定してください。例えば「3分測って」と入力できます。';
}
function cancelResponse() {
  cancelAlarm();
  const run=speechRun;speechRun=null;run?.finishWait?.();speechAudio?.cancel();
  response?.cancel(); responseAudio?.cancel(); questionInput?.cancel(); answerCycle?.cancel();calendarCycle?.cancel();weatherCycle?.cancel(); manualAnswer=null;
}
async function readAnswer(text=answer) {
  speechNotice='';
  if(!text || settings.speech_enabled===false || settings.response_volume===0)return;
  const run={};speechRun=run;setState('SPEAKING');
  try {await speechAudio.play(randomUUID(),settings.response_volume,{text,voiceURI:settings.speech_voice,rate:settings.speech_rate});}
  catch {
    if(speechRun===run) {
      speechNotice='読み上げを完了できませんでした。選択した声・Windowsの日本語音声・音声出力を確認してください。回答は文字で確認できます。';publish();
    }
  }
  if(speechRun!==run)return;
  // Avoid immediately re-opening the microphone on the last sound from the speaker.
  await new Promise(resolve=>{
    const timer=setTimeout(resolve,700);run.finishWait=()=>{clearTimeout(timer);resolve();};
  });
  if(speechRun===run)speechRun=null;
}
async function generateAndSpeak(question,{voice=false}={}) {
  if(voice && /^[てでをの]$/.test(question.trim())) {answer='';answerNotice='音声の一部だけが認識されました。「質問を聞いています」の表示後に、もう一度話してください。';publish();return;}
  const command=parseTimerCommand(question);
  if(command) {answer=timerCommand(command);answerNotice='';inputResult='タイマー操作を受け付けました。';publish();await readAnswer();return;}
  const calendarKind=parseCalendarCommand(question);
  if(calendarKind) {if(await calendarCycle.begin(calendarKind))await readAnswer();return;}
  const weatherCommand=parseWeatherCommand(question);
  if(weatherCommand){if(await weatherCycle.begin(weatherCommand))await readAnswer();return;}
  if(await answerCycle.begin(question))await readAnswer();
}
async function answerFromText(question) {
  const run={};manualAnswer=run;
  transcript=question.trim();answer='';answerNotice='';epoch=null;++revision;setState('THINKING');
  try {
    if(client?.ready) await client.request('pause');
    if(manualAnswer!==run || locked || sleeping || quitting)return;
    await generateAndSpeak(transcript);
  } catch(e) {if(manualAnswer===run)fault(e);}
  finally {
    if(manualAnswer===run) {manualAnswer=null;await reconcile().catch(fault);}
  }
}
async function previewSpeech() {
  const run={};manualAnswer=run;epoch=null;++revision;
  try {
    if(client?.ready)await client.request('pause');
    if(manualAnswer!==run||locked||sleeping||quitting)return;
    await readAnswer('こんにちは。ジャービスです。明日は10:30から会議、その後は自由な時間です。');
  } catch(e){if(manualAnswer===run)fault(e);}
  finally{if(manualAnswer===run){manualAnswer=null;await reconcile().catch(fault);}}
}
async function acceptDetection(m) {
  if (!allowed() || state !== 'LISTENING' || m.epoch !== epoch || response?.current) return false;
  count++; detectedAt=performance.now();
  lastDetection = {at:new Date().toISOString(), score:m.score};
  return response.begin();
}
function setState(value) { state = value; conversation.idle(['PAUSED','LISTENING','ERROR'].includes(state),!!(conversation.messages.length||transcript||answer));log('state', {state}); publish(); }
function makeClient() {
  const command = app.isPackaged ? path.join(process.resourcesPath, 'worker', 'jarvis-worker.exe')
    : path.join(root, '.venv', 'Scripts', 'python.exe');
  const args = app.isPackaged ? [] : ['-u', path.join(root, 'jarvis_worker.py')];
  const c = new WorkerClient(command, args);
  c.on('diagnostic', text => log('worker_stderr', {text}));
  c.on('fault', e => { if (client !== c || quitting) return; fault(e); });
  c.on('message', m => {
    if (client !== c || quitting) return;
    // Transcript is session UI data, never a diagnostic log field.
    log('worker', diagnosticMessage(m));
    if (m.type === 'error') fault(Object.assign(Error(m.message),{worker:true,permanent:m.recoverable===false}));
    if (m.type === 'detected') void acceptDetection(m);
    if (['capture_done','transcription_started'].includes(m.type)) questionInput?.report(m);
  });
  return c;
}
async function reconcile() {
  const mine = ++revision;
  epoch = null;
  if (!client?.ready) { if (!quitting) setState(locked||sleeping?'SUSPENDED':settings.monitoring_enabled ? 'ERROR' : 'PAUSED'); return; }
  if (allowed()) {
    const token = randomUUID();
    await client.request('resume', {device:settings.device, threshold:settings.threshold, cooldown:settings.cooldown, epoch:token});
    if (mine === revision && allowed()) { epoch = token; setState('LISTENING'); }
  } else {
    await client.request('pause');
    if (mine === revision) setState(locked || sleeping ? 'SUSPENDED' : 'PAUSED');
  }
}
function restart(valid=()=>!quitting) {
  const task=restartQueue.catch(()=>{}).then(()=>restartNow(valid));
  restartQueue=task;return task;
}
async function restartNow(valid) {
  if(!valid()) return;
  cancelResponse();
  epoch = null; ++revision; setState(recovery.running?'RECOVERING':'STARTING');
  const old=client;client=null;
  if (old) await old.stop();
  if (!valid() || quitting) return;
  const current=makeClient();client=current;
  const ready = await current.start(); devices = ready.devices; publish();
  if(!valid() || quitting) {if(client===current)client=null;await current.stop();return;}
  await reconcile();
  error='';if(allowed())recovery.healthy();publish();
}
let calendarSettingsBusy=false;
async function weatherAction(name,value) {
  if(quitting||locked||sleeping)return {ok:false,error:'画面を利用できる状態で操作してください。'};
  if(name==='weather-source'){await shell.openExternal('https://open-meteo.com/');return {ok:true};}
  if(!['PAUSED','LISTENING','ERROR'].includes(state)||manualAnswer)return {ok:false,error:'現在の入力・回答が終わってから地域を変更してください。'};
  try {
    if(name==='weather-search') {
      weatherSearch?.abort();const controller=new AbortController();weatherSearch=controller;weatherCandidates=[];publish();
      try {
        const results=await searchLocations(value,{signal:controller.signal});
        if(weatherSearch!==controller||locked||sleeping||quitting)return {ok:false,error:'地域検索を取り消しました。'};
        weatherCandidates=results;publish();return results.length?{ok:true}:{ok:false,error:'地域が見つかりません。市区町村名やローマ字表記で検索してください。'};
      }finally{if(weatherSearch===controller)weatherSearch=null;}
    } else if(name==='weather-select'||name==='weather-clear') {
      const location=name==='weather-clear'?null:weatherCandidates.find(row=>row.id===value);
      if(location===undefined)return {ok:false,error:'検索結果から地域を選択してください。'};
      const next={...settings,weather_location:location};saveSettings(settingsFile,next);settings=next;weather.clear();weatherCandidates=[];clearDisplayed();publish();return {ok:true};
    }
    return {ok:false,error:'不明な天気の操作です。'};
  }catch(e){return {ok:false,error:e instanceof WeatherError?e.message:'地域の検索・保存を完了できませんでした。'};}
}
async function calendarAction(name) {
  if(!calendar||quitting||locked||sleeping)return {ok:false,error:'画面を利用できる状態で操作してください。'};
  if(name==='calendar-cancel'){calendar.cancel();return {ok:true};}
  if(calendarSettingsBusy)return {ok:false,error:'接続設定の処理中です。少し待ってください。'};
  if(!['PAUSED','LISTENING','ERROR'].includes(state))return {ok:false,error:'現在の入力・回答が終わってから接続設定を変更してください。'};
  calendarSettingsBusy=true;
  try {
    if(name==='calendar-import') {
      const result=await dialog.showOpenDialog(win,{title:'Googleのデスクトップアプリ用認証JSON',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});
      if(result.canceled)return {ok:true};
      if(locked||sleeping||quitting)return {ok:false,error:'読み込みを取り消しました。'};
      if(fs.statSync(result.filePaths[0]).size>65536)return {ok:false,error:'認証JSONが大きすぎます。Google Cloudから取得したファイルを選んでください。'};
      calendar.importClient(fs.readFileSync(result.filePaths[0],'utf8'));
    } else if(name==='calendar-connect') {
      if(!calendar.snapshot().configured)return {ok:false,error:'先に認証設定JSONを読み込んでください。'};
      void calendar.connect();
    } else if(name==='calendar-disconnect') {clearConversation();await calendar.disconnect();}
    else return {ok:false,error:'不明なカレンダー操作です。'};
    publish();return {ok:true};
  } catch(e) {return {ok:false,error:e instanceof CalendarError?e.message:'カレンダー設定を保存できませんでした。ファイルと保存先の権限を確認してください。'};}
  finally{calendarSettingsBusy=false;}
}
function act(name, value) {
  if(name==='reminder-dismiss'){reminderRows=[];reminderToast?.close();publish();return Promise.resolve({ok:true});}
  if(typeof name==='string'&&name.startsWith('weather-'))return weatherAction(name,value);
  if(typeof name==='string'&&name.startsWith('calendar-'))return calendarAction(name);
  if(name==='new-conversation') {cancelResponse();clearConversation();epoch=null;++revision;}
  const stoppingSpeech=name==='stop-speech' && !!speechRun;
  if(stoppingSpeech) cancelResponse();
  const cancelling=name==='cancel-input' && !!(response?.current || answerCycle?.current || calendarCycle?.current || weatherCycle?.current || manualAnswer);
  if(cancelling) cancelResponse();
  // Stop intent takes effect immediately, including during an in-flight resume.
  if (name === 'toggle' && value === false) { settings.monitoring_enabled = false; epoch = null; ++revision; cancelResponse(); recovery.cancel(); }
  if (name === 'retry') {cancelResponse();recovery.reset();}
  if (name === 'toggle' && value === true) cancelResponse();
  operation = operation.then(async () => {
    if (quitting) return;
    if(name==='timer-cancel' || name==='timer-dismiss') {
      const wasAlarm=!!alarmRun;cancelAlarm();stopTimer();if(wasAlarm)await reconcile();
    } else if (name === 'toggle') {
      if (typeof value !== 'boolean') throw Error('Invalid monitoring value');
      if (value && !settings.device) throw Error('マイクを選択してください。');
      const next = {...settings, monitoring_enabled:value};
      // A failed save must still honor a stop request.
      if (!value) {
        settings = next;
        let saveError;
        try { saveSettings(settingsFile, settings); } catch(e) { saveError = e; }
        await reconcile();
        if (saveError) throw saveError;
      } else { saveSettings(settingsFile, next); settings = next; recovery.reset(); if(client?.ready)await reconcile();else await restart(); }
    } else if (name === 'new-conversation') {
      inputResult='新しい会話を開始しました。';await reconcile();
    } else if (name === 'stop-speech') {
      if(stoppingSpeech) {inputResult='読み上げを停止しました。';await reconcile();}
    } else if (name === 'speech-enabled') {
      if(typeof value!=='boolean')throw Error('Invalid speech setting');
      const next={...settings,speech_enabled:value};saveSettings(settingsFile,next);settings=next;
      if(!value && speechRun) {cancelResponse();inputResult='読み上げを停止しました。';await reconcile();}
    } else if(name==='speech-voice'||name==='speech-rate') {
      const next={...settings,[name==='speech-voice'?'speech_voice':'speech_rate']:value};saveSettings(settingsFile,next);settings=next;
    } else if(name==='test-speech') {
      if(!['PAUSED','LISTENING'].includes(state)||manualAnswer||locked||sleeping)return {ok:false,error:'現在の処理が終わってから試してください。'};
      if(!settings.speech_enabled||settings.response_volume===0)return {ok:false,error:'読み上げを有効にして消音を解除してください。'};
      void previewSpeech();
    } else if (name === 'cancel-input') {
      if (!cancelling) return {ok:true};
      cancelResponse(); transcript='';answer='';answerNotice=''; inputResult='入力・回答を取り消しました。'; await reconcile();
    } else if (name === 'clear-transcript') {
      if(response?.current || answerCycle?.current || manualAnswer)return {ok:false,error:'処理を取り消してから消去してください。'};
      clearConversation();
    } else if (name === 'ask-text') {
      if(typeof value!=='string' || !value.trim() || value.length>2000)return {ok:false,error:'質問は1〜2000文字で入力してください。'};
      if(!['PAUSED','LISTENING'].includes(state) || response?.current || manualAnswer || locked || sleeping)return {ok:false,error:'現在の処理が終わってから質問してください。'};
      void answerFromText(value);
    } else if (name === 'begin-input') {
      if (!allowed() || state!=='LISTENING') return {ok:false,error:'監視を開始してから入力してください。'};
      void acceptDetection({epoch,score:0});
    } else if (name === 'continue-input') {
      if(!allowed() || state!=='LISTENING' || !conversation.messages.length)return {ok:false,error:'会話とマイク監視を開始してから続けてください。'};
      void response.begin({greet:false});
    } else if (name === 'device') {
      if (settings.monitoring_enabled) throw Error('監視を停止してからマイクを変更してください。');
      const device = devices.find(d => d.name === value?.name && d.hostapi === value?.hostapi);
      if (!device) throw Error('マイクを選び直してください。');
      const next = {...settings, device:{name:device.name, hostapi:device.hostapi}};
      saveSettings(settingsFile, next); settings = next;
    } else if (name === 'refresh') {
      if (settings.monitoring_enabled) throw Error('監視を停止してください。');
      devices = (await client.request('devices')).devices;
    } else if (name === 'auto-start') {
      if(typeof value!=='boolean' || !app.isPackaged || smoke) throw Error('自動起動は通常の同梱版で設定してください。');
      const previous=settings.auto_start;
      try {setLogin(app,value);saveSettings(settingsFile,{...settings,auto_start:value});}
      catch(e) {try{setLogin(app,previous);}catch{}throw e;}
      settings={...settings,auto_start:value};
    } else if (name === 'reminders-enabled'||name === 'reminder-minutes') {
      const next={...settings,[name==='reminders-enabled'?'reminders_enabled':'reminder_minutes']:value};
      saveSettings(settingsFile,next);settings=next;reminders.reset();reminderRows=[];reminderToast?.close();
    } else if (name === 'volume') {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw Error('Invalid volume');
      const next={...settings,response_volume:value}; saveSettings(settingsFile,next); settings=next;
    } else if (name === 'retry') { error = ''; await restart(); }
    else if (name === 'hide') win.hide();
    else if (name === 'quit') app.quit();
    else throw Error('Unknown action');
    if (name !== 'retry') error = '';
    publish();
    return {ok:true};
  }).catch(async e => {
    if(name==='auto-start') {error=e.message;publish();return {ok:false,error:e.message};}
    if(e.worker) {fault(e);return {ok:false,error:e.message};}
    cancelResponse();
    error = e.message; epoch = null; ++revision;
    if (client && /タイムアウト|応答/.test(e.message)) await client.stop();
    setState('ERROR'); return {ok:false, error:e.message};
  });
  return operation;
}
function suspend() {
  reminders?.reset();reminderRows=[];reminderToast?.close();
  weatherSearch?.abort();weatherSearch=null;weatherCandidates=[];
  if(locked||sleeping)calendar?.cancel();
  clearConversation();
  recovery.cancel();cancelResponse();epoch=null;++revision;
  if(allowed() && recovery.halted) {setState('ERROR');return;}
  if(allowed() && !recovery.halted) restart(()=>allowed()).catch(fault);
  else reconcile().catch(fault);
}

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { if (!smoke) show(); });
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;clearInterval(reminderPoll);reminders?.reset();reminderToast?.close();weatherSearch?.abort();calendar?.cancel();clearInterval(timerPoll);timerNotification?.close();epoch = null; ++revision; recovery.cancel();cancelResponse();clearConversation(); setState('STOPPING');
    Promise.resolve(client?.stop()).finally(() => app.exit(0));
  });
  app.whenReady().then(async () => {
    weatherCycle=new AnswerCycle({timeoutMs:20000,timeoutMessage:'天気の取得が時間内に完了しませんでした。再試行してください。',
      ask:(command,options)=>weather.ask(command,settings.weather_location,options),
      started:()=>{answer='';answerNotice='';speechNotice='';inputResult='';setState('WEATHER');},
      complete:result=>{answer=result.text;answerNotice='';inputResult='天気予報を取得しました。';publish();},
      failed:message=>{answerNotice=message;inputResult='天気を取得できませんでした。';publish();}
    });
    calendar=new GoogleCalendar({file:path.join(app.getPath('userData'),'google-calendar.enc'),safeStorage,openExternal:url=>shell.openExternal(url),onChange:()=>{reminders?.reset();reminderRows=[];reminderToast?.close();publish();}});
    calendar.load();
    const reminderFile=path.join(app.getPath('userData'),'reminder-seen.json');
    let seen={};try{const saved=JSON.parse(fs.readFileSync(reminderFile,'utf8'));seen=Object.fromEntries(Object.entries(saved).filter(([k,v])=>/^[a-f0-9]{64}$/.test(k)&&Number.isFinite(v)));}catch{}
    reminders=new Reminders({seen,fetch:signal=>calendar.ask(null,{signal,raw:true}),onChange:publish,
      save:next=>{fs.writeFileSync(reminderFile+'.tmp',JSON.stringify(next));fs.renameSync(reminderFile+'.tmp',reminderFile);},
      notify:rows=>{
        reminderRows=rows;win?.showInactive();win?.flashFrame(true);
        if(Notification.isSupported()&&!smoke){try{reminderToast?.close();reminderToast=new Notification({title:'JARVIS — まもなく予定があります',body:'予定の開始が近づいています。JARVISで確認してください。',silent:true});reminderToast.on('click',()=>{if(!locked&&!sleeping)show();});reminderToast.show();}catch{}}
      }});
    calendarCycle=new AnswerCycle({timeoutMs:60000,timeoutMessage:'予定の取得が時間内に完了しませんでした。再試行してください。',
      ask:(kind,options)=>calendar.ask(kind,options),
      started:()=>{answer='';answerNotice='';speechNotice='';inputResult='';setState('CALENDAR');},
      complete:result=>{answer=result.text;answerNotice='';inputResult='Googleカレンダーから予定を取得しました。';publish();},
      failed:message=>{answerNotice=message;inputResult='予定を取得できませんでした。';publish();}
    });
    win = new BrowserWindow({width:740, height:870, minWidth:640, minHeight:790, show:!smoke&&!process.argv.includes('--login-start'),
      title:'JARVIS', backgroundColor:'#09141b', autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname, 'preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true,
        autoplayPolicy:'no-user-gesture-required', backgroundThrottling:false}});
    responseAudio = new ResponseAudio(message=>{
      if (!win.isDestroyed()) win.webContents.send('response',message);
    },()=>{
      const audio_start_ms=performance.now()-detectedAt;
      if (lastDetection) lastDetection.audio_start_ms=audio_start_ms;
      log('response_audio_started',{detection_to_audio_event_ms:audio_start_ms}); publish();
    });
    speechAudio = new ResponseAudio(message=>{
      if(!win.isDestroyed())win.webContents.send('speech',message);
    },()=>{speechStarted++;},180000);
    timerAudio=new ResponseAudio(message=>{if(!win.isDestroyed())win.webContents.send('timer-alarm',message);},()=>{timerAlarmStarted++;},5000);
    answerCycle = new AnswerCycle({
      conversation,
      ask:async(question,options)=>{await ensureOllama(options);return askLocal(question,options);},
      started:()=>{answer='';answerNotice='';speechNotice='';inputResult='';setState('THINKING');},
      complete:result=>{answer=result.text;answerNotice=result.truncated?'回答が長さの上限に達したため、この往復は会話履歴に追加しません。質問を絞って再度お試しください。':'';inputResult='回答が完了しました。';publish();},
      failed:message=>{answerNotice=message;inputResult='回答を取得できませんでした。';publish();}
    });
    questionInput = new QuestionInput({
      start:async id=>{
        setState('PREPARING_INPUT');
        await client.request('capture',{device:settings.device,threshold:settings.threshold,cooldown:settings.cooldown,epoch:randomUUID(),capture_id:id});
        if(questionInput.current?.id===id)setState('CAPTURING');
      },
      done:m=>{
        const reasons={no_speech:'発話がなかったため入力を終了しました。',silence:'無音を検出して入力を終了しました。',limit:'15秒の上限で入力を終了しました。',audio_gap:'音声が途切れたため入力を破棄しました。'};
        transcript=typeof m.text==='string'?m.text.slice(0,4000):'';
        inputResult=m.error || (typeof m.text==='string' ? (transcript?'文字起こしが完了しました。':'言葉を認識できませんでした。もう一度お試しください。') : reasons[m.reason]) || '入力を終了しました。';publish();
      },
      transcribing:()=>setState('TRANSCRIBING')
    });
    response = new ResponseCycle({
      allowed,
      activate:({greet})=>{
        inputResult='';transcript='';answer='';answerNotice='';speechNotice='';
        epoch=null; ++revision; setState(greet?'ACTIVATED':'PREPARING_INPUT');
        if (!smoke) {win.showInactive(); if (!win.isFocused()) win.flashFrame(true);}
        if(greet)log('response_presented',{detection_to_display_request_ms:performance.now()-detectedAt,hidden_test:smoke});
      },
      pause:()=>client.request('pause'),
      play:id=>responseAudio.play(id,settings.response_volume),
      stopAudio:()=>responseAudio.cancel(),
      resume:()=>reconcile(),
      input:()=>questionInput.begin(),
      answer:()=>transcript?generateAndSpeak(transcript,{voice:true}):Promise.resolve(),
      speechError:e=>{error=e.message;log('response_audio_error',{message:e.message});publish();},
      fatal:e=>{client?.fail(e);},
      cooldownMs:0
    });
    win.on('focus',()=>win.flashFrame(false));
    win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
    // Simple generated bitmap, no external assets or runtime network request.
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y=0; y<32; y++) for (let x=0; x<32; x++) {
      const r = Math.hypot(x-15.5,y-15.5), i=(y*32+x)*4;
      if ((r>9 && r<13) || r<4) { pixels[i]=210; pixels[i+1]=218; pixels[i+2]=73; pixels[i+3]=255; }
    }
    tray = new Tray(nativeImage.createFromBitmap(pixels, {width:32,height:32}));
    tray.on('double-click', show);
    ipcMain.handle('snapshot', event => { if (event.sender !== win.webContents) throw Error('Invalid sender'); return snapshot(); });
    ipcMain.handle('action', (event, name, value) => { if (event.sender !== win.webContents) throw Error('Invalid sender'); return act(name, value); });
    ipcMain.on('response-event',(event,id,kind)=>{
      if(event.sender!==win.webContents || typeof id!=='string' || id.length>100 || !['started','ended','error'].includes(kind)) return;
      responseAudio.report(id,kind);
    });
    ipcMain.on('speech-event',(event,id,kind)=>{
      if(event.sender!==win.webContents || typeof id!=='string' || id.length>100 || !['started','ended','error'].includes(kind))return;
      speechAudio.report(id,kind);
    });
    ipcMain.on('timer-alarm-event',(event,id,kind)=>{
      if(event.sender!==win.webContents||typeof id!=='string'||id.length>100||!['started','ended','error'].includes(kind))return;
      timerAudio.report(id,kind);
    });
    win.webContents.on('render-process-gone',()=>{
      rendererReady=false;
      recovery.cancel();recovery.halted=true;cancelResponse(); epoch=null; ++revision;
      client?.request('pause').catch(e=>client?.fail(e));
      error='画面の処理が終了しました。アプリを終了して開き直してください。'; setState('ERROR');
    });
    powerMonitor.on('lock-screen', () => { locked = true; suspend(); });
    powerMonitor.on('unlock-screen', () => { locked = false; suspend(); });
    powerMonitor.on('suspend', () => { sleeping = true; suspend(); });
    powerMonitor.on('resume', () => { sleeping = false; suspend(); });
    locked = powerMonitor.getSystemIdleState(1) === 'locked';
    if(app.isPackaged && !smoke) {
      try {
        const actual=readLogin(app);
        if(actual!==settings.auto_start) {settings={...settings,auto_start:actual};saveSettings(settingsFile,settings);}
      } catch(e) {error=`自動起動設定を確認できません: ${e.message}`;}
    }
    publish();
    await win.loadFile(path.join(root, 'ui-dist', 'index.html'));
    if(!smoke)reminderPoll=setInterval(()=>{void reminders.tick({enabled:settings.reminders_enabled,minutes:settings.reminder_minutes,connected:calendar.snapshot().connected,available:!locked&&!sleeping&&!quitting,idle:['PAUSED','LISTENING'].includes(state)&&!manualAnswer&&!pendingAlarm&&!alarmRun});},1000);
    rendererReady=true;timerPoll=setInterval(()=>{timerService.tick();void deliverTimerAlarm();},250);
    try { await restart(); } catch(e) { fault(e); }
    if (smoke) {
      const assert = require('node:assert/strict');
      assert.equal(state, 'PAUSED', error);
      assert.ok(devices.length > 0);
      const result = {state, devices:devices.length, error, workerPid:client?.child?.pid};
      if(process.argv.includes('--reminder-test')) {
        const originalSettings=settings;
        const js=code=>win.webContents.executeJavaScript(code);
        assert.equal(await js("document.getElementById('microphone').getClientRects().length"),0);
        await js("document.getElementById('settings-toggle').click()");await new Promise(r=>setTimeout(r,100));
        assert.ok(await js("document.getElementById('microphone').getClientRects().length>0"));
        await js("document.getElementById('settings-calendar').click()");await new Promise(r=>setTimeout(r,100));
        await act('reminders-enabled',true);await act('reminder-minutes',15);
        assert.equal(JSON.parse(fs.readFileSync(settingsFile,'utf8')).reminder_minutes,15);
        win.showInactive();await new Promise(r=>setTimeout(r,200));
        fs.writeFileSync(path.join(app.getPath('userData'),'settings-preview.png'),(await win.webContents.capturePage()).toPNG());
        const originalFetch=reminders.fetch,originalSave=reminders.save;reminders.seen={};reminders.save=()=>{};
        reminders.fetch=async()=>[{id:'synthetic-reminder',summary:'通知検証用会議',start:{dateTime:new Date(Date.now()+300000).toISOString()}}];
        const options={enabled:true,minutes:15,connected:true,available:true,idle:true};
        timerService.start(60000);const timerId=timerService.current.id;
        await reminders.tick(options);await reminders.tick({...options,idle:false});assert.equal(reminderRows.length,0);
        await reminders.tick(options);assert.equal(reminderRows.length,1);assert.equal(timerService.current.id,timerId);assert.equal(state,'PAUSED');assert.equal(conversation.messages.length,0);
        await js("document.getElementById('settings-toggle').click()");await new Promise(r=>setTimeout(r,200));
        fs.writeFileSync(path.join(app.getPath('userData'),'home-preview.png'),(await win.webContents.capturePage()).toPNG());
        await act('reminder-dismiss');assert.equal(reminderRows.length,0);await reminders.tick(options);assert.equal(reminderRows.length,0);
        reminders.reset();reminders.fetch=originalFetch;reminders.save=originalSave;stopTimer();settings=originalSettings;saveSettings(settingsFile,settings);publish();
        assert.ok(!fs.readFileSync(path.join(app.getPath('userData'),'logs/desktop.jsonl'),'utf8').includes('通知検証用会議'));
        result.remindersAndSettings=true;
      }
      if(process.argv.includes('--weather-test')) {
        const until=async predicate=>{const end=Date.now()+12000;while(!predicate()&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert.ok(predicate(),'Weather integration wait failed');};
        const originalAsk=answerCycle.options.ask,originalRequest=weather.request,originalSettings=settings;
        answerCycle.options.ask=()=>assert.fail('Weather must not use Ollama');
        settings={...settings,speech_enabled:false,weather_location:null};
        await act('ask-text','今日の天気');await until(()=>state==='PAUSED'&&!manualAnswer);
        assert.match(answerNotice,/未設定/);result.weatherUnset=true;
        weatherCandidates=[{id:1853909,name:'天気検証地域',admin:'大阪府',country:'JP',latitude:34.69,longitude:135.5}];
        assert.ok((await act('weather-select',1853909)).ok);
        assert.equal(JSON.parse(fs.readFileSync(settingsFile,'utf8')).weather_location.id,1853909);
        const dates=Array.from({length:7},(_,i)=>new Date(Date.now()+9*3600000+i*86400000).toISOString().slice(0,10));
        const fixture={daily:{time:dates,weather_code:Array(7).fill(61),temperature_2m_max:Array(7).fill(25),temperature_2m_min:Array(7).fill(18),precipitation_probability_max:Array(7).fill(80)},current:{time:dates[0]+'T12:00',weather_code:61,temperature_2m:22,apparent_temperature:23,wind_speed_10m:2}};
        weather.request=async()=>fixture;
        for(const question of ['今日の天気','明日の雨','明後日の気温','今週の天気','現在の天気','傘は必要']) {
          await act('ask-text',question);await until(()=>state==='PAUSED'&&!manualAnswer);
          assert.match(answer,/天気検証地域/);assert.match(answer,/Open-Meteo/);assert.equal(conversation.messages.length,0);
        }
        result.weatherPeriods=true;
        win.showInactive();await win.webContents.executeJavaScript("document.getElementById('settings-toggle').click();document.getElementById('settings-weather').click();document.getElementById('weather-settings').scrollIntoView({block:'center'})");
        await new Promise(r=>setTimeout(r,300));
        fs.writeFileSync(path.join(app.getPath('userData'),'weather-preview.png'),(await win.webContents.capturePage()).toPNG());win.hide();
        weather.clear();let release;weather.request=()=>new Promise(resolve=>release=resolve);
        timerService.start(60000);const timerId=timerService.current.id;
        await act('ask-text','今日の天気');await until(()=>state==='WEATHER'&&!!release);
        await act('cancel-input');release(fixture);await new Promise(r=>setTimeout(r,100));
        assert.equal(state,'PAUSED');assert.equal(answer,'');assert.equal(timerService.current.id,timerId);assert.equal(weather.cache,null);
        result.weatherCancelAndTimer=true;stopTimer();
        weather.request=async()=>{throw new WeatherError('天気サービスに接続できません。');};
        await act('ask-text','今日の天気');await until(()=>state==='PAUSED'&&!manualAnswer);assert.match(answerNotice,/接続できません/);
        assert.ok((await act('weather-clear')).ok);assert.equal(settings.weather_location,null);result.weatherFailureAndClear=true;
        assert.ok(!fs.readFileSync(path.join(app.getPath('userData'),'logs/desktop.jsonl'),'utf8').includes('天気検証地域'));result.weatherPrivate=true;
        settings=originalSettings;saveSettings(settingsFile,settings);weather.request=originalRequest;answerCycle.options.ask=originalAsk;weather.clear();publish();
      }
      if(process.argv.includes('--calendar-test')) {
        const until=async predicate=>{const end=Date.now()+12000;while(!predicate()&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert.ok(predicate(),'Calendar integration wait failed');};
        const originalAsk=answerCycle.options.ask,originalRequest=calendar.request;
        answerCycle.options.ask=()=>assert.fail('Calendar questions must not use Ollama');
        settings={...settings,speech_enabled:false};
        await act('ask-text','今日の予定を教えて');await until(()=>state==='PAUSED'&&!manualAnswer);
        assert.match(answerNotice,/未接続/);assert.equal(answer,'');result.calendarNotConnected=true;
        calendar.importClient(JSON.stringify({installed:{client_id:'test.apps.googleusercontent.com',client_secret:'synthetic-secret'}}));
        calendar.save({...calendar.data,refreshToken:'synthetic-refresh-token'});
        assert.ok(!fs.readFileSync(calendar.file).includes(Buffer.from('synthetic-refresh-token')));
        calendar.request=async url=>url.endsWith('/token')?{access_token:'synthetic-access-token'}:{items:[{summary:'カレンダー検証用会議',start:{dateTime:new Date(Date.parse(new URL(url).searchParams.get('timeMin'))+3600000).toISOString()},end:{dateTime:new Date(Date.parse(new URL(url).searchParams.get('timeMin'))+7200000).toISOString()}}]};
        for(const question of ['今日の予定','明日の予定を教えて','今週の予定','来週の予定','今月の予定','来月の予定','次の予定はいつ','明後日の予定','来週の月曜日の予定','10月15日の予定']) {
          await act('ask-text',question);await until(()=>state==='PAUSED'&&!manualAnswer);assert.match(answer,/カレンダー検証用会議/);assert.equal(conversation.messages.length,0);
        }
        result.calendarPeriods=true;
        result.extendedCalendarPeriods=true;
        assert.ok(await win.webContents.executeJavaScript("document.body.innerText.includes('カレンダー検証用会議')"));
        win.showInactive();
        await win.webContents.executeJavaScript("document.getElementById('settings-toggle').click();document.getElementById('settings-calendar').click();document.getElementById('calendar-settings').scrollIntoView({block:'center'})");
        await new Promise(r=>setTimeout(r,300));
        fs.writeFileSync(path.join(app.getPath('userData'),'calendar-preview.png'),(await win.webContents.capturePage()).toPNG());
        win.hide();
        let release;
        calendar.request=async url=>url.endsWith('/token')?{access_token:'test'}:new Promise(resolve=>release=resolve);
        timerService.start(60000);const timerId=timerService.current.id;
        await act('ask-text','今日の予定');await until(()=>state==='CALENDAR'&&!!release);
        await act('cancel-input');release({items:[]});await new Promise(r=>setTimeout(r,100));
        assert.equal(state,'PAUSED');assert.equal(answer,'');assert.equal(timerService.current.id,timerId);assert.equal(timerService.current.status,'running');result.calendarCancelAndTimer=true;
        stopTimer();calendar.request=originalRequest;answerCycle.options.ask=originalAsk;
        calendar.data={};fs.unlinkSync(calendar.file);clearConversation();publish();
        assert.ok(!fs.readFileSync(path.join(app.getPath('userData'),'logs/desktop.jsonl'),'utf8').includes('カレンダー検証用会議'));result.calendarPrivate=true;
      }
      if(process.argv.includes('--timer-test')) {
        settings={...settings,speech_enabled:false,response_volume:.5};
        const until=async predicate=>{const end=Date.now()+12000;while(!predicate()&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert.ok(predicate(),'Timer integration wait failed');};
        const originalAsk=answerCycle.options.ask;answerCycle.options.ask=()=>assert.fail('Timer must not use LLM');
        await act('ask-text','30秒測って');await until(()=>state==='PAUSED'&&!manualAnswer);
        assert.equal(timerService.current.durationMs,30000);const id=timerService.current.id;
        assert.equal(conversation.messages.length,0);await act('new-conversation');await act('toggle',false);
        assert.equal(timerService.current.id,id);await act('ask-text','タイマーの残り時間を教えて');await until(()=>state==='PAUSED'&&!manualAnswer);
        assert.match(answer,/残り/);await act('timer-cancel');assert.equal(timerService.current,null);result.timerCommands=true;
        await act('ask-text','2秒測って');await until(()=>state==='PAUSED'&&!manualAnswer);
        let release;answerCycle.options.ask=()=>new Promise(r=>release=r);
        await act('ask-text','回答待ちとタイマーの並行テスト');await until(()=>!!release);
        const waiting=answerCycle.current;await until(()=>timerService.current.status==='finished');
        assert.equal(state,'THINKING');assert.equal(answerCycle.current,waiting);assert.equal(timerAlarmStarted,0);
        assert.ok(pendingAlarm!==null);result.timerDoesNotInterruptAnswer=true;
        release({text:'検証用の回答です。'});await until(()=>timerAlarmStarted===1);await until(()=>state==='PAUSED'&&!alarmRun);
        assert.match(timerNotice,/時間になりました/);assert.equal(answer,'検証用の回答です。');
        assert.equal(settings.monitoring_enabled,false);result.timerAlarmAfterAnswer=true;
        win.showInactive();await new Promise(r=>setTimeout(r,250));
        assert.ok(await win.webContents.executeJavaScript("document.body.innerText.includes('時間になりました')"));
        fs.writeFileSync(path.join(app.getPath('userData'),'timer-preview.png'),(await win.webContents.capturePage()).toPNG());
        await act('timer-dismiss');assert.equal(timerService.current,null);
        timerCommand({type:'start',durationMs:1000});powerMonitor.emit('lock-screen');await until(()=>state==='SUSPENDED');
        await until(()=>timerService.current.status==='finished');assert.equal(timerAlarmStarted,1);assert.ok(pendingAlarm!==null);
        powerMonitor.emit('unlock-screen');await until(()=>timerAlarmStarted===2);await until(()=>state==='PAUSED'&&!alarmRun);
        result.timerLockDeferred=true;await act('timer-dismiss');
        settings.response_volume=0;timerCommand({type:'start',durationMs:1000});await until(()=>timerService.current.status==='finished'&&pendingAlarm===null);
        assert.equal(timerAlarmStarted,2);assert.equal(state,'PAUSED');result.timerMute=true;await act('timer-dismiss');
        settings.response_volume=.5;settings.speech_enabled=true;answer='読み上げとタイマーが同時に動いても、通知音は読み上げが終わるまで待ちます。'.repeat(4);
        const speaking=readAnswer();timerCommand({type:'start',durationMs:1000});await until(()=>timerService.current.status==='finished');
        assert.equal(state,'SPEAKING');assert.equal(timerAlarmStarted,2);await act('stop-speech');await speaking;
        await until(()=>timerAlarmStarted===3);await until(()=>state==='PAUSED'&&!alarmRun);result.timerDefersDuringSpeech=true;
        await until(()=>timerAlarmStarted===4);await until(()=>state==='PAUSED'&&!alarmRun);result.timerRepeats=true;
        await act('timer-dismiss');answerCycle.options.ask=originalAsk;
        await new Promise(r=>setTimeout(r,5600));assert.equal(timerAlarmStarted,4);result.timerRepeatStops=true;
      }
      if(process.argv.includes('--conversation-test')) {
        settings={...settings,speech_enabled:false};
        const idle=async()=>{
          const end=Date.now()+110000;
          while((manualAnswer || answerCycle.current || !['PAUSED','LISTENING'].includes(state)) && Date.now()<end)await new Promise(r=>setTimeout(r,30));
          assert.equal(state,'PAUSED');
        };
        await act('ask-text','私の好きな果物はマンゴーです。覚えてください。一文で短く返事してください。');await idle();
        assert.equal(conversation.messages.length,2,answerNotice);
        await act('ask-text','私の好きな果物は何ですか？果物名だけ答えてください。');await idle();
        assert.ok(answer.includes('マンゴー'),'Follow-up did not use previous context');
        assert.equal(conversation.messages.length,4);result.followUpContext=true;
        win.showInactive();await new Promise(r=>setTimeout(r,200));
        await win.webContents.executeJavaScript("document.querySelector('details').open=true");
        assert.ok(await win.webContents.executeJavaScript("document.body.innerText.includes('マンゴー')"));
        await new Promise(r=>setTimeout(r,200));
        fs.writeFileSync(path.join(app.getPath('userData'),'conversation-preview.png'),(await win.webContents.capturePage()).toPNG());
        await act('new-conversation');assert.equal(conversation.messages.length,0);assert.equal(answer,'');
        assert.equal(transcript,'');result.newConversationClears=true;
        const originalAsk=answerCycle.options.ask;let release;
        answerCycle.options.ask=()=>new Promise(r=>release=r);
        await act('ask-text','取消検証用の質問');
        const end=Date.now()+5000;while(!release && Date.now()<end)await new Promise(r=>setTimeout(r,10));
        assert.ok(release);await act('new-conversation');release({text:'遅延回答'});
        await new Promise(r=>setTimeout(r,100));assert.equal(conversation.messages.length,0);assert.equal(answer,'');
        answerCycle.options.ask=originalAsk;result.resetDuringGeneration=true;
        conversation.commit('検証',{text:'一時的な回答'},conversation.version);publish();
        powerMonitor.emit('lock-screen');
        const lockEnd=Date.now()+5000;while(state!=='SUSPENDED' && Date.now()<lockEnd)await new Promise(r=>setTimeout(r,10));
        assert.equal(conversation.messages.length,0);assert.equal(state,'SUSPENDED');
        powerMonitor.emit('unlock-screen');await idle();result.lockClearsHistory=true;
        const originalIdle=conversation.idleMs;conversation.idleMs=30;
        conversation.commit('検証',{text:'時間切れ検証'},conversation.version);answer='時間切れ検証';
        setState('PAUSED');await new Promise(r=>setTimeout(r,100));
        assert.equal(conversation.messages.length,0);assert.equal(answer,'');conversation.idleMs=originalIdle;
        result.idleExpiry=true;
      }
      if(process.argv.includes('--speech-test')) {
        settings={...settings,speech_enabled:true,response_volume:.5};
        answer='こんにちは。読み上げの動作確認です。';transcript='挨拶してください。';
        await readAnswer();assert.equal(speechNotice,'');assert.ok(speechStarted>0);
        await reconcile();assert.equal(state,'PAUSED');
        result.speechCompleted=true;
        result.voices=await win.webContents.executeJavaScript("speechSynthesis.getVoices().filter(v=>v.localService && /^ja/i.test(v.lang)).map(v=>({name:v.name,lang:v.lang,local:v.localService}))");
        const preferred=await win.webContents.executeJavaScript("speechSynthesis.getVoices().find(v=>v.localService && /^ja/i.test(v.lang)).voiceURI");
        await act('speech-voice',preferred);await act('speech-rate',.9);
        assert.equal(readSettings(settingsFile).settings.speech_voice,preferred);assert.equal(readSettings(settingsFile).settings.speech_rate,.9);
        const savedAnswer=answer,startedBeforePreview=speechStarted;
        await act('test-speech');
        const previewDeadline=Date.now()+30000;
        while((manualAnswer||state==='SPEAKING')&&Date.now()<previewDeadline)await new Promise(r=>setTimeout(r,30));
        assert.equal(state,'PAUSED');assert.equal(speechNotice,'');assert.equal(answer,savedAnswer);assert.equal(speechStarted,startedBeforePreview+1);
        result.speechPreferencesAndPreview=true;
        await act('speech-voice','');await act('speech-rate',1);
        const initial=speechStarted;
        answer='読み上げの途中停止を確認します。'.repeat(20);
        const speaking=readAnswer();
        const end=Date.now()+5000;
        while(speechStarted===initial && Date.now()<end)await new Promise(r=>setTimeout(r,20));
        assert.ok(speechStarted>initial);await act('stop-speech');await speaking;
        assert.equal(state,'PAUSED');assert.ok(answer);assert.equal(speechRun,null);assert.equal(speechAudio.pending,null);
        await new Promise(r=>setTimeout(r,800));assert.equal(state,'PAUSED');result.speechStopPreservesAnswer=true;
        await act('speech-enabled',false);assert.equal(readSettings(settingsFile).settings.speech_enabled,false);
        const before=speechStarted;await readAnswer();assert.equal(speechStarted,before);
        await act('speech-enabled',true);settings.response_volume=0;await readAnswer();assert.equal(speechStarted,before);
        result.speechOffAndMute=true;settings.response_volume=.5;
        const lockedSpeech=readAnswer();powerMonitor.emit('lock-screen');await lockedSpeech;
        const lockedEnd=Date.now()+5000;
        while(state!=='SUSPENDED' && Date.now()<lockedEnd)await new Promise(r=>setTimeout(r,20));
        assert.equal(state,'SUSPENDED');assert.equal(answer,'');assert.equal(speechAudio.pending,null);
        powerMonitor.emit('unlock-screen');
        const unlockEnd=Date.now()+5000;
        while(state!=='PAUSED' && Date.now()<unlockEnd)await new Promise(r=>setTimeout(r,20));
        assert.equal(state,'PAUSED');result.speechLockClears=true;
      }
      if (process.argv.includes('--answer-test')) {
        const speechBefore=speechStarted;
        const question='日本語で一文だけ答えてください。2足す3はいくつですか？';
        assert.ok((await win.webContents.executeJavaScript(`window.jarvis.action('ask-text',${JSON.stringify(question)})`)).ok);
        const end=Date.now()+290000;
        while((manualAnswer || answerCycle.current || ['THINKING','SPEAKING'].includes(state)) && Date.now()<end)await new Promise(r=>setTimeout(r,50));
        assert.equal(state,'PAUSED',answerNotice);assert.match(answer,/5|５|五/);
        assert.ok(answer.length<200,answer);assert.equal(settings.monitoring_enabled,false);
        result.localAnswer=true;result.answerText=answer;
        if(process.argv.includes('--speech-test')) {
          assert.equal(speechNotice,'');assert.ok(speechStarted>speechBefore);result.aiAnswerSpoken=true;
        }
        win.showInactive();await new Promise(r=>setTimeout(r,350));
        assert.ok(await win.webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(answer)})`));
        fs.writeFileSync(path.join(app.getPath('userData'),'answer-preview.png'),(await win.webContents.capturePage()).toPNG());
        await act('clear-transcript');assert.equal(answer,'');assert.equal(transcript,'');
        await act('ask-text','作業の整理方法を詳しく説明してください。');
        const cancelEnd=Date.now()+5000;
        while(!answerCycle.current && Date.now()<cancelEnd)await new Promise(r=>setTimeout(r,10));
        assert.ok(answerCycle.current);await act('cancel-input');
        await new Promise(r=>setTimeout(r,300));
        assert.equal(state,'PAUSED');assert.equal(answer,'');assert.equal(answerCycle.current,null);
        assert.equal(settings.monitoring_enabled,false);result.answerCancelAndClear=true;
      }
      if (process.argv.includes('--transcript-ui-test')) {
        transcript='明日の予定を教えてください。';publish();
        await new Promise(r=>setTimeout(r,150));
        assert.ok(await win.webContents.executeJavaScript('document.body.innerText.includes("明日の予定を教えてください。")'));
        await act('clear-transcript');assert.equal(transcript,'');
        transcript='明日の予定を教えてください。';publish();
        result.transcriptRenderAndClear=true;
      }
      if (process.argv.includes('--smoke-mic-test')) {
        const device = devices.find(d => d.name === 'マイク (Realtek(R) Audio)' && d.hostapi === 'Windows WASAPI');
        assert.ok(device, 'Test microphone missing');
        assert.ok((await act('device', device)).ok);
        if(process.argv.includes('--timer-test')) {
          const until=async target=>{const end=Date.now()+12000;while(state!==target&&Date.now()<end)await new Promise(r=>setTimeout(r,15));assert.equal(state,target);};
          await act('toggle',true);const previousEpoch=epoch;
          timerCommand({type:'start',durationMs:1000});await until('TIMER_ALERT');
          assert.equal(epoch,null);assert.equal(await acceptDetection({epoch:previousEpoch,score:.99}),false);
          await until('LISTENING');assert.equal(settings.monitoring_enabled,true);result.timerMicResumes=true;
          await act('timer-dismiss');timerCommand({type:'start',durationMs:1000});await until('TIMER_ALERT');
          await act('toggle',false);await new Promise(r=>setTimeout(r,1200));
          assert.equal(state,'PAUSED');assert.equal(alarmRun,null);assert.equal(timerAudio.pending,null);
          result.timerStopPreservesPause=true;await act('timer-dismiss');
        }
        for (let i=0; i<2; i++) {
          assert.ok((await act('toggle', true)).ok); assert.equal(state, 'LISTENING');
          await new Promise(r => setTimeout(r, 600));
          assert.ok((await act('toggle', false)).ok); assert.equal(state, 'PAUSED');
        }
        assert.equal(readSettings(settingsFile).settings.monitoring_enabled, false);
        await restart(); assert.equal(state, 'PAUSED');
        result.resumePauseRestart = true;
        if(process.argv.includes('--phase4-test')) {
          const until=async target=>{const end=Date.now()+40000;while(state!==target&&Date.now()<end)await new Promise(r=>setTimeout(r,50));assert.equal(state,target,error);};
          await act('toggle',true);
          client.child.kill();await until('RECOVERING');await until('LISTENING');
          assert.equal(recovery.count,1);result.automaticRecovery=true;
          client.child.kill();await until('RECOVERING');await act('toggle',false);
          await new Promise(r=>setTimeout(r,2200));assert.equal(state,'PAUSED');result.cancelRecovery=true;
          await act('toggle',true);await until('LISTENING');
          powerMonitor.emit('lock-screen');await until('SUSPENDED');
          powerMonitor.emit('suspend');powerMonitor.emit('resume');
          await new Promise(r=>setTimeout(r,250));assert.equal(state,'SUSPENDED');
          powerMonitor.emit('unlock-screen');await until('LISTENING');
          await act('toggle',false);
          powerMonitor.emit('lock-screen');await until('SUSPENDED');
          powerMonitor.emit('unlock-screen');await until('PAUSED');
          assert.equal(settings.monitoring_enabled,false);result.sessionStatePreserved=true;
        }
        if (process.argv.includes('--response-test')) {
          assert.ok((await act('toggle',true)).ok);
          const previous=count;
          const detected={epoch,score:.99};
          const completed=acceptDetection(detected);
          assert.equal(state,'ACTIVATED');
          assert.equal(await acceptDetection(detected),false);
          assert.ok(await completed);
          assert.equal(state,'LISTENING'); assert.equal(count,previous+1);
          assert.ok(lastDetection.audio_start_ms>=0, 'Audio playback did not start');
          result.responseAudioStartMs=lastDetection.audio_start_ms;
          const interrupted=acceptDetection({epoch,score:.99});
          await new Promise(r=>setTimeout(r,350));
          await act('toggle',false); await interrupted;
          assert.equal(state,'PAUSED'); assert.equal(response.current,null);
          assert.equal(responseAudio.pending,null);
          await new Promise(r=>setTimeout(r,900)); assert.equal(state,'PAUSED');
          result.responseCycle=true;
          result.stopDuringResponse=true;
          await act('toggle',true);
          const captureRun=acceptDetection({epoch,score:.99});
          const captureEnd=Date.now()+10000;
          while(state!=='CAPTURING' && Date.now()<captureEnd) await new Promise(r=>setTimeout(r,20));
          assert.equal(state,'CAPTURING');
          await act('cancel-input');await captureRun;
          assert.equal(state,'LISTENING');assert.equal(questionInput.current,null);
          const stopRun=acceptDetection({epoch,score:.99});
          const stopEnd=Date.now()+10000;
          while(state!=='CAPTURING' && Date.now()<stopEnd) await new Promise(r=>setTimeout(r,20));
          assert.equal(state,'CAPTURING');
          await act('toggle',false);await stopRun;
          assert.equal(state,'PAUSED');assert.equal(questionInput.current,null);
          result.questionCancelAndStop=true;
        }
      }
      if (process.argv.includes('--hold-test')) {
        if (process.argv.includes('--smoke-mic-test')) await act('toggle', true);
        fs.writeFileSync(path.join(app.getPath('userData'), 'hold.json'), JSON.stringify({parent:process.pid, worker:client.child.pid, state}));
        return;
      }
      // Hidden windows may retain an old compositor frame despite updated DOM.
      if (process.argv.includes('--transcript-ui-test')) win.showInactive();
      await win.webContents.executeJavaScript('new Promise(r => setTimeout(r, 300))');
      fs.writeFileSync(path.join(app.getPath('userData'), 'preview.png'), (await win.webContents.capturePage()).toPNG());
      win.close(); result.closeHidesWindow = !win.isDestroyed() && !win.isVisible();
      result.workerStillReady = !!client?.ready;
      assert.ok(result.closeHidesWindow && result.workerStillReady);
      fs.writeFileSync(path.join(app.getPath('userData'), 'smoke.json'), JSON.stringify(result, null, 2));
      app.quit();
    }
  }).catch(async e => { log('fatal', {message:e.stack}); await client?.stop(); app.exit(1); });
}
