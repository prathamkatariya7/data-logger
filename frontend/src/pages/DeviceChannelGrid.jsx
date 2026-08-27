import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, downloadUrls } from '../lib/api.js';
import { socket, subscribeDevice, unsubscribeDevice } from '../lib/socket.js';
import ChannelCard from '../components/ChannelCard.jsx';
import DownloadPanel from '../components/DownloadPanel.jsx';

// Page 2 — Device Channel Grid (R2): all channels at a glance, live.
export default function DeviceChannelGrid() {
  const { id } = useParams();
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      setSnap(await api.deviceData(id));
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  }, [id]);

  useEffect(() => {
    load();
    subscribeDevice(id);
    const onUpdate = (s) => { if (s && s.device_id === id) setSnap(s); };
    const onStatus = (st) => {
      if (st.device_id === id) setSnap((prev) => (prev ? { ...prev, active: st.active } : prev));
    };
    socket.on('device:update', onUpdate);
    socket.on('device:status', onStatus);
    return () => {
      unsubscribeDevice(id);
      socket.off('device:update', onUpdate);
      socket.off('device:status', onStatus);
    };
  }, [id, load]);

  if (err) return <div className="error">{err} <Link to="/">Back</Link></div>;
  if (!snap) return <p className="muted">Loading…</p>;

  return (
    <div className="grid-page">
      <div className="page-head">
        <div>
          <Link to="/" className="back">← Devices</Link>
          <h1>{snap.display_name} <span className={`status-dot ${snap.active ? 'online' : 'offline'}`} /></h1>
          <code className="muted">{snap.device_id}</code>
        </div>
      </div>

      <h2>PT100 channels</h2>
      <div className="channel-grid">
        {snap.pt100.map((ch) => (
          <ChannelCard key={`pt100-${ch.channel_num}`} deviceId={id} ch={ch} />
        ))}
      </div>

      <h2>Thermocouple channels</h2>
      <div className="channel-grid">
        {snap.tc.map((ch) => (
          <ChannelCard key={`tc-${ch.channel_num}`} deviceId={id} ch={ch} />
        ))}
      </div>

      <DownloadPanel
        title="Download all channels"
        buildUrl={(withMaster, from, to) => downloadUrls.deviceCsv(id, withMaster, from, to)}
      />
    </div>
  );
}
