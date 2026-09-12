function rssiLabel(rssi) {
  if (rssi == null) return '—';
  let q = 'poor';
  if (rssi >= -55) q = 'excellent';
  else if (rssi >= -67) q = 'good';
  else if (rssi >= -75) q = 'fair';
  return `${rssi} dBm (${q})`;
}
function heapLabel(h) {
  if (h == null) return '—';
  return `${(h / 1024).toFixed(0)} KB`;
}
function uptimeLabel(ms) {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d > 0 ? d + 'd ' : ''}${h}h ${m}m`;
}

// Device health / diagnostics panel (fed from the live snapshot).
export default function DiagnosticsPanel({ snapshot }) {
  const d = snapshot?.diagnostics || {};
  return (
    <section className="panel">
      <div className="panel-head"><h3>Diagnostics</h3></div>
      <div className="diag-grid">
        <div className="diag-item"><span className="value-label">Connection</span>
          <span className="diag-value">{snapshot?.active ? 'Online' : 'Offline'}</span></div>
        <div className="diag-item"><span className="value-label">ATmega node</span>
          <span className="diag-value">{d.atmega_online ? 'Online' : 'Offline'}</span></div>
        <div className="diag-item"><span className="value-label">WiFi signal</span>
          <span className="diag-value">{rssiLabel(d.wifi_rssi)}</span></div>
        <div className="diag-item"><span className="value-label">Free heap</span>
          <span className="diag-value">{heapLabel(d.free_heap)}</span></div>
        <div className="diag-item"><span className="value-label">ESP uptime</span>
          <span className="diag-value">{uptimeLabel(d.esp_uptime_ms)}</span></div>
        <div className="diag-item"><span className="value-label">I2C fails</span>
          <span className="diag-value">{d.i2c_consec_fails ?? '—'}</span></div>
        <div className="diag-item"><span className="value-label">Firmware</span>
          <span className="diag-value">{d.fw_version || '—'}</span></div>
        <div className="diag-item"><span className="value-label">Last seen</span>
          <span className="diag-value" style={{ fontSize: '0.85rem' }}>
            {snapshot?.last_seen ? new Date(snapshot.last_seen).toLocaleTimeString() : '—'}
          </span></div>
      </div>
    </section>
  );
}
