export class MultiplayerTransport {
  constructor() { this.handlers = {}; }
  setHandlers(handlers = {}) { this.handlers = { ...handlers }; return this; }
  async open() { throw new Error('Transport.open not implemented'); }
  sendReliable(_bytes) { throw new Error('Transport.sendReliable not implemented'); }
  sendTransient(_bytes) { throw new Error('Transport.sendTransient not implemented'); }
  getBufferedAmount() { return 0; }
  close(_reason = 'closed') {}
  _open(info) { this.handlers.onOpen?.(info); }
  _reliable(bytes) { this.handlers.onReliableMessage?.(bytes); }
  _transient(bytes) { this.handlers.onTransientMessage?.(bytes); }
  _error(error) { this.handlers.onError?.(error); }
  _close(reason) { this.handlers.onClose?.(reason); }
}

export function assertBinary(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Transport payload must be Uint8Array');
  return bytes;
}
