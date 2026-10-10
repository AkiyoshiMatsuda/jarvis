const fs=require('node:fs');
class SearchKey {
  constructor(file,safeStorage){this.file=file;this.safeStorage=safeStorage;this.key='';this.warning='';}
  load(){try{if(fs.existsSync(this.file))this.key=this.safeStorage.decryptString(fs.readFileSync(this.file));}catch{this.warning='検索APIキーを復元できません。登録し直してください。';}}
  save(value){if(typeof value!=='string'||!/^[\x21-\x7e]{10,512}$/.test(value))throw Error('APIキーの形式を確認してください。');if(!this.safeStorage.isEncryptionAvailable())throw Error('Windowsの資格情報保護を利用できません。');fs.mkdirSync(require('node:path').dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',this.safeStorage.encryptString(value));fs.renameSync(this.file+'.tmp',this.file);this.key=value;this.warning='';}
  clear(){fs.rmSync(this.file,{force:true});this.key='';this.warning='';}
  snapshot(){return {configured:!!this.key,warning:this.warning};}
}
module.exports={SearchKey};
