import { useEffect, useState } from 'react';
import { api, downloadUrls } from '../lib/api.js';

// Export panel: CSV / XLSX / JSON with an optional date-time range and
// session scope, plus a printable report (device-level only).
//   kind = 'channel' | 'device'
export default function ExportPanel({ deviceId, kind, type, num, extra = null }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [withMaster, setWithMaster] = useState(true);
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    let active = true;
    api.sessions(deviceId, 50).then((s) => { if (active) setSessions(s); }).catch(() => {});
    return () => { active = false; };
  }, [deviceId]);

  const args = [withMaster, from || undefined, to || undefined, sessionId || undefined];
  const url = (fmt) =>
    kind === 'channel'
      ? downloadUrls.channel(deviceId, type, num, fmt, ...args)
      : downloadUrls.device(deviceId, fmt, ...args);

  return (
    <section className="panel">
      <div className="panel-head"><h3>Export</h3></div>

      <div className="field-row">
        <label className="field"><span>From</span>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>To</span>
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="field"><span>Session</span>
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">All data</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.reading_count})
              </option>
            ))}
          </select></label>
        {(from || to || sessionId) && (
          <button className="ghost" onClick={() => { setFrom(''); setTo(''); setSessionId(''); }}>Clear</button>
        )}
      </div>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '10px 0', width: 'auto' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={withMaster} onChange={(e) => setWithMaster(e.target.checked)} />
        <span className="small">Include master column(s)</span>
      </label>

      <div className="panel-actions">
        <a className="btn" href={url('csv')}>CSV</a>
        <a className="btn secondary" href={url('xlsx')}>Excel</a>
        <a className="btn secondary" href={url('json')}>JSON</a>
        {kind === 'device' && (
          <a className="btn ghost" href={downloadUrls.report(deviceId, sessionId || undefined, from || undefined, to || undefined)} target="_blank" rel="noreferrer">
            Open report
          </a>
        )}
        {extra}
      </div>
      <p className="muted small">Leave range and session empty to export everything.</p>
    </section>
  );
}
