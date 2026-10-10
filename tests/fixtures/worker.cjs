const readline = require('node:readline');
const emit = x => process.stdout.write(JSON.stringify({version:1,event_id:'fixture',...x})+'\n');
emit({type:'ready',devices:[]});
readline.createInterface({input:process.stdin}).on('line', raw => {
  const m=JSON.parse(raw);
  if(m.type==='shutdown') {emit({type:'ack',request_id:m.request_id}); process.exit(0);}
  if(m.type==='ping' && !m.ignore) emit({type:'pong',request_id:m.request_id});
}).on('close',()=>process.exit(0));
