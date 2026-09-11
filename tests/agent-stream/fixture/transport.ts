export class FixtureSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  constructor(readonly endpoint: string) {}
  close() {
    this.onclose?.();
  }
  sendEvent(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
export const sockets: FixtureSocket[] = [];
export async function openLocalApiWebSocket(endpoint: string) {
  const socket = new FixtureSocket(endpoint);
  sockets.push(socket);
  setTimeout(() => socket.onopen?.(), 0);
  return socket;
}
