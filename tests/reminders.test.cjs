const {test}=require('node:test');const assert=require('node:assert/strict');
const {Reminders}=require('../desktop/reminders.cjs');
const {fetchCalendar}=require('../desktop/calendar.cjs');
const opts={enabled:true,minutes:10,connected:true,available:true,idle:true};
const base=Date.parse('2026-10-10T03:00:00Z');
const event=(id,mins=5)=>({id,summary:'検証',start:{dateTime:new Date(base+mins*60000).toISOString()}});
test('reminders filter, group simultaneous events and persist deduplication across restart',async()=>{
 let delivered=[],saved;const rows=[event('a'),event('b'),event('late',20),event('past',-1),{...event('cancel'),status:'cancelled'},{...event('decline'),attendees:[{self:true,responseStatus:'declined'}]},{id:'all',start:{date:'2026-10-10'}}];
 const r=new Reminders({now:()=>base,fetch:async()=>rows,notify:x=>delivered.push(x),save:x=>saved=x});
 await r.tick(opts);await r.tick({...opts,idle:false});assert.equal(delivered.length,0);
 await r.tick(opts);assert.equal(delivered[0].length,2);await r.tick(opts);assert.equal(delivered.length,1);
 const restarted=new Reminders({now:()=>base,seen:saved,fetch:async()=>rows,notify:()=>assert.fail('duplicate')});await restarted.tick(opts);await restarted.tick(opts);
 assert.ok(!JSON.stringify(saved).includes('検証'));assert.equal(Object.keys(saved).length,2);
});
test('refresh replaces moved/deleted events; failed fetch never delivers stale agenda',async()=>{
 let now=base,rows=[event('a',15)],count=0;const r=new Reminders({now:()=>now,fetch:async()=>rows,notify:()=>count++});
 await r.tick(opts);now+=6*60000;rows=[];await r.tick(opts);await r.tick(opts);assert.equal(count,0);
 rows=[event('a',8)];now+=60000;await r.tick(opts);await r.tick(opts);assert.equal(count,1);
 now+=60000;r.fetch=async()=>{throw Error('secret')};await r.tick(opts);assert.match(r.notice,/更新できません/);assert.equal(r.items.length,0);
});
test('disable/lock/disconnect abort in-flight fetch and never deliver after reset',async()=>{
 for(const change of [{enabled:false},{available:false},{connected:false}]) {
 let release,signal;const r=new Reminders({now:()=>base,fetch:s=>{signal=s;return new Promise(resolve=>release=resolve)},notify:()=>assert.fail('late notification')});
 const pending=r.tick(opts);await r.tick({...opts,...change});assert.ok(signal.aborted);release([event('a')]);await pending;assert.equal(r.items.length,0);
 }
});
test('started events are not notified after a busy interval; persistence failure is visible',async()=>{
 let now=base;const r=new Reminders({now:()=>now,fetch:async()=>[event('a',.5)],notify:()=>assert.fail('expired')});await r.tick(opts);now+=31000;await r.tick(opts);
 const failed=new Reminders({now:()=>base,fetch:async()=>[event('a')],save:()=>{throw Error()},notify:()=>assert.fail('unsaved')});await failed.tick(opts);await failed.tick(opts);assert.match(failed.notice,/保存できません/);
});
test('raw reminder fetch pages expanded events and requests IDs; legacy settings disable reminders',async()=>{
 let calls=0;const rows=await fetchCalendar(null,{raw:true,now:new Date(base),request:async url=>{const q=new URL(url).searchParams;assert.equal(q.get('singleEvents'),'true');assert.match(q.get('fields'),/id,/);return ++calls===1?{items:[event('a')],nextPageToken:'p'}:{items:[event('b')]}}});assert.equal(rows.length,2);
 const {defaults,validate}=require('../desktop/core.cjs');assert.equal(validate(defaults()).reminders_enabled,false);assert.throws(()=>validate({...defaults(),reminder_minutes:3}));
});
