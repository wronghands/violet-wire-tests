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
const time = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function addLog(label, bytes) {
  const entry = document.createElement('li');
  const frame = document.createElement('code');
  frame.textContent = formatHex(bytes);
  entry.append(`${time.format(new Date())} · ${label} · `, frame);
  log.append(entry);
  if (log.children.length > 36) log.firstElementChild.remove();
}

function showConnection(event) {
  if (event.phase === 'choosing') connectionStatus.textContent = 'Cihaz listesinden GATT--DEMO’yu seç.';
  if (event.phase === 'connecting') connectionStatus.textContent = 'Bağlanıyor…';
  if (event.phase === 'ready') connectionStatus.textContent = 'Bağlı.';
  if (event.phase !== 'idle') return;
  if (event.reason === 'manual') connectionStatus.textContent = 'Bağlantı kesildi.';
  if (event.reason === 'lost') connectionStatus.textContent = 'Bağlantı koptu. Yeniden bağlanabilirsin.';
  if (event.reason === 'error') {
    connectionStatus.textContent = event.error?.name === 'NotFoundError' && event.stage === 'chooser'
      ? 'Cihaz seçilmedi. Tekrar bağlanabilirsin.'
      : 'Bağlanılamadı. Bluetooth’u kontrol et ve diğer uygulamaların şeritle bağlantısını kes.';
  }
}

function showRun(event) {
  const messages = {
    sending: event.mode === 'try' ? 'Efekt ve en düşük hız yazılıyor…' : 'Kırmızı komutu yazılıyor…',
    observing: 'Tarayıcı yazımları tamamladı. Şeridi şimdi 30 saniye izle. Renkler yer değiştiriyor mu?',
    elapsed: '30 saniye doldu. Aynı yerlerde kalan iki farklı renk gördün mü? Fiziksel sonucu kaydet.',
    restored: 'Tarayıcı kırmızı komutunu yazdı. Şeridin tamamının kırmızı olduğunu kontrol et.',
    failed: `Yazım tamamlanamadı. ${event.completed} paket tarayıcıda tamamlandı. Şeridi kontrol et veya tek renge dön.`,
    interrupted: 'Bağlantı kesildi. Deney durdu. Şeridi kontrol et. Gerekirse yeniden bağlanıp tek renge dön.',
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
    if (event.phase === 'writing') addLog('FFF3 yazım denemesi', event.bytes);
  }
  if (event.type === 'write') addLog(event.error ? 'FFF3 yazım hatası' : 'FFF3 yazımı tarayıcıda tamamlandı', event.bytes);
  if (event.type === 'run') showRun(event);
  updateControls();
}

connectionStatus.textContent = supported
  ? 'Bağlı değil.'
  : 'Web Bluetooth kullanılamıyor. Bu HTTPS adresini Android Chrome’da doğrudan aç.';
updateControls();
connect.addEventListener('click', () => lab.connect());
disconnect.addEventListener('click', () => lab.disconnect());
attempt.addEventListener('click', () => lab.tryEffect());
restore.addEventListener('click', () => lab.restore());
