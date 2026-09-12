import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';

const RATE_OPTIONS = [
  { label: '1 / sec', ms: 1000 },
  { label: '1 / 2 sec', ms: 2000 },
  { label: '1 / 5 sec', ms: 5000 },
  { label: '1 / 10 sec', ms: 10000 },
  { label: '1 / 30 sec', ms: 30000 },
  { label: '1 / min', ms: 60000 },
];

function durationStr(startIso) {
  if (!startIso) return '';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
}

// Per-device Start/Stop with named sessions + storage-rate selector.
// Live view keeps updating even while stopped (server keeps an in-memory cache).
export default function RecordingBar({ deviceId, recording, session, sampleIntervalMs, onChanged }) {
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [operator, setOperator] = useState('');
  const [notes, setNotes] = useState('');
  const [rate, setRate] = useState(sampleIntervalMs || 1000);
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);

  useEffect(() => { setRate(sampleIntervalMs || 1000); }, [sampleIntervalMs]);

  // Tick the live duration display once a second while recording.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  async function start() {
    setBusy(true);
    try {
      await api.startRecording(deviceId, {
        name: name.trim() || `Session ${new Date().toLocaleString()}`,
        operator: operator.trim() || undefined,
        notes: notes.trim() || undefined,
        sample_interval_ms: rate,
      });
      toast.success('Recording started');
      setShowForm(false);
      setName(''); setOperator(''); setNotes('');
      onChanged?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!confirm('Stop recording this session?')) return;
    setBusy(true);
    try {
      await api.stopRecording(deviceId);
      toast.info('Recording stopped');
      onChanged?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const rateLabel = RATE_OPTIONS.find((r) => r.ms === (sampleIntervalMs || 1000))?.label || `${sampleIntervalMs} ms`;

  return (
    <div className={`recording-bar ${recording ? 'is-recording' : ''}`}>
      <div className="rec-indicator">
        <span className={`rec-dot ${recording ? 'live' : ''}`} />
        {recording ? 'Recording' : 'Not recording'}
      </div>

      {recording && session ? (
        <div className="rec-session-meta">
          <strong>{session.name}</strong>
          {session.operator ? ` · ${session.operator}` : ''} · {durationStr(session.started_at)} · {rateLabel}
        </div>
      ) : (
        <div className="rec-session-meta">Live view stays on; data is only stored while recording.</div>
      )}

      <div className="header-spacer" />

      {recording ? (
        <button className="danger" onClick={stop} disabled={busy}>■ Stop</button>
      ) : showForm ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field"><span>Session name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Batch #42" /></label>
          <label className="field"><span>Operator</span>
            <input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="optional" /></label>
          <label className="field"><span>Storage rate</span>
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {RATE_OPTIONS.map((r) => <option key={r.ms} value={r.ms}>{r.label}</option>)}
            </select></label>
          <button onClick={start} disabled={busy}>● Start</button>
          <button className="ghost" onClick={() => setShowForm(false)} disabled={busy}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)}>● Start recording</button>
      )}
    </div>
  );
}
