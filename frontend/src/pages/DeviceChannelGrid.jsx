import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { socket, subscribeDevice, unsubscribeDevice } from '../lib/socket.js';
import ChannelCard from '../components/ChannelCard.jsx';
import RecordingBar from '../components/RecordingBar.jsx';
import AlarmBanner from '../components/AlarmBanner.jsx';
import AlarmsPanel from '../components/AlarmsPanel.jsx';
import DiagnosticsPanel from '../components/DiagnosticsPanel.jsx';
import SessionsPanel from '../components/SessionsPanel.jsx';
import ChartPanel from '../components/ChartPanel.jsx';
import ExportPanel from '../components/ExportPanel.jsx';

const TABS = ['Overview', 'Charts', 'Sessions', 'Alarms', 'Diagnostics', 'Export'];
const CHART_COLORS = ['#4a9eff', '#34d399', '#f59e0b', '#a78bfa', '#f472b6', '#22d3ee', '#facc15', '#fb7185', '#4ade80', '#60a5fa', '#f97316', '#e879f9'];
const MAX_POINTS = 300;

function activeAlarms(snap) {
  if (!snap) return [];
  const all = [...(snap.pt100 || []), ...(snap.tc || [])];
  return all
    .filter((c) => c.alarm_status && c.alarm_status !== 'normal')
    .map((c) => ({
      display_name: c.display_name,
      status: c.alarm_status,
      value: c.calculated_temp_c,
      unit: c.unit,
    }));
}

export default function DeviceChannelGrid() {
  const { id } = useParams();
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('Overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const bufferRef = useRef(new Map()); // key -> [{t,v}]
  const [, forceChart] = useState(0);

  const load = useCallback(async () => {
    try { setSnap(await api.deviceData(id)); setErr(''); } catch (e) { setErr(e.message); }
  }, [id]);

  useEffect(() => {
    load();
    subscribeDevice(id);
    const onUpdate = (s) => {
      if (!s || s.device_id !== id) return;
      setSnap(s);
      // Accumulate chart buffer from enabled channels.
      const t = Date.now();
      const buf = bufferRef.current;
      for (const c of [...(s.pt100 || []), ...(s.tc || [])]) {
        if (c.enabled === false) continue;
        const key = `${c.channel_type}:${c.channel_num}`;
        const arr = buf.get(key) || [];
        arr.push({ t, v: c.calculated_temp_c });
        if (arr.length > MAX_POINTS) arr.shift();
        buf.set(key, arr);
      }
      forceChart((n) => n + 1);
    };
    const onStatus = (st) => {
      if (st.device_id === id) setSnap((prev) => (prev ? { ...prev, active: st.active } : prev));
    };
    const onRecording = () => load();
    socket.on('device:update', onUpdate);
    socket.on('device:status', onStatus);
    socket.on('device:recording', onRecording);
    return () => {
      unsubscribeDevice(id);
      socket.off('device:update', onUpdate);
      socket.off('device:status', onStatus);
      socket.off('device:recording', onRecording);
    };
  }, [id, load]);

  if (err) return <div className="error">{err} <Link to="/">Back</Link></div>;
  if (!snap) return <p className="muted">Loading…</p>;

  const alarms = activeAlarms(snap);
  const enabledChannels = [...snap.pt100, ...snap.tc].filter((c) => c.enabled !== false);
  const series = enabledChannels.map((c, i) => ({
    key: `${c.channel_type}:${c.channel_num}`,
    name: c.display_name || `${c.channel_type}_${c.channel_num}`,
    color: CHART_COLORS[i % CHART_COLORS.length],
    data: bufferRef.current.get(`${c.channel_type}:${c.channel_num}`) || [],
  }));

  return (
    <div className="grid-page">
      <div className="page-head">
        <div>
          <Link to="/" className="back">← Devices</Link>
          <h1>
            {snap.display_name} <span className={`status-dot ${snap.active ? 'online' : 'offline'}`} />
            {snap.recording && <span className="badge rec" style={{ marginLeft: 8 }}>REC</span>}
          </h1>
          <code className="muted">{snap.device_id}</code>
        </div>
      </div>

      <AlarmBanner alarms={alarms} />

      <RecordingBar
        deviceId={id}
        recording={snap.recording}
        session={snap.session}
        sampleIntervalMs={snap.sample_interval_ms}
        onChanged={() => { load(); setRefreshKey((k) => k + 1); }}
      />

      <div className="segmented" style={{ marginBottom: 18 }}>
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Overview' && (
        <>
          <h2>PT100 channels</h2>
          <div className="channel-grid">
            {snap.pt100.map((ch) => <ChannelCard key={`pt100-${ch.channel_num}`} deviceId={id} ch={ch} />)}
          </div>
          <h2>Thermocouple channels</h2>
          <div className="channel-grid">
            {snap.tc.map((ch) => <ChannelCard key={`tc-${ch.channel_num}`} deviceId={id} ch={ch} />)}
          </div>
        </>
      )}

      {tab === 'Charts' && (
        series.length ? <ChartPanel title="Live trend — all enabled channels" series={series} />
          : <p className="muted">No enabled channels to chart.</p>
      )}

      {tab === 'Sessions' && <SessionsPanel deviceId={id} refreshKey={refreshKey} />}
      {tab === 'Alarms' && <AlarmsPanel deviceId={id} />}
      {tab === 'Diagnostics' && <DiagnosticsPanel snapshot={snap} />}
      {tab === 'Export' && <ExportPanel deviceId={id} kind="device" />}
    </div>
  );
}
