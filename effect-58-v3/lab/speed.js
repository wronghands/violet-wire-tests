import { formatHex } from '../protocol.js';
import { SpeedContrast } from './experiment.js';

const byId = (id) => document.getElementById(id);
const connect = byId('connect');
const disconnect = byId('disconnect');
const choice = byId('speed-choice');
const start = byId('start');
const restore = byId('restore');
const connection = byId('connection');
const status = byId('status');
const timer = byId('timer');
const form = byId('observation');
const log = byId('log');
const supported = window.isSecureContext && Boolean(navigator.bluetooth);
const lab = new SpeedContrast(navigator.bluetooth, showEvent);
let interval = null;
let observedSpeed = null;

function showControls() {
  const connected = lab.phase === 'ready' || lab.phase === 'writing';
  const focus = document.activeElement;
  connect.hidden = connected;
  connect.disabled = !supported || lab.phase !== 'idle';
  disconnect.hidden = !connected;
  choice.disabled = !lab.canRun;
  start.disabled = !lab.canRun;
  restore.disabled = !lab.canRestore;
  if (connected && focus === connect && lab.canRun) start.focus();
  if (!connected && focus === disconnect && supported) connect.focus();
}

function stopTimer() {
  clearInterval(interval);
  interval = null;
  timer.hidden = true;
}

function showRun(event) {
  if (event.state !== 'observing') stopTimer();
  if (event.state === 'observing') {
    const tick = () => { timer.textContent = `${Math.max(0, Math.ceil((event.deadline - Date.now()) / 1000))} s`; };
    timer.hidden = false;
    tick();
    interval = setInterval(tick, 250);
  }
  if (event.state === 'elapsed') {
    observedSpeed = event.speed;
    form.reset();
    byId('observation-title').textContent = `Record speed ${observedSpeed}`;
    form.hidden = false;
  }
  const messages = {
    sending: event.speed === null ? 'Sending solid red…' : `Sending speed ${event.speed}…`,
    observing: `Speed ${event.speed} written by the browser. Count crossings now.`,
    elapsed: `Speed ${event.speed} run complete. Record the count and direction you observed.`,
    restored: 'The browser completed the red write. Check the physical strip.',
    failed: `Write failed. The browser completed ${event.completed} packet(s). Check the strip or return to solid red.`,
    interrupted: 'The connection ended and the run stopped. Reconnect to continue or return to solid red.',
  };
  status.textContent = messages[event.state];
}

function addLog(label, bytes) {
  const row = document.createElement('li');
  const code = document.createElement('code');
  code.textContent = formatHex(bytes);
  row.append(`${new Date().toLocaleTimeString('en-GB')} · ${label} · `, code);
  log.append(row);
  if (log.children.length > 40) log.firstElementChild.remove();
}

function showEvent(event) {
  if (event.type === 'phase') {
    if (event.phase === 'choosing') connection.textContent = 'Select GATT--DEMO.';
    if (event.phase === 'connecting') connection.textContent = 'Connecting…';
    if (event.phase === 'ready') connection.textContent = 'Connected.';
    if (event.phase === 'writing') addLog('FFF3 write attempted', event.bytes);
    if (event.phase === 'idle') {
      if (event.reason === 'error' && event.error?.name === 'NotFoundError' && event.stage === 'chooser') {
        connection.textContent = 'No device selected. Try again.';
      } else if (event.reason === 'error') {
        connection.textContent = 'Could not connect. Check Bluetooth and disconnect other apps from the strip.';
      } else {
        connection.textContent = 'Disconnected.';
      }
    }
  }
  if (event.type === 'write') addLog(event.error ? 'FFF3 write failed' : 'FFF3 write completed in browser', event.bytes);
  if (event.type === 'run') showRun(event);
  showControls();
}

connection.textContent = supported ? 'Disconnected.' : 'Open this HTTPS page in Android Chrome for Web Bluetooth.';
showControls();
connect.addEventListener('click', () => lab.connect());
disconnect.addEventListener('click', () => lab.disconnect());
start.addEventListener('click', () => lab.start(Number(choice.querySelector(':checked').value)));
restore.addEventListener('click', () => lab.restore());
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (observedSpeed === null) return;
  const count = byId('count').valueAsNumber;
  const direction = byId('direction').value;
  if (!Number.isInteger(count) || count < 0 || !direction) return;
  byId(`reading-${observedSpeed}`).textContent = `${count} in 30 s · ~${count * 2}/min · ${direction}`;
  byId('saved').textContent = `Speed ${observedSpeed} observation saved on this page.`;
  observedSpeed = null;
  form.hidden = true;
});
