import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

// One device row on the dashboard: status dot, name (inline rename), open button.
export default function DeviceCard({ device, onRenamed }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.display_name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === device.display_name) {
      setEditing(false);
      setName(device.display_name);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.renameDevice(device.device_id, trimmed);
      onRenamed?.();
      setEditing(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="device-card">
      <span className={`status-dot ${device.active ? 'online' : 'offline'}`} title={device.active ? 'active' : 'offline'} />
      <div className="device-card-body">
        {editing ? (
          <div className="rename-row">
            <input
              autoFocus
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') { setEditing(false); setName(device.display_name); }
              }}
            />
            <button onClick={save} disabled={busy}>Save</button>
            <button className="ghost" onClick={() => { setEditing(false); setName(device.display_name); }} disabled={busy}>Cancel</button>
          </div>
        ) : (
          <div className="device-card-title">
            <strong>{device.display_name}</strong>
            {device.recording && <span className="badge rec">REC</span>}
            <button className="link-btn" onClick={() => setEditing(true)}>rename</button>
          </div>
        )}
        <div className="device-card-meta">
          <code>{device.device_id}</code>
          <span>· {device.active ? 'active' : `last seen ${new Date(device.last_seen).toLocaleString()}`}</span>
        </div>
        {err && <div className="error">{err}</div>}
      </div>
      <Link
        className="btn"
        to={`/devices/${encodeURIComponent(device.device_id)}`}
      >
        Open
      </Link>
    </div>
  );
}
