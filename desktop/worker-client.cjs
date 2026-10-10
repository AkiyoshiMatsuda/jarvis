const { spawn, execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { JsonLines } = require('./core.cjs');

class WorkerClient extends EventEmitter {
  constructor(command, args = []) {
    super(); this.command = command; this.args = args; this.child = null;
    this.pending = new Map(); this.ready = false; this.stopping = false;
  }
  async start() {
    if (this.child) throw Error('Worker already started');
    this.stopping = false;
    const child = spawn(this.command, this.args, {windowsHide: true, stdio: ['pipe','pipe','pipe'],
      env: {...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1'}});
    this.child = child;
    child.stdin.on('error', e => { if (!this.stopping) this.fail(e); });
    const parser = new JsonLines(m => {
      if (this.child !== child || this.stopping) return;
      if (m.request_id && this.pending.has(m.request_id)) {
        const p = this.pending.get(m.request_id); clearTimeout(p.timer); this.pending.delete(m.request_id);
        m.type === 'error' ? p.reject(Object.assign(Error(m.message),{worker:true,permanent:m.recoverable===false})) : p.resolve(m);
      }
      this.emit('message', m);
    });
    child.stdout.on('data', b => { try { parser.push(b); } catch (e) { this.fail(e); } });
    child.stderr.on('data', b => this.emit('diagnostic', b.toString('utf8').slice(0, 8000)));
    child.on('error', e => this.fail(e));
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null; this.ready = false; clearInterval(this.heartbeat);
      this.rejectPending(Error('Worker exited'));
      if (!this.stopping) this.emit('fault', Error(`音声プロセスが終了しました (${code ?? signal})。再試行してください。`));
    });
    const ready = await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.off('message', onMessage); this.off('fault', onFault); };
      const onMessage = m => { if (m.type === 'ready') { cleanup(); resolve(m); }
        else if (m.type === 'error') { cleanup(); reject(Object.assign(Error(m.message),{worker:true,permanent:m.recoverable===false})); } };
      const onFault = e => { cleanup(); reject(e); };
      const timer = setTimeout(() => { cleanup(); reject(Error('音声プロセスの起動が30秒以内に完了しませんでした。')); }, 30000);
      this.on('message', onMessage); this.on('fault', onFault);
    }).catch(e => { this.fail(e); throw e; });
    this.ready = true;
    this.heartbeat = setInterval(() => {
      if (!this.pinging && this.ready) {
        this.pinging = true;
        this.request('ping', {}, 5000).catch(e => this.fail(e)).finally(() => { this.pinging = false; });
      }
    }, 5000);
    return ready;
  }
  request(type, fields = {}, timeout = 10000) {
    if (!this.child || this.stopping) return Promise.reject(Error('音声プロセスが起動していません。再試行してください。'));
    const request_id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(request_id); reject(Object.assign(Error(`${type}: 応答がタイムアウトしました。`),{worker:true})); }, timeout);
      this.pending.set(request_id, {resolve, reject, timer});
      this.child.stdin.write(JSON.stringify({version: 1, type, request_id, ...fields}) + '\n');
    });
  }
  rejectPending(e) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(e); } this.pending.clear(); }
  fail(e) {
    if (this.stopping) return;
    this.ready = false; this.emit('fault', e); void this.stop();
  }
  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this._stop();
    try { await this.stopPromise; } finally { this.stopPromise = null; }
  }
  async _stop() {
    clearInterval(this.heartbeat); this.ready = false;
    const child = this.child;
    if (!child) return;
    // Send shutdown before setting stopping so the graceful ack can be received.
    try { await this.request('shutdown', {}, 2000); } catch {}
    this.stopping = true; this.rejectPending(Error('Worker stopping'));
    child.stdin.end();
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(() => {
        if (process.platform === 'win32') {
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true}, finish);
        } else { child.kill('SIGKILL'); finish(); }
      }, 1500);
      child.once('exit', finish);
    });
    if (this.child === child) this.child = null;
  }
}
module.exports = {WorkerClient};
