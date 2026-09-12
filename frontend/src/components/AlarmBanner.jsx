// Active-alarm banner shown at the top of a device/channel page. `alarms` is a
// list of { channel_type, channel_num, display_name, status, value, unit }.
export default function AlarmBanner({ alarms }) {
  if (!alarms || alarms.length === 0) return null;
  return (
    <div className="alarm-banner" role="alert">
      <span style={{ fontSize: '1.2rem' }}>⚠</span>
      <span>
        {alarms.length} active alarm{alarms.length > 1 ? 's' : ''}:{' '}
        {alarms
          .map((a) => `${a.display_name} ${a.status === 'high' ? '▲' : '▼'} ${a.value == null ? '' : Number(a.value).toFixed(1)}${a.unit || ''}`)
          .join(', ')}
      </span>
    </div>
  );
}
