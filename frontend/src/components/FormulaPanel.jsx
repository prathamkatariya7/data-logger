import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const PT100_FIELDS = ['R0', 'RA', 'RC', 'R1', 'RF', 'VDC', 'ALPHA'];

// Formula parameter editor (R4). Editing params changes the calculated value
// going forward; it does NOT recompute an existing master error factor (§6).
export default function FormulaPanel({ deviceId, type, num, params, masterEnabled, onSaved }) {
  const [form, setForm] = useState(params || {});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { setForm(params || {}); }, [params]);

  const fields = type === 'pt100' ? PT100_FIELDS : ['slope'];

  async function save() {
    setBusy(true); setMsg(''); setErr('');
    try {
      const payload = {};
      for (const f of fields) payload[f] = Number(form[f]);
      const res = await api.saveFormula(deviceId, type, num, payload);
      setMsg('Saved.' + (res.master_recalibration_recommended ? ' Master offset unchanged — recalibrate if you want to re-verify.' : ''));
      onSaved?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>Formula parameters</h3>
      <div className="formula-grid">
        {fields.map((f) => (
          <label key={f}>
            <span>{f}</span>
            <input
              type="number"
              step="any"
              value={form[f] ?? ''}
              onChange={(e) => setForm({ ...form, [f]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="panel-actions">
        <button onClick={save} disabled={busy}>Save formula</button>
      </div>
      {masterEnabled && (
        <p className="hint">A master calibration is set. Changing the formula shifts the master value too but keeps the same offset — recalibrate if you want to re-verify against the reference thermometer.</p>
      )}
      {msg && <div className="ok">{msg}</div>}
      {err && <div className="error">{err}</div>}
    </section>
  );
}
