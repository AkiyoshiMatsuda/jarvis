// Opt-in real Windows API test. Uses a unique temporary entry, removed in finally.
const {app}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {setLogin,readLogin}=require('../desktop/login.cjs');
app.whenReady().then(()=>{
  const options={name:`JARVIS-validation-${process.pid}`,path:process.execPath,args:['--login-validation']};
  const folder=path.join(__dirname,'../validation/step-a1');fs.mkdirSync(folder,{recursive:true});
  try {
    app.setLoginItemSettings({...options,openAtLogin:true,enabled:true});
    fs.writeFileSync(path.join(folder,'login-diagnostic.json'),JSON.stringify({options,actual:app.getLoginItemSettings(options)},null,2));
    setLogin(app,true,options);
    assert.equal(readLogin(app,options),true);
    console.log('PASS custom-name startup registration and verification');
    app.setLoginItemSettings({...options,openAtLogin:true,enabled:false});
    assert.equal(readLogin(app,options),false);
    setLogin(app,false,options);
    assert.equal(readLogin(app,options),false);
    console.log('PASS disabled startup detection and removal');
    fs.writeFileSync(path.join(folder,'login.json'),JSON.stringify({at:new Date().toISOString(),passed:true,options,remaining:app.getLoginItemSettings(options).launchItems.filter(i=>i.name===options.name)},null,2));
  } finally {app.setLoginItemSettings({...options,openAtLogin:false});}
}).then(()=>app.exit(0),e=>{console.error(e);app.exit(1);});
