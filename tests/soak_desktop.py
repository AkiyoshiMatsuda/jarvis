"""Bounded, isolated desktop soak test. No recording or system power/network changes."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import sys
import time
import traceback
import psutil

ROOT=Path(__file__).resolve().parents[1]
EXE=ROOT/'release/win-unpacked/JARVIS.exe'
DATA=EXE.parent/'.smoke-data'


def now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, data):
    temp=path.with_suffix('.tmp')
    temp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    temp.replace(path)


def reset_settings():
    DATA.mkdir(exist_ok=True)
    path=DATA/'settings.json'
    if path.exists():
        settings=json.loads(path.read_text(encoding='utf-8'))
        settings['monitoring_enabled']=False
        write_json(path,settings)


def cleanup(process):
    if process and process.poll() is None:
        try:
            children=psutil.Process(process.pid).children(recursive=True)
        except psutil.Error:
            children=[]
        process.terminate()
        try: process.wait(timeout=8)
        except subprocess.TimeoutExpired: process.kill();process.wait(timeout=5)
        _,alive=psutil.wait_procs(children,timeout=5)
        for child in alive:
            try: child.kill()
            except psutil.Error: pass


def regression(out, label, timeout):
    with (out/f'{label}.txt').open('w',encoding='utf-8') as log:
        p=subprocess.Popen([sys.executable,str(ROOT/'tests/check_desktop.py')],cwd=ROOT,
                           stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            return p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            cleanup(p)
            raise RuntimeError(f'{label} exceeded time budget')


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--deadline',required=True,help='Absolute ISO UTC cutoff')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    deadline=datetime.fromisoformat(args.deadline).timestamp()
    if not 120 < deadline-time.time() <= 14400:
        raise ValueError('Deadline must be within the next four hours')
    out=args.output.resolve();out.mkdir(parents=True,exist_ok=False)
    status={'started':now(),'deadline':args.deadline,'runner_pid':psutil.Process().pid,'phase':'preflight',
            'finished':False,'issues':[], 'samples':0}
    write_json(out/'status.json',status)
    process=None;samples=[];counts=Counter();known={};offset=0;app_state='STARTING';last_pong=None
    try:
        status['regression_before']=regression(out,'regression-before',min(240,deadline-time.time()-60))
        if status['regression_before']!=0: raise RuntimeError('Preflight regression failed; see regression-before.txt')
        reset_settings();(DATA/'hold.json').unlink(missing_ok=True)
        app_log=DATA/'logs/desktop.jsonl'
        offset=app_log.stat().st_size if app_log.exists() else 0
        info=subprocess.STARTUPINFO();info.dwFlags|=subprocess.STARTF_USESHOWWINDOW;info.wShowWindow=0
        process=subprocess.Popen([str(EXE),'--hold-test','--smoke-mic-test'],cwd=EXE.parent,startupinfo=info)
        ready_end=min(time.time()+90,deadline-180)
        while not (DATA/'hold.json').exists():
            if process.poll() is not None or time.time()>ready_end: raise RuntimeError('Soak app did not become ready')
            time.sleep(.25)
        held=json.loads((DATA/'hold.json').read_text());assert held['state']=='LISTENING'
        status.update(phase='soak',app_pid=process.pid,soak_started=now(),initial_worker=held['worker'],
                      app_asar_sha256=hashlib.sha256((EXE.parent/'resources/app.asar').read_bytes()).hexdigest())
        started=time.monotonic();previous=time.monotonic();last_pong=time.time()
        with (out/'samples.jsonl').open('w',encoding='utf-8',buffering=1) as measurements, (out/'events.jsonl').open('w',encoding='utf-8',buffering=1) as events:
            while time.time()<deadline-180 and not (out/'STOP').exists():
                if process.poll() is not None: raise RuntimeError(f'App exited unexpectedly: {process.returncode}')
                if app_log.exists():
                    if app_log.stat().st_size<offset: offset=0
                    with app_log.open('r',encoding='utf-8') as stream:
                        stream.seek(offset)
                        for line in stream:
                            try: event=json.loads(line)
                            except json.JSONDecodeError: continue
                            events.write(json.dumps(event,ensure_ascii=False)+'\n');counts[event.get('type','unknown')]+=1
                            if event.get('type')=='state':app_state=event['state']
                            if event.get('type')=='pong':last_pong=time.time()
                        offset=stream.tell()
                root=psutil.Process(process.pid);processes=[root]+root.children(recursive=True)
                cpu=rss=handles=0;details=[]
                for item in processes:
                    try:
                        key=(item.pid,item.create_time())
                        if key not in known:known[key]=item;item.cpu_percent()
                        item=known[key]
                        percent=item.cpu_percent();memory=item.memory_info().rss/1024**2
                        cpu+=percent;rss+=memory;handles+=item.num_handles()
                        details.append({'pid':item.pid,'name':item.name(),'cpu':percent,'rss_mb':memory})
                    except psutil.Error:pass
                tick=time.monotonic()
                sample={'time':now(),'elapsed_s':tick-started,'interval_s':tick-previous,
                        'cpu_percent_one_core_100':cpu,'rss_sum_mb':rss,'handles_sum':handles,
                        'state':app_state,'heartbeat_age_s':time.time()-last_pong,'processes':details}
                previous=tick;samples.append(sample);measurements.write(json.dumps(sample)+'\n')
                if sample['interval_s']>25:status['issues'].append({'time':now(),'reason':'sampling_gap','seconds':sample['interval_s']})
                status.update(samples=len(samples),last_sample=sample,event_counts=dict(counts))
                write_json(out/'status.json',status)
                if app_state not in ('SUSPENDED','STARTING','RECOVERING') and sample['heartbeat_age_s']>30:
                    raise RuntimeError('Worker heartbeat absent for more than 30 seconds')
                time.sleep(min(10,max(0,deadline-180-time.time())))
        status['soak_seconds']=time.monotonic()-started
        cleanup(process);process=None;reset_settings()
        status['phase']='postflight';write_json(out/'status.json',status)
        if not (out/'STOP').exists() and deadline-time.time()>120:
            status['regression_after']=regression(out,'regression-after',min(150,deadline-time.time()-15))
            if status['regression_after']!=0:status['issues'].append({'reason':'postflight_failed'})
        status['phase']='completed' if not (out/'STOP').exists() else 'stopped'
    except Exception as exc:
        status['phase']='failed';status['issues'].append({'time':now(),'reason':str(exc)})
        (out/'exception.txt').write_text(traceback.format_exc(),encoding='utf-8')
    finally:
        cleanup(process);reset_settings()
        if samples:
            usable=samples[1:] or samples
            status['summary']={
                'cpu_mean':statistics.mean(s['cpu_percent_one_core_100'] for s in usable),
                'cpu_max':max(s['cpu_percent_one_core_100'] for s in usable),
                'rss_first_10min_mean_mb':statistics.mean(s['rss_sum_mb'] for s in samples[:60]),
                'rss_last_10min_mean_mb':statistics.mean(s['rss_sum_mb'] for s in samples[-60:]),
                'rss_max_mb':max(s['rss_sum_mb'] for s in samples),
                'handles_first':samples[0]['handles_sum'],'handles_last':samples[-1]['handles_sum'],
                'sampled_states':dict(Counter(s['state'] for s in samples))}
        status.update(finished=True,ended=now(),event_counts=dict(counts))
        write_json(out/'status.json',status)
        (out/'report.md').write_text('# JARVIS bounded soak test\n\n```json\n'+json.dumps(status,ensure_ascii=False,indent=2)+'\n```\n\n'
          'CPU: sum for application process tree, one core = 100%. RSS sums may double-count shared pages.\n'
          'Detection events are unlabelled; they are not automatically false positives.\n'
          'No recording. No OS reboot, lock, sleep or network disconnection was performed.\n'
          'Regression uses injected detections and power events; actual speech accuracy and OS transitions remain untested.\n',encoding='utf-8')


if __name__=='__main__':main()
