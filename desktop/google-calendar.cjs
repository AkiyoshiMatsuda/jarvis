const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {randomBytes,createHash}=require('node:crypto');
const {SCOPE,CalendarError,googleJSON,fetchCalendar}=require('./calendar.cjs');
function parseClient(text) {
  let data;try{data=JSON.parse(text).installed;}catch{}
  if(!data||typeof data.client_id!=='string'||!/^[-\w.]+\.apps\.googleusercontent\.com$/.test(data.client_id)||
    typeof data.client_secret!=='string'||!data.client_secret||data.client_secret.length>500)
    throw new CalendarError('Google Cloudで作成した「デスクトップアプリ」用のJSONを選択してください。');
  return {client_id:data.client_id,client_secret:data.client_secret};
}
function authorize(client,{openExternal,signal,timeoutMs=180000}={}) {
  return new Promise((resolve,reject)=>{
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
    let settled=false,timer;
    const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);server.close();server.closeAllConnections();err?reject(err):resolve(value);};
    const abort=()=>finish(new CalendarError('Googleへの接続を取り消しました。'));
    const server=http.createServer((req,res)=>{
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.method!=='GET'||url.pathname!=='/oauth2callback'||url.searchParams.get('state')!==state){res.writeHead(400);res.end('Invalid callback');return;}
      const code=url.searchParams.get('code');
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'"});
      // Let the browser receive the response before closing its socket.
      res.on('finish',()=>finish(!code||url.searchParams.has('error')?new CalendarError('Googleへのアクセスが許可されませんでした。'):null,
        {code,code_verifier:verifier,redirect_uri:`http://127.0.0.1:${server.address()?.port}/oauth2callback`}));
      res.end('認証結果を受け取りました。このタブを閉じ、JARVISの接続状態を確認してください。');
    });
    server.on('error',()=>finish(new CalendarError('認証の受付を開始できませんでした。')));
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    server.listen(0,'127.0.0.1',()=>{
      const query=new URLSearchParams({client_id:client.client_id,redirect_uri:`http://127.0.0.1:${server.address().port}/oauth2callback`,
        response_type:'code',scope:SCOPE,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:'consent'});
      Promise.resolve().then(()=>openExternal('https://accounts.google.com/o/oauth2/v2/auth?'+query)).catch(()=>finish(new CalendarError('ブラウザーを開けませんでした。')));
    });
    timer=setTimeout(()=>finish(new CalendarError('接続待ちが3分を超えました。もう一度接続してください。')),timeoutMs);
  });
}
class GoogleCalendar {
  constructor({file,safeStorage,openExternal,onChange=()=>{},request=googleJSON,auth=authorize}) {
    Object.assign(this,{file,safeStorage,openExternal,onChange,request,auth});this.data={};this.message='';this.pending=null;
  }
  load() {
    if(!fs.existsSync(this.file))return;
    try{this.data=JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.file)));parseClient(JSON.stringify({installed:this.data.client}));}
    catch{this.data={};this.message='保存された接続設定を開けませんでした。認証設定を読み込み直してください。';}
  }
  save(data) {
    if(!this.safeStorage.isEncryptionAvailable())throw new CalendarError('Windowsの資格情報保護を利用できないため接続設定を保存できません。');
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const temp=this.file+'.tmp';fs.writeFileSync(temp,this.safeStorage.encryptString(JSON.stringify(data)));fs.renameSync(temp,this.file);this.data=data;
  }
  snapshot(){return {configured:!!this.data.client,connected:!!this.data.refreshToken,pending:!!this.pending,message:this.message};}
  importClient(text) {
    if(this.pending||this.data.refreshToken)throw new CalendarError('接続を解除してから設定を変更してください。');
    this.save({client:parseClient(text)});this.message='認証設定を読み込みました。「Googleに接続」を押してください。';this.onChange();
  }
  async connect() {
    if(this.pending)return;
    if(!this.data.client)throw new CalendarError('先に認証設定JSONを読み込んでください。');
    const controller=new AbortController();this.pending=controller;this.message='ブラウザーでGoogleへのアクセスを許可してください。';this.onChange();
    try {
      const code=await this.auth(this.data.client,{openExternal:this.openExternal,signal:controller.signal});
      const tokens=await this.request('https://oauth2.googleapis.com/token',{form:{...this.data.client,...code,grant_type:'authorization_code'},signal:controller.signal});
      controller.signal.throwIfAborted();
      if(!tokens.refresh_token||!tokens.access_token||!tokens.scope?.split(' ').includes(SCOPE))throw new CalendarError('カレンダーの読み取り権限を確認できませんでした。接続し直してください。');
      this.save({...this.data,refreshToken:tokens.refresh_token});this.message='メインカレンダーに接続しました。';
    } catch(e){if(this.pending===controller)this.message=e instanceof CalendarError?e.message:'Googleへの接続を完了できませんでした。';}
    finally{if(this.pending===controller)this.pending=null;this.onChange();}
  }
  cancel(){if(!this.pending)return;this.pending.abort();this.pending=null;this.message='接続を取り消しました。';this.onChange();}
  async disconnect() {
    this.cancel();const token=this.data.refreshToken;this.save({client:this.data.client});this.message='このPCの接続を解除しました。';this.onChange();
    if(token)try{await this.request('https://oauth2.googleapis.com/revoke',{form:{token}});}catch{this.message='このPCの接続は解除しました。Google側の権限解除はGoogleアカウントの接続一覧で行ってください。';this.onChange();}
  }
  async ask(kind,{signal,raw=false}={}) {
    if(!this.data.refreshToken)throw new CalendarError('Googleカレンダーに未接続です。画面の「Googleカレンダー」から接続してください。');
    const tokens=await this.request('https://oauth2.googleapis.com/token',{form:{...this.data.client,refresh_token:this.data.refreshToken,grant_type:'refresh_token'},signal});
    signal?.throwIfAborted();
    if(typeof tokens.access_token!=='string'||!tokens.access_token)throw new CalendarError('Googleの認証を更新できませんでした。接続し直してください。');
    return fetchCalendar(kind,{accessToken:tokens.access_token,signal,request:this.request,raw});
  }
}
module.exports={parseClient,authorize,GoogleCalendar};
