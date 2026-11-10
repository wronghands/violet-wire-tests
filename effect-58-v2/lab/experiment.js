import { VioletBluetooth } from '../ble.js';
import { colorFrame } from '../protocol.js';

export const OBSERVATION_MS = 30_000;

// mr-star-ble RG_RUNNING_WATER (58) followed by its minimum speed (0).
function effectFrames() {
  return [Uint8Array.of(0xbc, 0x06, 0x02, 0x00, 0x3a, 0x55), Uint8Array.of(0xbc, 0x08, 0x01, 0x00, 0x55)];
}

export class EffectLab {
  constructor(bluetooth, publish) {
    this.publish = publish;
    this.transport = new VioletBluetooth(bluetooth, (event) => this.onTransport(event));
    this.operation = null;
    this.observation = null;
  }

  get phase() { return this.transport.phase; }
  get canRestore() { return this.phase === 'ready' && this.operation === null; }
  get canTry() { return this.canRestore && this.observation === null; }

  connect() { return this.transport.connect(); }
  disconnect() { this.transport.disconnect(); }
  tryEffect() { return this.run('try', effectFrames()); }
  restore() { return this.run('restore', [colorFrame('red')]); }

  cancelObservation() {
    if (this.observation !== null) clearTimeout(this.observation);
    this.observation = null;
  }

  onTransport(event) {
    if (event.type === 'write' && !event.error && this.operation) this.operation.completed++;
    if (event.type === 'phase' && event.phase === 'idle') {
      const operation = this.operation;
      const observing = this.observation !== null;
      this.operation = null;
      this.cancelObservation();
      if (operation || observing) {
        this.publish({ type: 'run', state: 'interrupted', completed: operation?.completed ?? 2 });
      }
    }
    this.publish(event);
  }

  async run(mode, frames) {
    if (!(mode === 'try' ? this.canTry : this.canRestore)) return;
    this.cancelObservation();
    const operation = { completed: 0 };
    this.operation = operation;
    this.publish({ type: 'run', state: 'sending', mode });
    const result = await this.transport.sendSequence(frames);
    if (this.operation !== operation) return;
    this.operation = null;

    if (result?.completed !== frames.length || result.error) {
      this.publish({ type: 'run', state: 'failed', completed: operation.completed });
    } else if (mode === 'restore') {
      this.publish({ type: 'run', state: 'restored' });
    } else {
      this.observation = setTimeout(() => {
        this.observation = null;
        this.publish({ type: 'run', state: 'elapsed' });
      }, OBSERVATION_MS);
      this.publish({ type: 'run', state: 'observing' });
    }
  }
}
