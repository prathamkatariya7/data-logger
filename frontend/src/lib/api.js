// Thin fetch wrappers around the REST API.

async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  if (res.status === 401) {
    // Signal the app to show the login screen.
    window.dispatchEvent(new CustomEvent('auth:required'));
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).error || '';
    } catch (_) {
      detail = await res.text();
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

const enc = encodeURIComponent;

export const api = {
  // --- auth ---
  authStatus: () => req('/api/auth/status'),
  login: (username, password) =>
    req('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => req('/api/logout', { method: 'POST' }),

  // --- devices ---
  listDevices: () => req('/api/devices'),
  renameDevice: (id, display_name) =>
    req(`/api/devices/${enc(id)}`, { method: 'PATCH', body: JSON.stringify({ display_name }) }),
  deviceData: (id) => req(`/api/devices/${enc(id)}/data`),
  deviceSettings: (id, body) =>
    req(`/api/devices/${enc(id)}/settings`, { method: 'PATCH', body: JSON.stringify(body) }),
  diagnostics: (id) => req(`/api/devices/${enc(id)}/diagnostics`),

  // --- recording / sessions ---
  startRecording: (id, opts) =>
    req(`/api/devices/${enc(id)}/recording/start`, { method: 'POST', body: JSON.stringify(opts || {}) }),
  stopRecording: (id) => req(`/api/devices/${enc(id)}/recording/stop`, { method: 'POST' }),
  recordingState: (id) => req(`/api/devices/${enc(id)}/recording`),
  sessions: (id, limit = 50) => req(`/api/devices/${enc(id)}/sessions?limit=${limit}`),

  // --- alarms ---
  alarmEvents: (id, limit = 100) => req(`/api/devices/${enc(id)}/alarms?limit=${limit}`),
  clearAlarmEvents: (id) => req(`/api/devices/${enc(id)}/alarms/clear`, { method: 'POST' }),

  // --- channels ---
  channel: (id, type, num) => req(`/api/devices/${enc(id)}/channels/${type}/${num}`),
  updateChannelMeta: (id, type, num, body) =>
    req(`/api/devices/${enc(id)}/channels/${type}/${num}`, { method: 'PATCH', body: JSON.stringify(body) }),
  saveFormula: (id, type, num, params) =>
    req(`/api/devices/${enc(id)}/channels/${type}/${num}/formula`, { method: 'PUT', body: JSON.stringify(params) }),
  setMaster: (id, type, num, reference_c) =>
    req(`/api/devices/${enc(id)}/channels/${type}/${num}/master`, { method: 'PUT', body: JSON.stringify({ reference_c }) }),
  clearMaster: (id, type, num) =>
    req(`/api/devices/${enc(id)}/channels/${type}/${num}/master`, { method: 'DELETE' }),
  setAlarm: (id, type, num, body) =>
    req(`/api/devices/${enc(id)}/channels/${type}/${num}/alarm`, { method: 'PUT', body: JSON.stringify(body) }),
  clearAlarm: (id, type, num) =>
    req(`/api/devices/${enc(id)}/channels/${type}/${num}/alarm`, { method: 'DELETE' }),
  stats: (id, type, num, windowMs) =>
    req(`/api/devices/${enc(id)}/channels/${type}/${num}/stats?window_ms=${windowMs}`),
  readings: (id, type, num, limit = 50) =>
    req(`/api/devices/${enc(id)}/channels/${type}/${num}/readings?limit=${limit}`),
  clearChannelLog: (id, type, num) =>
    req(`/api/devices/${enc(id)}/channels/${type}/${num}/clear-log`, { method: 'POST' }),
  clearDeviceLog: (id) => req(`/api/devices/${enc(id)}/clear-log`, { method: 'POST' }),

  // --- user / profile ---
  me: () => req('/api/me'),
  changePassword: (current_password, new_password) =>
    req('/api/me/password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),

  // --- admin user management ---
  listUsers: () => req('/api/users'),
  createUser: (username, password, role) =>
    req('/api/users', { method: 'POST', body: JSON.stringify({ username, password, role }) }),
  deleteUser: (id) => req(`/api/users/${id}`, { method: 'DELETE' }),
  resetPassword: (id, new_password) =>
    req(`/api/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ new_password }) }),
  setUserRole: (id, role) =>
    req(`/api/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
};

// Build a query string from defined, non-empty params.
function qs(params) {
  const s = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${enc(v)}`)
    .join('&');
  return s ? `?${s}` : '';
}

// Direct download / report URLs (used as <a href>).
export const downloadUrls = {
  channel: (id, type, num, fmt, withMaster, from, to, session_id) =>
    `/api/devices/${enc(id)}/channels/${type}/${num}/log.${fmt}` +
    qs({ with_master: withMaster, from, to, session_id }),
  device: (id, fmt, withMaster, from, to, session_id) =>
    `/api/devices/${enc(id)}/download/all.${fmt}` +
    qs({ with_master: withMaster, from, to, session_id }),
  report: (id, session_id, from, to) =>
    `/api/devices/${enc(id)}/report` + qs({ session_id, from, to }),
};
