const {test}=require('node:test');const assert=require('node:assert/strict');
const {sourceURL,routeSearch,queryFor,sourcesFrom,selectEvidence,WebSearch,parseDuckHTML}=require('../desktop/web-search.cjs');
const rows=[{title:'公式資料',url:'https://example.com/docs',description:'この機能は日本語に対応しています。登録後に利用できます。'}];
test('search routing respects explicit offline and routes changing facts; greetings stay local',()=>{
 for(const q of ['最新ニュース','今日の為替','おすすめのイヤホン','Nodeの使い方','料金を比較して','犬について調べて','公式サイトを教えて'])assert.equal(routeSearch(q).search,true,q);
 for(const q of ['こんにちは','ありがとう','1足す1は','短い詩を書いて','検索せずに最新技術について答えて'])assert.equal(routeSearch(q).search,false,q);
 assert.ok(routeSearch('最新ニュース','off').blocked);assert.ok(routeSearch('光合成とは','always').search);
 assert.equal(routeSearch('ネットを使わずに答えて','always').search,false);
});
test('query rejects secret-like data and oversized questions',()=>{
 assert.throws(()=>queryFor('api_key=synthetic-valueを検索して'));assert.throws(()=>queryFor('あ'.repeat(601)));assert.equal(queryFor('最新の仕様を検索して'),'最新の仕様を検索して');
});
test('source links only permit public web schemes and normalize duplicates',()=>{
 for(const url of ['javascript:alert(1)','file:///C:/Windows','https://127.0.0.1','http://0x7f000001','https://[::1]/','https://user:pass@example.com','https://example.com:444','http://localhost','http://host.internal'])assert.equal(sourceURL(url),null,url);
 assert.equal(sourceURL('https://example.com/docs#x'),'https://example.com/docs');
 const sources=sourcesFrom([...rows,...rows,{url:'file:///x',description:'bad'}]);assert.equal(sources.length,1);assert.equal(sources[0].id,1);
});
test('model evidence requires exact source excerpts and valid IDs, never model URLs',async()=>{
 const sources=sourcesFrom(rows);const request=async route=>route==='/api/show'?{details:{format:'gguf'}}:{done:true,message:{content:JSON.stringify({points:[{id:1,quote:'この機能は日本語に対応しています。'},{id:9,quote:'捏造された文章です。'},{id:1,quote:'有料版のみ使えます。'}]})}};
 const points=await selectEvidence('日本語対応',sources,{request});assert.equal(points.length,1);assert.equal(points[0].id,1);
 await assert.rejects(()=>selectEvidence('質問',sources,{request:async()=>({remote_host:'cloud'})}));
});
test('search retains sources on local AI failure and never fakes a successful network search',async()=>{
 const service=new WebSearch({search:async()=>rows,select:async()=>{throw Error('Ollama unavailable')}});const result=await service.ask('検索して');
 assert.ok(result.searchMeta.fallback);assert.equal(result.sources.length,1);assert.match(result.text,/自動抽出できません/);
 service.search=async()=>{throw Error('offline')};await assert.rejects(()=>service.ask('検索して'));

});
test('cancellation cannot return stale sources',async()=>{
 const controller=new AbortController();const service=new WebSearch({search:async()=>{controller.abort();return rows},select:()=>assert.fail('cancelled')});await assert.rejects(()=>service.ask('検索して',{signal:controller.signal}));
});
test('free HTML parser unwraps source links, drops ads and detects access challenges',()=>{
 const html='<div class="result results_links result--ad"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fy.js">Ad</a><a class="result__snippet">Ad snippet</a></div><div class="result results_links"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=abc">公式 &amp; 資料</a><a class="result__snippet">日本語の&#x691C;索です。</a></div>';
 const parsed=parseDuckHTML(html);assert.equal(parsed.length,1);assert.equal(parsed[0].url,'https://example.com/docs');assert.equal(parsed[0].title,'公式 & 資料');assert.equal(parsed[0].description,'日本語の検索です。');
 assert.throws(()=>parseDuckHTML('<form id="challenge-form">'),/アクセス確認/);assert.throws(()=>parseDuckHTML('<html>unknown</html>'),/形式/);assert.deepEqual(parseDuckHTML('<div class="no-results">No results found</div>'),[]);
});
