import { DEVICE_NAME, NOTIFY, SERVICE, WRITE } from './protocol.js';

export class VioletBluetooth {
  constructor(bluetooth, publish) {
    this.bluetooth = bluetooth;
    this.publish = publish;
    this.phase = 'idle';
    this.session = null;
  }

  setPhase(phase, detail = {}) {
    this.phase = phase;
    this.publish({ type: 'phase', phase, ...detail });
  }

  setReady(session) {
    this.setPhase('ready', { notifications: session.notifications, mode: session.mode });
  }

  async connect() {
    if (this.phase !== 'idle') return;
    this.setPhase('choosing');
    let session;
    try {
      const device = await this.bluetooth.requestDevice({
        filters: [{ name: DEVICE_NAME }],
        optionalServices: [SERVICE],
      });
      if (!device.gatt) throw new Error('NoGatt');

      session = { device, stage: 'gatt' };
      session.onDisconnect = () => {
        if (this.session === session && !device.gatt.connected) this.clear('lost');
      };
      this.session = session;
      device.addEventListener('gattserverdisconnected', session.onDisconnect);
      this.setPhase('connecting');

      const server = await device.gatt.connect();
      if (!this.isCurrent(session)) return;
      session.stage = 'service';
      const service = await server.getPrimaryService(SERVICE);
      if (!this.isCurrent(session)) return;
      session.stage = 'write';
      const characteristic = await service.getCharacteristic(WRITE);
      if (!this.isCurrent(session)) return;
      if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
        session.write = (bytes) => characteristic.writeValueWithoutResponse(bytes);
        session.mode = 'without-response';
      } else if (characteristic.properties.write && characteristic.writeValueWithResponse) {
        session.write = (bytes) => characteristic.writeValueWithResponse(bytes);
        session.mode = 'with-response';
      } else {
        throw new Error('NotWritable');
      }

      try {
        const notify = await service.getCharacteristic(NOTIFY);
        if (!this.isCurrent(session)) return;
        if (!notify.properties.notify) throw new Error('NotNotifiable');
        session.notify = notify;
        session.onNotify = ({ target }) => {
          if (!target.value || !this.isCurrent(session)) return;
          const { buffer, byteOffset, byteLength } = target.value;
          this.publish({ type: 'notify', bytes: new Uint8Array(buffer, byteOffset, byteLength).slice() });
        };
        notify.addEventListener('characteristicvaluechanged', session.onNotify);
        await notify.startNotifications();
        if (!this.isCurrent(session)) return;
        session.notifications = true;
      } catch {
        if (!this.isCurrent(session)) return;
        session.notify?.removeEventListener('characteristicvaluechanged', session.onNotify);
        session.notifications = false;
      }
      this.setReady(session);
    } catch (error) {
      if (session && this.session !== session) return;
      this.clear('error', { error, stage: session?.stage ?? 'chooser' });
    }
  }

  isCurrent(session) {
    if (this.session !== session) return false;
    if (session.device.gatt.connected) return true;
    this.clear('lost');
    return false;
  }

  clear(reason, detail = {}) {
    const session = this.session;
    this.session = null;
    if (session) {
      session.device.removeEventListener('gattserverdisconnected', session.onDisconnect);
      session.notify?.removeEventListener('characteristicvaluechanged', session.onNotify);
      if (session.device.gatt.connected) session.device.gatt.disconnect();
    }
    this.setPhase('idle', { reason, ...detail });
  }

  disconnect() {
    if (this.phase === 'ready' || this.phase === 'writing') this.clear('manual');
  }

  async send(bytes) {
    await this.sendSequence([bytes]);
  }

  async sendSequence(frames) {
    const session = this.session;
    const total = frames.length;
    if (!total || this.phase !== 'ready' || !this.isCurrent(session)) return;
    let completed = 0;
    let error;
    for (const [index, bytes] of frames.entries()) {
      this.setPhase('writing', { bytes, total });
      if (!this.isCurrent(session)) return;
      try {
        await session.write(bytes);
        completed++;
      } catch (writeError) {
        error = writeError || new Error('Write failed');
      }
      if (!this.isCurrent(session)) return;
      if (total === 1) {
        this.setReady(session);
        if (!this.isCurrent(session)) return;
      }
      const event = { type: 'write', bytes, error };
      this.publish(total === 1 ? event : { ...event, index, total });
      if (!this.isCurrent(session)) return;
      if (error) break;
    }
    if (total > 1) this.setReady(session);
    return error ? { completed, error } : { completed };
  }
}
