const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {LocalAIError}=require('./answer.cjs');
function probe() {
  return new Promise((resolve,reject)=>{
    const req=http.get({hostname:'127.0.0.1',port:11434,path:'/api/version'},res=>{
      res.resume();res.on('end',()=>res.statusCode===200?resolve():reject(new LocalAIError('Ollamaの応答を確認できません。')));
    });
    req.setTimeout(1500,()=>req.destroy(Error('timeout')));req.on('error',reject);
  });
}
function createOllamaStarter({check=probe,exists=fs.existsSync,launch=spawn,localAppData=process.env.LOCALAPPDATA,wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=40}={}) {
  let starting=null;
  async function start() {
    try {await check();return;} catch(e) {if(e.code!=='ECONNREFUSED')throw new LocalAIError('Ollamaの応答を確認できません。Ollamaの状態を確認してください。');}
    const executable=path.join(localAppData||'', 'Programs','Ollama','ollama.exe');
    if(!localAppData || !exists(executable))throw new LocalAIError('Ollamaが見つかりません。Ollamaをインストールして起動してください。');
    let launchError;
    const child=launch(executable,['serve'],{windowsHide:true,detached:true,stdio:'ignore',env:{...process.env,OLLAMA_HOST:'127.0.0.1:11434'}});
    child.on('error',()=>{launchError=true;});child.unref();
    for(let i=0;i<attempts;i++) {
      if(launchError)break;
      await wait(250);try {await check();return;}catch{}
    }
    throw new LocalAIError('Ollamaを起動できませんでした。スタートメニューからOllamaを起動して再試行してください。');
  }
  return async({signal}={})=>{
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(!starting)starting=start().finally(()=>{starting=null;});
    const task=starting;let abort;
    try {
      await Promise.race([task,new Promise((_,reject)=>{abort=()=>reject(new DOMException('Aborted','AbortError'));signal?.addEventListener('abort',abort,{once:true});})]);
    } finally {if(abort)signal?.removeEventListener('abort',abort);}
  };
}
module.exports={createOllamaStarter,probe};
