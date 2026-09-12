import { Link } from 'react-router-dom';

function fmt(v, unit) {
  return v == null ? '—' : `${Number(v).toFixed(2)}${unit ? ' ' + unit : ''}`;
}

// One channel tile on the device grid: calculated + master side by side.
export default function ChannelCard({ deviceId, ch }) {
  const fallback = ch.channel_type === 'pt100' ? `PT100_${ch.channel_num}` : `TC_${ch.channel_num}`;
  const label = ch.display_name || fallback;
  const unit = ch.unit || '°C';
  const unavailable = ch.channel_type === 'pt100' && ch.hw_available === false;
  const faulted = ch.channel_type === 'tc' && ch.fault === true;
  const alarmClass = ch.alarm_status === 'high' ? 'alarm-high' : ch.alarm_status === 'low' ? 'alarm-low' : '';

  return (
    <Link
      className={`channel-card ${ch.stale ? 'stale' : ''} ${ch.enabled === false ? 'disabled' : ''} ${alarmClass}`}
      to={`/devices/${encodeURIComponent(deviceId)}/${ch.channel_type}/${ch.channel_num}`}
    >
      <div className="channel-card-head">
        <span className="channel-label">{label}</span>
        {ch.master_enabled && <span className="badge">master</span>}
        {ch.alarm_status === 'high' && <span className="badge warn">high</span>}
        {ch.alarm_status === 'low' && <span className="badge warn">low</span>}
        {unavailable && <span className="badge muted">no hw</span>}
        {faulted && <span className="badge warn">fault</span>}
      </div>
      <div className="channel-card-values">
        <div>
          <span className="value-label">Calculated</span>
          <span className="value calc">{fmt(ch.calculated_temp_c, unit)}</span>
        </div>
        <div>
          <span className="value-label">Master</span>
          <span className="value master">{ch.master_enabled ? fmt(ch.master_temp_c, unit) : '—'}</span>
        </div>
      </div>
      <div className="value-label" style={{ marginTop: 8, opacity: 0.7 }}>{fallback}</div>
    </Link>
  );
}
