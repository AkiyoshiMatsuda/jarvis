const { StringDecoder } = require('node:string_decoder');
const fs = require('node:fs');
const path = require('node:path');

class JsonLines {
  constructor(onMessage) { this.buffer = ''; this.decoder = new StringDecoder('utf8'); this.onMessage = onMessage; }
  push(chunk) {
    this.buffer += this.decoder.write(chunk);
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i); this.buffer = this.buffer.slice(i + 1);
      if (Buffer.byteLength(line) > 65536) throw Error('Worker message too large');
      const obj = JSON.parse(line);
      if (!obj || obj.version !== 1 || typeof obj.event_id !== 'string' ||
          !['ready','ack','pong','state_changed','detected','error','audio_gap','capture_done','transcription_started'].includes(obj.type))
        throw Error('Invalid worker message');
      this.onMessage(obj);
    }
    if (Buffer.byteLength(this.buffer) > 65536) throw Error('Worker message too large');
  }
}
function defaults() { return {version: 1, monitoring_enabled: false, device: null, threshold: .5, cooldown: 2, response_volume: .8, auto_start:false, speech_enabled:true, speech_voice:'',speech_rate:1}; }
function validate(s) {
  const volume=s?.response_volume ?? .8;
  const autoStart=s?.auto_start ?? false;
  const speechEnabled=s?.speech_enabled ?? true;
  const speechVoice=s?.speech_voice??'',speechRate=s?.speech_rate??1;
  if(typeof speechVoice!=='string'||speechVoice.length>512||!Number.isFinite(speechRate)||speechRate<.8||speechRate>1.2)throw Error('Invalid speech voice/rate');
  if(typeof speechEnabled!=='boolean') throw Error('Invalid speech setting');
  if(typeof autoStart!=='boolean') throw Error('Invalid startup setting');
  if (!s || s.version !== 1 || typeof s.monitoring_enabled !== 'boolean' ||
      !Number.isFinite(s.threshold) || s.threshold <= 0 || s.threshold > 1 ||
      !Number.isFinite(s.cooldown) || s.cooldown < 0 || s.cooldown > 60 ||
      !(s.device === null || (typeof s.device?.name === 'string' && typeof s.device?.hostapi === 'string')) ||
      (s.monitoring_enabled && !s.device) || !Number.isFinite(volume) || volume<0 || volume>1) throw Error('Invalid settings');
  return {version: 1, monitoring_enabled: s.monitoring_enabled, device: s.device,
          threshold: s.threshold, cooldown: s.cooldown, response_volume:volume, auto_start:autoStart, speech_enabled:speechEnabled,speech_voice:speechVoice,speech_rate:speechRate};
}
function readSettings(file) {
  if (!fs.existsSync(file)) return {settings: defaults(), warning: ''};
  try { return {settings: validate(JSON.parse(fs.readFileSync(file, 'utf8'))), warning: ''}; }
  catch { return {settings: defaults(), warning: '設定を読み込めなかったため監視を停止しました。マイクを選び直してください。'}; }
}
function saveSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(validate(settings), null, 2), 'utf8');
  fs.renameSync(temp, file);
}
function diagnosticMessage(message) {
  const {text, ...diagnostic}=message;
  return diagnostic;
}
module.exports = {JsonLines, defaults, validate, readSettings, saveSettings, diagnosticMessage};
