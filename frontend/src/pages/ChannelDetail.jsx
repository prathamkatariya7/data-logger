import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, downloadUrls } from '../lib/api.js';
import { socket, subscribeDevice, unsubscribeDevice } from '../lib/socket.js';
import FormulaPanel from '../components/FormulaPanel.jsx';
import MasterPanel from '../components/MasterPanel.jsx';
import ReadingsTable from '../components/ReadingsTable.jsx';
import DownloadPanel from '../components/DownloadPanel.jsx';

function fmt(v) {
  return v == null ? '—' : `${Number(v).toFixed(2)} °C`;
}

const MAX_ROWS = 100;

// Page 3 — Channel Detail (R3, R4, R5, R6, R7).
export default function ChannelDetail() {
  const { id, type, num } = useParams();
  const [config, setConfig] = useState(null);
  const [live, setLive] = useState(null); // { raw_value, calculated_temp_c, master_temp_c }
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const nRef = useRef(parseInt(num, 10));

  const loadConfig = useCallback(async () => {
    try {
      const c = await api.channel(id, type, num);
      setConfig(c);
      if (c.latest) setLive(c.latest);
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  }, [id, type, num]);

  const loadReadings = useCallback(async () => {
    try {
      const r = await api.readings(id, type, num, MAX_ROWS);
      setRows(r);
    } catch (_) { /* table just stays empty */ }
  }, [id, type, num]);

  useEffect(() => {
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
      });
      setRows((prev) => [
        {
          ts: ch.ts,
          rtc_time: ch.rtc_time,
          rtc_date: ch.rtc_date,
          raw_value: ch.raw_value,
          calculated_temp_c: ch.calculated_temp_c,
          master_temp_c: ch.master_temp_c,
          error_factor: ch.error_factor,
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
    if (!confirm('Delete all stored readings for this channel? Calculated values keep flowing.')) return;
    try {
      await api.clearChannelLog(id, type, num);
      setRows([]);
    } catch (e) {
      setErr(e.message);
    }
  }

  if (err && !config) return <div className="error">{err} <Link to={`/devices/${id}`}>Back</Link></div>;
  if (!config) return <p className="muted">Loading…</p>;

  const label = type === 'pt100' ? `PT100 #${num}` : `TC #${num}`;
  const masterEnabled = config.master?.enabled;

  return (
    <div className="detail-page">
      <div className="page-head">
        <div>
          <Link to={`/devices/${encodeURIComponent(id)}`} className="back">← {config.device_id}</Link>
          <h1>{label}</h1>
        </div>
      </div>

      {/* Live big numbers (R3) */}
      <section className="live-numbers">
        <div className="big-number">
          <span className="value-label">Calculated</span>
          <span className="big calc">{fmt(live?.calculated_temp_c)}</span>
        </div>
        <div className="big-number">
          <span className="value-label">Master</span>
          <span className="big master">{masterEnabled ? fmt(live?.master_temp_c) : '—'}</span>
        </div>
        <div className="big-number">
          <span className="value-label">Raw ({type === 'pt100' ? 'mV' : 'raw12'})</span>
          <span className="big raw">{live?.raw_value == null ? '—' : Number(live.raw_value).toFixed(2)}</span>
        </div>
      </section>

      <div className="detail-panels">
        <FormulaPanel
          deviceId={id} type={type} num={num}
          params={config.formula_params}
          masterEnabled={masterEnabled}
          onSaved={loadConfig}
        />
        <MasterPanel
          deviceId={id} type={type} num={num}
          master={config.master}
          onChanged={loadConfig}
        />
      </div>

      <ReadingsTable rows={rows} />

      <DownloadPanel
        title="Downloads"
        buildUrl={(withMaster, from, to) => downloadUrls.channelCsv(id, type, num, withMaster, from, to)}
        extra={<button className="danger" onClick={clearChannelLog}>Clear channel readings</button>}
      />
    </div>
  );
}
