import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';
import { useToast } from '../lib/toast.jsx';

function kindLabel(k) {
  if (k === 'high') return <span className="alarm-kind">HIGH</span>;
  if (k === 'low') return <span className="alarm-kind low">LOW</span>;
  return <span className="badge muted">CLEAR</span>;
}

// Alarm event log for a device, with live updates over Socket.IO.
export default function AlarmsPanel({ deviceId }) {
  const toast = useToast();
  const [events, setEvents] = useState([]);

  const load = useCallback(async () => {
    try { setEvents(await api.alarmEvents(deviceId, 100)); } catch (_) { /* ignore */ }
  }, [deviceId]);

  useEffect(() => {
    load();
    const onEvent = (ev) => {
      if (!ev || ev.device_id !== deviceId) return;
      setEvents((prev) => [ev, ...prev].slice(0, 100));
      if (ev.kind !== 'clear') {
        toast.warn(`Alarm ${ev.kind.toUpperCase()}: ${ev.channel_type}_${ev.channel_num} = ${Number(ev.value).toFixed(1)}`);
        try { beep(); } catch (_) { /* audio may be blocked until user interacts */ }
      }
    };
    socket.on('alarm:event', onEvent);
    return () => socket.off('alarm:event', onEvent);
  }, [deviceId, load, toast]);

  async function clearLog() {
    if (!confirm('Clear the alarm event log?')) return;
    try { await api.clearAlarmEvents(deviceId); setEvents([]); } catch (e) { toast.error(e.message); }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Alarm log</h3>
        {events.length > 0 && <button className="ghost" onClick={clearLog}>Clear log</button>}
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Time</th><th>Channel</th><th>Event</th><th>Value</th><th>Threshold</th></tr></thead>
          <tbody>
            {events.length === 0 && <tr><td colSpan={5} className="muted">No alarm events.</td></tr>}
            {events.map((e, i) => (
              <tr key={`${e.id || e.ts}-${i}`}>
                <td>{new Date(e.ts).toLocaleString()}</td>
                <td>{e.channel_type}_{e.channel_num}</td>
                <td>{kindLabel(e.kind)}</td>
                <td>{e.value == null ? '—' : Number(e.value).toFixed(2)}</td>
                <td>{e.threshold == null ? '—' : Number(e.threshold).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Short WebAudio beep for alarm transitions.
let audioCtx = null;
function beep() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = 880;
  gain.gain.value = 0.05;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.18);
}
