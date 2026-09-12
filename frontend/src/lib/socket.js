import { io } from 'socket.io-client';

// One shared Socket.IO connection for the whole app. Connects to the same
// origin the page was served from (works on the LAN IP automatically). When
// dashboard auth is enabled, the httpOnly cookie is sent on the WS handshake
// (same-origin), so no explicit token is needed here.
export const socket = io({
  autoConnect: true,
  withCredentials: true,
  transports: ['websocket', 'polling'], // WS primary, HTTP polling fallback
});

export function subscribeDevice(deviceId) {
  socket.emit('subscribe', deviceId);
}
export function unsubscribeDevice(deviceId) {
  socket.emit('unsubscribe', deviceId);
}
