import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { socket, subscribeDevice, unsubscribeDevice } from '../lib/socket.js';
import { useToast } from '../lib/toast.jsx';
import FormulaPanel from '../components/FormulaPanel.jsx';
import MasterPanel from '../components/MasterPanel.jsx';
import ReadingsTable from '../components/ReadingsTable.jsx';
import ExportPanel from '../components/ExportPanel.jsx';
import ChannelSettings from '../components/ChannelSettings.jsx';
import StatsPanel from '../components/StatsPanel.jsx';
import ChartPanel from '../components/ChartPanel.jsx';
import AlarmBanner from '../components/AlarmBanner.jsx';

const MAX_ROWS = 100;
const MAX_POINTS = 300;

function fmt(v, unit) {
  return v == null ? '—' : `${Number(v).toFixed(2)}${unit ? ' ' + unit : ''}`;
}

export default function ChannelDetail() {
  const { id, type, num } = useParams();
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [live, setLive] = useState(null);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const nRef = useRef(parseInt(num, 10));
  const bufferRef = useRef([]);
  const [, forceChart] = useState(0);

  const loadConfig = useCallback(async () => {
    try {
      const c = await api.channel(id, type, num);
      setConfig(c);
      if (c.latest) setLive(c.latest);
      setErr('');
    } catch (e) { setErr(e.message); }
  }, [id, type, num]);

  const loadReadings = useCallback(async () => {
    try { setRows(await api.readings(id, type, num, MAX_ROWS)); } catch (_) { /* empty */ }
  }, [id, type, num]);

  useEffect(() => {
    nRef.current = parseInt(num, 10);
    bufferRef.current = [];
    loadConfig();
    loadReadings();
    subscribeDevice(id);

    const onUpdate = (snap) => {
      if (!snap || snap.device_id !== id) return;
      const list = type === 'pt100' ? snap.pt100 : snap.tc;
      const ch = list.find((c) => c.channel_num === nRef.current);
      if (!ch) return;
      setLive({
        raw_value: ch.raw_value,
        calculated_temp_c: ch.calculated_temp_c,
        master_temp_c: ch.master_temp_c,
        alarm_status: ch.alarm_status,
      });
      const buf = bufferRef.current;
      buf.push({ t: Date.now(), v: ch.calculated_temp_c });
      if (buf.length > MAX_POINTS) buf.shift();
      forceChart((n) => n + 1);
      setRows((prev) => [
        {
          ts: ch.ts, rtc_time: ch.rtc_time, rtc_date: ch.rtc_date,
          raw_value: ch.raw_value, calculated_temp_c: ch.calculated_temp_c,
          master_temp_c: ch.master_temp_c, error_factor: ch.error_factor,
        },
        ...prev,
      ].slice(0, MAX_ROWS));
    };

    socket.on('device:update', onUpdate);
    return () => {
      unsubscribeDevice(id);
      socket.off('device:update', onUpdate);
    };
  }, [id, type, num, loadConfig, loadReadings]);

  async function clearChannelLog() {
    if (!confirm('Delete all stored readings for this channel? Live values keep flowing.')) return;
    try { await api.clearChannelLog(id, type, num); setRows([]); toast.info('Channel readings cleared'); }
    catch (e) { toast.error(e.message); }
  }

  if (err && !config) return <div className="error">{err} <Link to={`/devices/${id}`}>Back</Link></div>;
  if (!config) return <p className="muted">Loading…</p>;

  const fallback = type === 'pt100' ? `PT100_${num}` : `TC_${num}`;
  const label = config.display_name || fallback;
  const unit = config.unit || '°C';
  const masterEnabled = config.master?.enabled;
  const alarmStatus = live?.alarm_status;

  const banner = alarmStatus && alarmStatus !== 'normal'
    ? [{ display_name: label, status: alarmStatus, value: live?.calculated_temp_c, unit }]
    : [];

  return (
    <div className="detail-page">
      <div className="page-head">
        <div>
          <Link to={`/devices/${encodeURIComponent(id)}`} className="back">← {config.device_id}</Link>
          <h1>{label} <span className="muted" style={{ fontSize: '0.9rem' }}>({fallback})</span></h1>
        </div>
      </div>

      <AlarmBanner alarms={banner} />

      <section className="live-numbers">
        <div className="big-number">
          <span className="value-label">Calculated</span>
          <span className="big calc">{fmt(live?.calculated_temp_c, unit)}</span>
        </div>
        <div className="big-number">
          <span className="value-label">Master</span>
          <span className="big master">{masterEnabled ? fmt(live?.master_temp_c, unit) : '—'}</span>
        </div>
        <div className="big-number">
          <span className="value-label">Raw ({type === 'pt100' ? 'mV' : 'raw12'})</span>
          <span className="big raw">{live?.raw_value == null ? '—' : Number(live.raw_value).toFixed(2)}</span>
        </div>
      </section>

      <ChartPanel
        title="Live trend"
        height={280}
        series={[{ key: 'v', name: label, color: 'var(--calc)', data: bufferRef.current }]}
      />

      <StatsPanel deviceId={id} type={type} num={num} unit={unit} refreshKey={refreshKey} />

      <div className="detail-panels">
        <FormulaPanel deviceId={id} type={type} num={num} params={config.formula_params} masterEnabled={masterEnabled} onSaved={loadConfig} />
        <MasterPanel deviceId={id} type={type} num={num} master={config.master} onChanged={loadConfig} />
      </div>

      <ChannelSettings
        deviceId={id} type={type} num={num}
        meta={{ display_name: config.display_name, unit: config.unit, enabled: config.enabled }}
        alarm={config.alarm}
        onChanged={() => { loadConfig(); setRefreshKey((k) => k + 1); }}
      />

      <ReadingsTable rows={rows} unit={unit} />

      <ExportPanel
        deviceId={id} kind="channel" type={type} num={num}
        extra={<button className="danger" onClick={clearChannelLog}>Clear channel readings</button>}
      />
    </div>
  );
}
