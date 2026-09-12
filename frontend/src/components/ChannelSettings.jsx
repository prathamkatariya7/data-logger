import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';

// Channel settings: rename, unit, enable/disable, and threshold alarms.
export default function ChannelSettings({ deviceId, type, num, meta, alarm, onChanged }) {
  const toast = useToast();
  const [name, setName] = useState(meta?.display_name || '');
  const [unit, setUnit] = useState(meta?.unit || '°C');
  const [enabled, setEnabled] = useState(meta?.enabled !== false);
  const [alarmEnabled, setAlarmEnabled] = useState(!!alarm?.enabled);
  const [low, setLow] = useState(alarm?.low ?? '');
  const [high, setHigh] = useState(alarm?.high ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(meta?.display_name || '');
    setUnit(meta?.unit || '°C');
    setEnabled(meta?.enabled !== false);
  }, [meta]);
  useEffect(() => {
    setAlarmEnabled(!!alarm?.enabled);
    setLow(alarm?.low ?? '');
    setHigh(alarm?.high ?? '');
  }, [alarm]);

  async function saveMeta() {
    if (!name.trim()) { toast.error('Name cannot be empty'); return; }
    setBusy(true);
    try {
      await api.updateChannelMeta(deviceId, type, num, { display_name: name.trim(), unit: unit.trim() || '°C', enabled });
      toast.success('Channel updated');
      onChanged?.();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  async function saveAlarm() {
    setBusy(true);
    try {
      if (!alarmEnabled) {
        await api.clearAlarm(deviceId, type, num);
      } else {
        await api.setAlarm(deviceId, type, num, {
          enabled: true,
          low: low === '' ? null : Number(low),
          high: high === '' ? null : Number(high),
        });
      }
      toast.success('Alarm settings saved');
      onChanged?.();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="panel">
      <div className="panel-head"><h3>Channel settings</h3></div>

      <div className="settings-grid">
        <label className="field"><span>Display name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="e.g. Reactor inlet" /></label>
        <label className="field"><span>Unit</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={16} /></label>
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '12px 0', width: 'auto' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span className="small">Channel enabled (disabled channels are hidden and excluded from exports)</span>
      </label>
      <div className="panel-actions">
        <button onClick={saveMeta} disabled={busy}>Save channel</button>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 12, width: 'auto' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={alarmEnabled} onChange={(e) => setAlarmEnabled(e.target.checked)} />
        <span className="small"><strong>Enable threshold alarm</strong></span>
      </label>
      <div className="settings-grid">
        <label className="field"><span>Low limit ({unit})</span>
          <input type="number" step="any" value={low} disabled={!alarmEnabled} onChange={(e) => setLow(e.target.value)} placeholder="none" /></label>
        <label className="field"><span>High limit ({unit})</span>
          <input type="number" step="any" value={high} disabled={!alarmEnabled} onChange={(e) => setHigh(e.target.value)} placeholder="none" /></label>
      </div>
      <div className="panel-actions">
        <button onClick={saveAlarm} disabled={busy}>Save alarm</button>
      </div>
    </section>
  );
}
