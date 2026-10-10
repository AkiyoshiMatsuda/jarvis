function loginOptions(executable) {
  return {name:'JARVIS Local',path:executable,args:['--login-start']};
}
function setLogin(app,enabled,options=loginOptions(process.execPath)) {
  app.setLoginItemSettings({...options,openAtLogin:enabled,enabled});
  const items=app.getLoginItemSettings({path:options.path,args:options.args}).launchItems;
  if(enabled ? !isEnabled(items,options) : items.some(item=>item.name===options.name && item.scope==='user'))
    throw Error('自動起動の登録を確認できませんでした。Windowsの「設定 → アプリ → スタートアップ」で JARVIS Local を確認してください。');
}
function readLogin(app,options=loginOptions(process.execPath)) {
  const actual=app.getLoginItemSettings({path:options.path,args:options.args});
  return isEnabled(actual.launchItems,options);
}
function isEnabled(items,options) {
  // openAtLogin checks the default AppUserModelId, not our custom registry name.
  return items.some(item=>item.name===options.name && item.scope==='user' && item.enabled &&
    item.path.replace(/^"|"$/g,'').toLowerCase()===options.path.toLowerCase());
}
module.exports={loginOptions,setLogin,readLogin};
