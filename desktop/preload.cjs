const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jarvis', {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  action: (name, payload) => ipcRenderer.invoke('action', name, payload),
  timerAlarmEvent: (id, event) => ipcRenderer.send('timer-alarm-event', id, event),
  onTimerAlarm: callback => {
    const listener=(_event,value)=>callback(value);ipcRenderer.on('timer-alarm',listener);
    return ()=>ipcRenderer.removeListener('timer-alarm',listener);
  },
  speechEvent: (id, event) => ipcRenderer.send('speech-event', id, event),
  onSpeech: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('speech', listener);
    return () => ipcRenderer.removeListener('speech', listener);
  },
  responseEvent: (id, event) => ipcRenderer.send('response-event', id, event),
  onResponse: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('response', listener);
    return () => ipcRenderer.removeListener('response', listener);
  },
  subscribe: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('snapshot', listener);
    return () => ipcRenderer.removeListener('snapshot', listener);
  }
});
