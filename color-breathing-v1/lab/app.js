import { VioletBluetooth } from '../ble.js';
import { normalizeRgbHex } from '../protocol.js';
import { BreathingPlayer } from './player.js';

const byId = (id) => document.getElementById(id);
const connect = byId('connect');
const disconnect = byId('disconnect');
const connectionStatus = byId('connection-status');
const playerStatus = byId('player-status');
const settings = byId('settings');
const duration = byId('duration');
const brightness = byId('brightness');
const breathing = byId('breathing');
const start = byId('start');
const stop = byId('stop');
const colors = ['a', 'b'].map((letter) => ({
  hex: byId(`hex-${letter}`),
  picker: byId(`picker-${letter}`),
  error: byId(`error-${letter}`),
}));
const supported = window.isSecureContext && Boolean(navigator.bluetooth);
const ble = new VioletBluetooth(navigator.bluetooth, onTransport);
const player = new BreathingPlayer((bytes) => {
  if (document.hidden) return player.stop('background');
  return ble.sendSequence([bytes]);
}, onPlayer);

function setStatus(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function render() {
  const connected = ble.phase === 'ready' || ble.phase === 'writing';
  const active = player.active;
  const locked = active || player.busy;
  const focus = document.activeElement;
  connect.hidden = connected;
  connect.disabled = !supported || ble.phase !== 'idle';
  disconnect.hidden = !connected;
  settings.disabled = locked;
  start.disabled = !connected || ble.phase !== 'ready' || locked || document.hidden ||
    colors.some(({ hex }) => !normalizeRgbHex(hex.value));
  stop.disabled = !active;
  if (focus === connect && connected && !start.disabled) start.focus();
  if (focus === disconnect && !connected && !connect.disabled) connect.focus();
}

function onTransport(event) {
  if (event.type !== 'phase') return;
  if (event.phase === 'choosing') setStatus(connectionStatus, 'Select GATT--DEMO.');
  if (event.phase === 'connecting') setStatus(connectionStatus, 'Connecting…');
  if (event.phase === 'ready') {
    setStatus(connectionStatus, 'Connected');
    if (playerStatus.textContent === 'Connect the strip to start.') setStatus(playerStatus, 'Ready to start.');
  }
  if (event.phase === 'idle') {
    player.disconnect();
    let message = 'Disconnected';
    if (event.reason === 'lost') message = 'Connection lost';
    if (event.reason === 'error') {
      message = event.stage === 'chooser' && event.error?.name === 'NotFoundError'
        ? 'No device selected.'
        : 'Could not connect. Check Bluetooth and close other apps controlling the strip.';
    }
    setStatus(connectionStatus, message);
    if (playerStatus.textContent === 'Ready to start.') setStatus(playerStatus, 'Connect the strip to start.');
  }
  render();
}

const stopMessages = {
  manual: 'Stopped. The last write may still take effect.',
  background: 'Stopped when the page went into the background. Tap Start to run again.',
  disconnect: 'Stopped when the strip disconnected.',
  'write-errors': 'Stopped after repeated write errors. Check the connection before starting again.',
};

function onPlayer({ state, reason }) {
  if (state === 'running' || state === 'resumed') setStatus(playerStatus, 'Sending color updates to the strip.');
  if (state === 'retrying') setStatus(playerStatus, 'A Bluetooth write failed. Sending a fresh update…');
  if (state === 'stopped') setStatus(playerStatus, stopMessages[reason] ?? 'Stopped.');
  render();
}

function syncHex({ hex, picker, error }) {
  const normalized = normalizeRgbHex(hex.value);
  hex.setAttribute('aria-invalid', String(!normalized));
  error.hidden = Boolean(normalized);
  if (normalized) picker.value = normalized.toLowerCase();
  render();
  return normalized;
}

for (const color of colors) {
  color.hex.addEventListener('input', () => syncHex(color));
  color.hex.addEventListener('blur', () => {
    const normalized = normalizeRgbHex(color.hex.value);
    if (normalized) color.hex.value = normalized;
  });
  color.picker.addEventListener('input', () => {
    color.hex.value = color.picker.value.toUpperCase();
    syncHex(color);
  });
}

for (const [input, unit, spokenUnit] of [[duration, ' s', 'seconds'], [brightness, '%', 'percent']]) {
  input.addEventListener('input', () => {
    byId(`${input.id}-value`).value = `${input.value}${unit}`;
    input.setAttribute('aria-valuetext', `${input.value} ${spokenUnit}`);
  });
}

connect.addEventListener('click', () => ble.connect());
disconnect.addEventListener('click', () => ble.disconnect());
start.addEventListener('click', () => {
  render();
  if (start.disabled) return;
  const [colorA, colorB] = colors.map(({ hex }) => normalizeRgbHex(hex.value));
  player.start({
    colorA,
    colorB,
    durationMs: Number(duration.value) * 1000,
    brightness: Number(brightness.value) * 10,
    breathing: breathing.checked,
  });
  if (player.active) stop.focus();
});
stop.addEventListener('click', () => {
  player.stop('manual');
  if (!start.disabled) start.focus();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) player.stop('background');
  render();
});
window.addEventListener('pagehide', () => player.stop('background'));
window.addEventListener('pageshow', render);

setStatus(connectionStatus, supported ? 'Disconnected' : 'Open this HTTPS page in Android Chrome for Bluetooth.');
render();
