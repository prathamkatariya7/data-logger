import { Link } from 'react-router-dom';

function fmt(v) {
  return v == null ? '—' : `${Number(v).toFixed(2)} °C`;
}

// One channel tile on the device grid: calculated + master side by side (R2).
export default function ChannelCard({ deviceId, ch }) {
  const label = ch.channel_type === 'pt100' ? `PT100 #${ch.channel_num}` : `TC #${ch.channel_num}`;
  const unavailable = ch.channel_type === 'pt100' && ch.hw_available === false;
  const faulted = ch.channel_type === 'tc' && ch.fault === true;

  return (
    <Link
      className={`channel-card ${ch.stale ? 'stale' : ''}`}
      to={`/devices/${encodeURIComponent(deviceId)}/${ch.channel_type}/${ch.channel_num}`}
    >
      <div className="channel-card-head">
        <span className="channel-label">{label}</span>
        {ch.master_enabled && <span className="badge">master</span>}
        {unavailable && <span className="badge warn">no hw</span>}
        {faulted && <span className="badge warn">fault</span>}
      </div>
      <div className="channel-card-values">
        <div>
          <span className="value-label">Calculated</span>
          <span className="value calc">{fmt(ch.calculated_temp_c)}</span>
        </div>
        <div>
          <span className="value-label">Master</span>
          <span className="value master">{ch.master_enabled ? fmt(ch.master_temp_c) : '—'}</span>
        </div>
      </div>
    </Link>
  );
}
