import { io } from 'socket.io-client';

// One shared Socket.IO connection for the whole app. Connects to the same
// origin the page was served from (works on the LAN IP automatically).
export const socket = io({
  autoConnect: true,
  transports: ['websocket', 'polling'], // WS primary, HTTP polling fallback (§9)
});

export function subscribeDevice(deviceId) {
  socket.emit('subscribe', deviceId);
}
export function unsubscribeDevice(deviceId) {
  socket.emit('unsubscribe', deviceId);
}
