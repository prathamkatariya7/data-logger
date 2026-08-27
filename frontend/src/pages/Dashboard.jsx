import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';
import DeviceCard from '../components/DeviceCard.jsx';

// Page 1 — Dashboard (R1): active + available devices, rename inline.
export default function Dashboard() {
  const [devices, setDevices] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setDevices(await api.listDevices());
      setErr('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Refresh on list changes (new device / rename) and poll as a fallback so
    // active/offline stays fresh even without a WS event.
    const onChanged = () => load();
    socket.on('devices:changed', onChanged);
    const t = setInterval(load, 5000);
    return () => {
      socket.off('devices:changed', onChanged);
      clearInterval(t);
    };
  }, [load]);

  const active = devices.filter((d) => d.active);
  const offline = devices.filter((d) => !d.active);

  return (
    <div className="dashboard">
      <h1>Devices</h1>
      {err && <div className="error">{err}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : devices.length === 0 ? (
        <p className="muted">No devices have reported yet. Once a logger POSTs to <code>/api/ingest</code> it appears here.</p>
      ) : (
        <>
          <section>
            <h2>Active <span className="count">{active.length}</span></h2>
            {active.length === 0 ? (
              <p className="muted">No devices online right now.</p>
            ) : (
              <div className="device-list">
                {active.map((d) => <DeviceCard key={d.device_id} device={d} onRenamed={load} />)}
              </div>
            )}
          </section>

          <section>
            <h2>Available (all seen) <span className="count">{devices.length}</span></h2>
            <div className="device-list">
              {devices.map((d) => <DeviceCard key={d.device_id} device={d} onRenamed={load} />)}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
