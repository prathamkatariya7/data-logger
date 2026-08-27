// Thin fetch wrappers around the REST API (architecture doc §7).

async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
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

export const api = {
  listDevices: () => req('/api/devices'),
  renameDevice: (id, display_name) =>
    req(`/api/devices/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ display_name }),
    }),
  deviceData: (id) => req(`/api/devices/${encodeURIComponent(id)}/data`),

  channel: (id, type, num) =>
    req(`/api/devices/${encodeURIComponent(id)}/channels/${type}/${num}`),
  saveFormula: (id, type, num, params) =>
    req(`/api/devices/${encodeURIComponent(id)}/channels/${type}/${num}/formula`, {
      method: 'PUT',
      body: JSON.stringify(params),
    }),
  setMaster: (id, type, num, reference_c) =>
    req(`/api/devices/${encodeURIComponent(id)}/channels/${type}/${num}/master`, {
      method: 'PUT',
      body: JSON.stringify({ reference_c }),
    }),
  clearMaster: (id, type, num) =>
    req(`/api/devices/${encodeURIComponent(id)}/channels/${type}/${num}/master`, {
      method: 'DELETE',
    }),
  readings: (id, type, num, limit = 50) =>
    req(`/api/devices/${encodeURIComponent(id)}/channels/${type}/${num}/readings?limit=${limit}`),
  clearChannelLog: (id, type, num) =>
    req(`/api/devices/${encodeURIComponent(id)}/channels/${type}/${num}/clear-log`, {
      method: 'POST',
    }),
  clearDeviceLog: (id) =>
    req(`/api/devices/${encodeURIComponent(id)}/clear-log`, { method: 'POST' }),
};

// Build a query string from defined, non-empty params.
function qs(params) {
  const s = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return s ? `?${s}` : '';
}

// Direct download URLs (used as <a href>). from/to are optional datetime-local
// strings ("YYYY-MM-DDTHH:MM") that bound the export.
export const downloadUrls = {
  channelCsv: (id, type, num, withMaster, from, to) =>
    `/api/devices/${encodeURIComponent(id)}/channels/${type}/${num}/log.csv` +
    qs({ with_master: withMaster, from, to }),
  deviceCsv: (id, withMaster, from, to) =>
    `/api/devices/${encodeURIComponent(id)}/download/all.csv` +
    qs({ with_master: withMaster, from, to }),
};
