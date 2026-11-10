import { brightnessFrame, customColorFrames, normalizeRgbHex } from '../protocol.js';

export const FRAME_GAP_MS = 150;
export const REFRESH_MS = 1500;
const BRIGHTNESS_FLOOR = 120;
const MAX_ERRORS = 3;

function channels(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

export function prepareEffect({ colorA, colorB, durationMs, brightness, breathing }) {
  const a = normalizeRgbHex(colorA);
  const b = normalizeRgbHex(colorB);
  if (!a || !b || !Number.isInteger(durationMs) || durationMs < 6000 || durationMs > 60000 ||
      !Number.isInteger(brightness) || brightness < 150 || brightness > 1000 || typeof breathing !== 'boolean') {
    throw new RangeError('Invalid color breathing settings');
  }
  return { a: channels(a), b: channels(b), durationMs, brightness, breathing };
}

export function sampleEffect(effect, elapsedMs) {
  const phase = (elapsedMs % effect.durationMs) * (2 * Math.PI / effect.durationMs);
  const blend = (1 - Math.cos(phase)) / 2;
  const rgb = effect.a.map((channel, i) => Math.round(channel + (effect.b[i] - channel) * blend));
  const hex = `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  const { color, value } = customColorFrames(hex);
  const pulse = effect.breathing ? 1 - 0.22 * Math.sin(phase) ** 2 : 1;
  const level = Math.max(BRIGHTNESS_FLOOR, Math.round(effect.brightness * value / 1000 * pulse));
  return { color, brightness: brightnessFrame(level) };
}

function isDue(last, bytes, now) {
  return !last || now - last.at >= REFRESH_MS || bytes.some((byte, i) => byte !== last.bytes[i]);
}

export class BreathingPlayer {
  constructor(send, publish, now = () => performance.now()) {
    this.send = send;
    this.publish = publish;
    this.now = now;
    this.run = null;
    this.pending = null;
    this.nextWriteAt = 0;
  }

  get active() { return this.run !== null; }
  get busy() { return this.pending !== null; }

  start(settings) {
    if (this.active || this.busy) return false;
    const run = {
      effect: prepareEffect(settings), started: this.now(), timer: null,
      next: 'brightness', last: {}, errors: { color: 0, brightness: 0 },
    };
    this.run = run;
    this.publish({ state: 'running' });
    void this.step(run);
    return true;
  }

  stop(reason = 'manual') {
    if (!this.run) return;
    clearTimeout(this.run.timer);
    this.run = null;
    this.publish({ state: 'stopped', reason });
  }

  disconnect() {
    const drained = this.busy;
    this.pending = null;
    if (this.active) this.stop('disconnect');
    else if (drained) this.publish({ state: 'settled' });
  }

  async step(run) {
    if (this.run !== run) return;
    const now = this.now();
    if (now < this.nextWriteAt) {
      run.timer = setTimeout(() => this.step(run), Math.ceil(this.nextWriteAt - now));
      return;
    }
    const frames = sampleEffect(run.effect, now - run.started);
    const other = run.next === 'color' ? 'brightness' : 'color';
    const kind = [run.next, other].find((key) => isDue(run.last[key], frames[key], now));
    if (kind) {
      const bytes = frames[kind];
      const pending = {};
      this.pending = pending;
      this.nextWriteAt = now + FRAME_GAP_MS;
      run.next = kind === 'color' ? 'brightness' : 'color';
      let completed = false;
      try {
        const result = await this.send(bytes);
        completed = result?.completed === 1 && !result.error;
      } catch {
        // The next eligible write uses a fresh sample.
      }
      if (this.pending !== pending) return;
      this.pending = null;
      this.nextWriteAt = this.now() + FRAME_GAP_MS;
      if (this.run !== run) {
        this.publish({ state: 'settled' });
        return;
      }
      const recovering = run.errors.color > 0 || run.errors.brightness > 0;
      if (completed) {
        run.last[kind] = { bytes, at: this.now() };
        run.errors[kind] = 0;
        if (recovering && !run.errors.color && !run.errors.brightness) this.publish({ state: 'resumed' });
      } else {
        run.errors[kind]++;
        if (run.errors[kind] >= MAX_ERRORS) {
          this.stop('write-errors');
          return;
        }
        if (!recovering) this.publish({ state: 'retrying' });
      }
    }
    if (this.run === run) run.timer = setTimeout(() => this.step(run), FRAME_GAP_MS);
  }
}
