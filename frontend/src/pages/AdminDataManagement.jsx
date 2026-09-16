import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function AdminDataManagement() {
  const [stats, setStats] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewCount, setPreviewCount] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [vacuuming, setVacuuming] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Filters state
  const [deviceId, setDeviceId] = useState('all');
  const [channelType, setChannelType] = useState('all');
  const [channelNum, setChannelNum] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [target, setTarget] = useState('db'); // 'db' | 's3' | 'both'
  const [autoVacuum, setAutoVacuum] = useState(true);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await api.adminDataStats();
      setStats(data);
      setDevices(data.devices || []);
      setErr('');
    } catch (e) {
      setErr('Failed to load storage stats: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const getFilterPayload = () => ({
    device_id: deviceId,
    channel_type: channelType,
    channel_num: channelNum === 'all' ? 'all' : Number(channelNum),
    start_date: startDate || null,
    end_date: endDate || null,
  });

  const handlePreview = async () => {
    try {
      setPreviewing(true);
      setMsg('');
      setErr('');
      const res = await api.adminDataCount(getFilterPayload());
      setPreviewCount(res.count);
    } catch (e) {
      setErr('Count preview failed: ' + e.message);
    } finally {
      setPreviewing(false);
    }
  };

  const handleDelete = async () => {
    const scopeLabel = target === 'db' ? 'local DB' : target === 's3' ? 'S3 archives' : 'local DB and S3 archives';
    const confirmMsg =
      deviceId === 'all' && channelType === 'all' && !startDate && !endDate
        ? `⚠️ CRITICAL: Are you sure you want to DELETE ALL SENSOR DATA from ${scopeLabel}? This action CANNOT be undone!`
        : `Are you sure you want to delete matching readings from ${scopeLabel}?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      setDeleting(true);
      setMsg('');
      setErr('');
      const payload = {
        ...getFilterPayload(),
        target,
        vacuum: autoVacuum,
      };
      const res = await api.adminDataDelete(payload);
      setMsg(`Deletion complete! Deleted ${res.db_deleted} DB readings, ${res.s3_deleted} S3 archives.`);
      setPreviewCount(null);
      loadStats();
    } catch (e) {
      setErr('Deletion failed: ' + e.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleVacuumNow = async () => {
    try {
      setVacuuming(true);
      setMsg('');
      setErr('');
      await api.adminDataVacuum();
      setMsg('Database compacted and disk space reclaimed successfully!');
    } catch (e) {
      setErr('Vacuum failed: ' + e.message);
    } finally {
      setVacuuming(false);
    }
  };

  if (loading) return <p className="muted">Loading data management statistics…</p>;

  return (
    <div className="admin-page" style={{ maxWidth: '900px', margin: '0 auto', padding: '1rem' }}>
      <h2>Admin Data Management & Purge</h2>
      <p className="muted">
        Manage system storage, run filtered sensor data deletion across local SQLite and AWS S3, and reclaim disk space.
      </p>

      {msg && <div className="banner success" style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: '4px' }}>{msg}</div>}
      {err && <div className="banner error" style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '4px' }}>{err}</div>}

      {/* Storage Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card-panel" style={{ padding: '1rem', textAlign: 'center' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)' }}>Total Local Readings</h4>
          <span style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>{stats?.total_readings?.toLocaleString()}</span>
        </div>
        <div className="card-panel" style={{ padding: '1rem', textAlign: 'center' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)' }}>S3 Archives</h4>
          <span style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>{stats?.total_archives}</span>
          <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: stats?.s3_configured ? '#10b981' : '#f59e0b' }}>
            {stats?.s3_configured ? 'S3 Configured' : 'S3 Not Configured'}
          </div>
        </div>
        <div className="card-panel" style={{ padding: '1rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <button
            className="secondary"
            onClick={handleVacuumNow}
            disabled={vacuuming}
            title="Reclaim free space from SQLite WAL / DB file"
          >
            {vacuuming ? 'Compacting…' : '🧹 Vacuum Database'}
          </button>
          <span style={{ fontSize: '0.75rem', marginTop: '0.5rem' }} className="muted">
            Frees unused database file space
          </span>
        </div>
      </div>

      {/* Deletion & Filter Form */}
      <div className="card-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3>Filtered Sensor Data Deletion</h3>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Select target filters to delete specific channel data, date ranges, or entire device histories.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', margin: '1rem 0' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500' }}>Device</label>
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} style={{ width: '100%', padding: '0.5rem' }}>
              <option value="all">-- All Devices --</option>
              {devices.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.display_name} ({d.reading_count.toLocaleString()} rows)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500' }}>Channel Type</label>
            <select value={channelType} onChange={(e) => setChannelType(e.target.value)} style={{ width: '100%', padding: '0.5rem' }}>
              <option value="all">-- All Types (PT100 & TC) --</option>
              <option value="pt100">PT100</option>
              <option value="tc">Thermocouple (TC)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500' }}>Channel Number</label>
            <select value={channelNum} onChange={(e) => setChannelNum(e.target.value)} style={{ width: '100%', padding: '0.5rem' }}>
              <option value="all">-- All Channels --</option>
              {[...Array(12).keys()].map((n) => (
                <option key={n} value={n}>
                  Channel {n}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500' }}>From Date</label>
            <input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ width: '100%', padding: '0.45rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500' }}>To Date</label>
            <input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ width: '100%', padding: '0.45rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500' }}>Target Location</label>
            <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: '100%', padding: '0.5rem' }}>
              <option value="db">Local Database Only</option>
              <option value="s3">AWS S3 Archives Only</option>
              <option value="both">Both (Local DB + S3 Archives)</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color, #333)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
            <input
              type="checkbox"
              checked={autoVacuum}
              onChange={(e) => setAutoVacuum(e.target.checked)}
            />
            Auto-vacuum database after deletion to reclaim disk space
          </label>
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.25rem' }}>
          <button className="secondary" onClick={handlePreview} disabled={previewing}>
            {previewing ? 'Counting…' : '🔍 Preview Count'}
          </button>

          <button className="primary danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : '🗑️ Delete Selected Data'}
          </button>
        </div>

        {previewCount !== null && (
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--bg-card-hover, rgba(255,255,255,0.05))', borderRadius: '4px' }}>
            📊 Filter match: <strong>{previewCount.toLocaleString()}</strong> readings found in local database matching these filters.
          </div>
        )}
      </div>

      {/* Per Device Overview Table */}
      <div className="card-panel" style={{ padding: '1.5rem' }}>
        <h3>Per-Device Storage Breakdown</h3>
        <table className="data-table" style={{ width: '100%', marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>Device Name</th>
              <th>Device ID</th>
              <th>Local Readings</th>
              <th>S3 Archives</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.device_id}>
                <td>{d.display_name}</td>
                <td><code>{d.device_id}</code></td>
                <td>{d.reading_count.toLocaleString()}</td>
                <td>{d.archive_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
