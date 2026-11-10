import { EffectLab } from './experiment.js';
import { formatHex } from '../protocol.js';

const byId = (id) => document.getElementById(id);
const connect = byId('connect');
const disconnect = byId('disconnect');
const attempt = byId('try');
const restore = byId('restore');
const connectionStatus = byId('connection-status');
const result = byId('result');
const log = byId('log');
const supported = window.isSecureContext && Boolean(navigator.bluetooth);
const lab = new EffectLab(navigator.bluetooth, showEvent);
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function addLog(label, bytes) {
  const entry = document.createElement('li');
  const frame = document.createElement('code');
  frame.textContent = formatHex(bytes);
  entry.append(`${time.format(new Date())} · ${label} · `, frame);
  log.append(entry);
  if (log.children.length > 36) log.firstElementChild.remove();
}

function showConnection(event) {
  if (event.phase === 'choosing') connectionStatus.textContent = 'Select GATT--DEMO from the device list.';
  if (event.phase === 'connecting') connectionStatus.textContent = 'Connecting…';
  if (event.phase === 'ready') connectionStatus.textContent = 'Connected.';
  if (event.phase !== 'idle') return;
  if (event.reason === 'manual') connectionStatus.textContent = 'Disconnected.';
  if (event.reason === 'lost') connectionStatus.textContent = 'Connection lost. You can reconnect.';
  if (event.reason === 'error') {
    connectionStatus.textContent = event.error?.name === 'NotFoundError' && event.stage === 'chooser'
      ? 'No device selected. You can try again.'
      : 'Could not connect. Check Bluetooth and disconnect other apps from the strip.';
  }
}

function showRun(event) {
  const messages = {
    sending: event.mode === 'try' ? 'Sending the effect and lowest speed…' : 'Sending the solid red command…',
    observing: 'The browser completed both writes. Watch the strip now for 30 seconds. Do the colors move?',
    elapsed: '30 seconds have passed. Did two colors stay in the same places? Record what you saw.',
    restored: 'The browser completed the red write. Check whether the whole strip is red.',
    failed: `The browser completed ${event.completed} of the requested writes. Check the strip or return to solid red.`,
    interrupted: 'The experiment stopped when Bluetooth disconnected. Check the strip. Reconnect if you need to return to solid red.',
  };
  result.textContent = messages[event.state];
}

function updateControls() {
  const connected = lab.phase === 'ready' || lab.phase === 'writing';
  const previous = document.activeElement;
  connect.hidden = connected;
  connect.disabled = !supported || lab.phase !== 'idle';
  disconnect.hidden = !connected;
  attempt.disabled = !lab.canTry;
  restore.disabled = !lab.canRestore;
  if (connected && previous === connect) attempt.focus();
  if (!connected && previous === disconnect) connect.focus();
}

function showEvent(event) {
  if (event.type === 'phase') {
    showConnection(event);
    if (event.phase === 'writing') addLog('FFF3 write attempted', event.bytes);
  }
  if (event.type === 'write') addLog(event.error ? 'FFF3 write failed' : 'Browser completed FFF3 write', event.bytes);
  if (event.type === 'run') showRun(event);
  updateControls();
}

connectionStatus.textContent = supported
  ? 'Disconnected.'
  : 'Web Bluetooth unavailable. Open this HTTPS page directly in Android Chrome.';
updateControls();
connect.addEventListener('click', () => lab.connect());
disconnect.addEventListener('click', () => lab.disconnect());
attempt.addEventListener('click', () => lab.tryEffect());
restore.addEventListener('click', () => lab.restore());
