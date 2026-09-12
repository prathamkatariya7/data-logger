import { useEffect, useState, useCallback } from 'react';
import { api, downloadUrls } from '../lib/api.js';

function dur(s) {
  if (!s.ended_at) return 'active';
  const secs = Math.max(0, Math.floor((new Date(s.ended_at) - new Date(s.started_at)) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h > 0 ? h + 'h ' : ''}${m}m`;
}

// Recent recording sessions with per-session export links.
export default function SessionsPanel({ deviceId, refreshKey }) {
  const [sessions, setSessions] = useState([]);

  const load = useCallback(async () => {
    try { setSessions(await api.sessions(deviceId, 50)); } catch (_) { /* ignore */ }
  }, [deviceId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <section className="panel">
      <div className="panel-head"><h3>Recording sessions</h3></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Operator</th><th>Started</th><th>Duration</th><th>Samples</th><th>Export</th></tr></thead>
          <tbody>
            {sessions.length === 0 && <tr><td colSpan={6} className="muted">No sessions yet. Press Start recording to create one.</td></tr>}
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.name}{!s.ended_at && <span className="badge rec" style={{ marginLeft: 6 }}>live</span>}</td>
                <td>{s.operator || '—'}</td>
                <td>{new Date(s.started_at).toLocaleString()}</td>
                <td>{dur(s)}</td>
                <td>{s.reading_count}</td>
                <td style={{ display: 'flex', gap: 8 }}>
                  <a href={downloadUrls.device(deviceId, 'csv', true, undefined, undefined, s.id)}>CSV</a>
                  <a href={downloadUrls.device(deviceId, 'xlsx', true, undefined, undefined, s.id)}>Excel</a>
                  <a href={downloadUrls.report(deviceId, s.id)} target="_blank" rel="noreferrer">Report</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
