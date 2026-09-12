import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';

const WINDOWS = [
  { label: '1 min', ms: 60000 },
  { label: '5 min', ms: 300000 },
  { label: '15 min', ms: 900000 },
  { label: '1 hour', ms: 3600000 },
  { label: '24 hours', ms: 86400000 },
];

function fmt(v, unit) {
  return v == null ? '—' : `${Number(v).toFixed(2)}${unit ? ' ' + unit : ''}`;
}

// Live statistics (min/max/avg/std-dev/count) over a trailing window.
// Only reflects PERSISTED readings, so it fills in while recording is active.
export default function StatsPanel({ deviceId, type, num, unit, refreshKey }) {
  const [windowMs, setWindowMs] = useState(300000);
  const [stats, setStats] = useState(null);

  const load = useCallback(async () => {
    try {
      setStats(await api.stats(deviceId, type, num, windowMs));
    } catch (_) { /* ignore */ }
  }, [deviceId, type, num, windowMs]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Statistics</h3>
        <div className="segmented">
          {WINDOWS.map((w) => (
            <button key={w.ms} className={windowMs === w.ms ? 'active' : ''} onClick={() => setWindowMs(w.ms)}>
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <div className="stats-row">
        <div className="stat-card"><span className="value-label">Min</span><span className="stat-value">{fmt(stats?.min, unit)}</span></div>
        <div className="stat-card"><span className="value-label">Avg</span><span className="stat-value">{fmt(stats?.avg, unit)}</span></div>
        <div className="stat-card"><span className="value-label">Max</span><span className="stat-value">{fmt(stats?.max, unit)}</span></div>
        <div className="stat-card"><span className="value-label">Std dev</span><span className="stat-value">{fmt(stats?.stddev, unit)}</span></div>
      </div>
      <p className="muted small">{stats?.count ?? 0} samples in window. Stats reflect recorded data only.</p>
    </section>
  );
}
