import { applySimulationSnapshot, captureSimulationSnapshot, decodeSimulationSnapshot, encodeSimulationSnapshot } from './snapshotCodec.js';

export class SnapshotPublisher {
  constructor(send, { hz = 4, hostEpoch = 1, durableSequence = () => 0 } = {}) {
    if (typeof send !== 'function' || hz < 4 || hz > 8) throw new TypeError('Invalid snapshot publisher');
    this.send = send; this.interval = 1000 / hz; this.hostEpoch = hostEpoch;
    this.durableSequence = durableSequence; this.sequence = 0; this.timer = null;
  }
  nextSnapshot() {
    return encodeSimulationSnapshot(captureSimulationSnapshot({ hostEpoch: this.hostEpoch, sequence: ++this.sequence, durableSequence: this.durableSequence() }));
  }
  start() {
    if (this.timer) return;
    const publish = () => this.send(this.nextSnapshot());
    publish(); this.timer = setInterval(publish, this.interval);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

export class SnapshotReceiver {
  constructor(apply = applySimulationSnapshot) {
    this.apply = apply; this.hostEpoch = null; this.sequence = 0; this.lastReceivedAt = 0;
  }
  receive(bytes) {
    const snapshot = decodeSimulationSnapshot(bytes);
    if (this.hostEpoch !== null && snapshot.hostEpoch !== this.hostEpoch) throw new Error('Host epoch changed');
    if (snapshot.sequence <= this.sequence) return false;
    this.hostEpoch ??= snapshot.hostEpoch;
    this.apply(snapshot); this.sequence = snapshot.sequence; this.lastReceivedAt = performance.now();
    return true;
  }
}
