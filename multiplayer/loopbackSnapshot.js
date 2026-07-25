// In-memory binary loopback used to prove host snapshot authority before WebRTC.
export function createSnapshotLoopback() {
  let receiver = null;
  let closed = false;
  return {
    setReceiver(handler) { receiver = handler; },
    send(bytes) {
      if (closed || !(bytes instanceof Uint8Array)) return false;
      const copy = bytes.slice();
      queueMicrotask(() => { if (!closed) receiver?.(copy); });
      return true;
    },
    close() { closed = true; receiver = null; },
  };
}
