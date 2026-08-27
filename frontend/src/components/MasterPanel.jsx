import { useState } from 'react';
import { api } from '../lib/api.js';

// Master calibration panel (R5 / R6).
export default function MasterPanel({ deviceId, type, num, master, onChanged }) {
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function setMaster() {
    const v = Number(ref);
    if (!Number.isFinite(v)) { setErr('Enter a numeric reference temperature'); return; }
    setBusy(true); setErr('');
    try {
      await api.setMaster(deviceId, type, num, v);
      setRef('');
      onChanged?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearMaster() {
    setBusy(true); setErr('');
    try {
      await api.clearMaster(deviceId, type, num);
      onChanged?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>Master calibration</h3>
      {master?.enabled ? (
        <div className="master-status">
          <div>Reference: <strong>{Number(master.reference_c).toFixed(2)} °C</strong></div>
          <div>Error factor (offset): <strong>{Number(master.error_factor).toFixed(3)} °C</strong></div>
          <div className="muted">Set at {master.set_at ? new Date(master.set_at).toLocaleString() : '—'}</div>
        </div>
      ) : (
        <p className="muted">No master calibration. Enter a physically-verified temperature to derive an offset.</p>
      )}

      <div className="master-form">
        <label>
          <span>Reference temperature (°C)</span>
          <input
            type="number"
            step="any"
            value={ref}
            placeholder="e.g. 25.0"
            onChange={(e) => setRef(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setMaster(); }}
          />
        </label>
        <div className="panel-actions">
          <button onClick={setMaster} disabled={busy}>{master?.enabled ? 'Recalibrate master' : 'Set master'}</button>
          {master?.enabled && (
            <button className="danger" onClick={clearMaster} disabled={busy}>Clear master</button>
          )}
        </div>
      </div>
      {err && <div className="error">{err}</div>}
    </section>
  );
}
