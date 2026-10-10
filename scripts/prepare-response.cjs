const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),file=path.join(root,'ui/public/response.wav');
let valid=false;
try{const meta=JSON.parse(fs.readFileSync(path.join(root,'ui/public/response.json'),'utf8').replace(/^\uFEFF/,''));valid=createHash('sha256').update(fs.readFileSync(file)).digest('hex')===meta.sha256.toLowerCase();}catch{}
if(!valid) {
  if(process.platform!=='win32')throw Error('Generate the fixed response on Windows with a Japanese speech voice installed.');
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'make-response.ps1')],{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.error||result.status!==0)throw Error('Could not generate response.wav. Install a Windows Japanese voice and retry.');
}
