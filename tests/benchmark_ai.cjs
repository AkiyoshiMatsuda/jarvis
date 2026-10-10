// Uses only synthetic prompts. Compare cold loads with warm repeated requests.
const fs=require('node:fs');const {localJSON,MODEL,askLocal}=require('../desktop/answer.cjs');const {createOllamaStarter}=require('../desktop/ollama.cjs');
(async()=>{await createOllamaStarter()({});const rows=[];
 const info=await localJSON('/api/show',{model:MODEL});if(info.remote_host||info.details?.format!=='gguf')throw Error('Local model required');
 for(const mode of ['cold','warm']){
   await localJSON('/api/generate',{model:MODEL,keep_alive:0});
   for(let i=0;i<3;i++){let first=null;const start=performance.now();const result=await askLocal('こんにちは。一文で挨拶してください。',{keepAlive:mode==='cold'?0:'10m',onPartial:text=>{if(text&&first===null)first=performance.now()-start;}});rows.push({mode,run:i+1,firstMs:Math.round(first??0),totalMs:Math.round(performance.now()-start),...result.timing});console.log(JSON.stringify(rows.at(-1)));}
 }
 fs.writeFileSync('validation/ai-speed.json',JSON.stringify(rows,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
