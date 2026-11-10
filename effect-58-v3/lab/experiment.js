import { VioletBluetooth } from '../ble.js';
import { colorFrame } from '../protocol.js';

export const RUN_MS = 30_000;
export const SPEEDS = Object.freeze([0, 100]);

function framesFor(speed, needsPreset) {
  const frame = Uint8Array.of(0xbc, 0x08, 0x01, speed, 0x55);
  return needsPreset ? [Uint8Array.of(0xbc, 0x06, 0x02, 0, 0x3a, 0x55), frame] : [frame];
}

export class SpeedContrast {
  constructor(bluetooth, publish) {
    this.publish = publish;
    this.transport = new VioletBluetooth(bluetooth, (event) => this.onTransport(event));
    this.presetStarted = false;
    this.operation = null;
    this.timer = null;
  }

  get phase() { return this.transport.phase; }
  get canRestore() { return this.phase === 'ready' && this.operation === null; }
  get canRun() { return this.canRestore && this.timer === null; }

  connect() { return this.transport.connect(); }
  disconnect() { this.transport.disconnect(); }

  cancelTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  onTransport(event) {
    if (event.type === 'write' && !event.error && this.operation) {
      this.operation.completed++;
      if (event.bytes[1] === 0x06) this.presetStarted = true;
    }
    if (event.type === 'phase' && event.phase === 'idle') {
      const interrupted = this.operation !== null || this.timer !== null;
      this.operation = null;
      this.presetStarted = false;
      this.cancelTimer();
      if (interrupted) this.publish({ type: 'run', state: 'interrupted' });
    }
    this.publish(event);
  }

  start(speed) {
    if (!this.canRun || !SPEEDS.includes(speed)) return;
    return this.write(framesFor(speed, !this.presetStarted), speed);
  }

  restore() {
    if (!this.canRestore) return;
    this.cancelTimer();
    this.presetStarted = false;
    return this.write([colorFrame('red')], null);
  }

  async write(frames, speed) {
    const operation = { completed: 0 };
    this.operation = operation;
    this.publish({ type: 'run', state: 'sending', speed });
    const result = await this.transport.sendSequence(frames);
    if (this.operation !== operation) return;
    this.operation = null;
    if (result?.completed !== frames.length || result.error) {
      this.publish({ type: 'run', state: 'failed', completed: operation.completed });
    } else if (speed === null) {
      this.publish({ type: 'run', state: 'restored' });
    } else {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.publish({ type: 'run', state: 'elapsed', speed });
      }, RUN_MS);
      this.publish({ type: 'run', state: 'observing', speed, deadline: Date.now() + RUN_MS });
    }
  }
}
