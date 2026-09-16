import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function ArchivesPanel({ deviceId }) {
  const [archives, setArchives] = useState([]);
  const [s3Configured, setS3Configured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [keepDays, setKeepDays] = useState(7);

  const load = async () => {
    try {
      setLoading(true);
      const res = await api.listArchives(deviceId);
      setArchives(res.archives || []);
      setS3Configured(res.s3_configured);
      setErr('');
    } catch (e) {
      setErr('Failed to load archives: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [deviceId]);

  const handleExportNow = async () => {
    if (!window.confirm(`Archive data older than ${keepDays} days to S3 and prune from local database?`)) return;
    try {
      setExporting(true);
      setMsg('');
      setErr('');
      const res = await api.exportArchiveNow(deviceId, keepDays);
      setMsg(`Success: Archived ${res.rows} rows (${res.size_kb || 0} KB)`);
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = async (archiveId) => {
    try {
      const { url } = await api.getArchiveDownloadUrl(deviceId, archiveId);
      window.open(url, '_blank');
    } catch (e) {
      alert('Download error: ' + e.message);
    }
  };

  const handleDelete = async (archiveId) => {
    if (!window.confirm('Are you sure you want to permanently delete this archive file from S3?')) return;
    try {
      await api.deleteArchive(deviceId, archiveId);
      load();
    } catch (e) {
      alert('Delete error: ' + e.message);
    }
  };

  return (
    <div className="card-panel">
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ margin: 0 }}>S3 Historical Archives</h3>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Compressed historical log backups stored in AWS S3 Free Tier.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.85rem' }} className="muted">
            Keep Local Days:
            <input
              type="number"
              min="1"
              max="365"
              value={keepDays}
              onChange={(e) => setKeepDays(Number(e.target.value))}
              style={{ width: '60px', marginLeft: '0.5rem', padding: '4px' }}
            />
          </label>
          <button
            className="primary"
            onClick={handleExportNow}
            disabled={exporting || !s3Configured}
            title={!s3Configured ? 'Configure S3_BUCKET in server env first' : 'Manually trigger archival to S3'}
          >
            {exporting ? 'Archiving…' : 'Archive to S3 Now'}
          </button>
        </div>
      </div>

      {!s3Configured && (
        <div className="banner warning" style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
          ⚠️ AWS S3 is not configured. Historical archives require <code>S3_BUCKET</code> environment variable on the server.
        </div>
      )}

      {msg && <div className="banner success" style={{ marginBottom: '1rem', color: '#10b981' }}>{msg}</div>}
      {err && <div className="banner error" style={{ marginBottom: '1rem', color: '#ef4444' }}>{err}</div>}

      {loading ? (
        <p className="muted">Loading archives…</p>
      ) : archives.length === 0 ? (
        <p className="muted">No historical S3 archives found for this device.</p>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Rows</th>
                <th>Size</th>
                <th>Date Range</th>
                <th>Archived At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {archives.map((a) => (
                <tr key={a.id}>
                  <td><code>{a.filename}</code></td>
                  <td>{a.row_count?.toLocaleString()}</td>
                  <td>{(a.file_size_bytes / 1024).toFixed(1)} KB</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {a.start_ts ? new Date(a.start_ts).toLocaleString() : '-'} to{' '}
                    {a.end_ts ? new Date(a.end_ts).toLocaleString() : '-'}
                  </td>
                  <td style={{ fontSize: '0.85rem' }}>{new Date(a.created_at).toLocaleString()}</td>
                  <td>
                    <button
                      className="ghost sm"
                      onClick={() => handleDownload(a.id)}
                      title="Download pre-signed S3 link"
                      style={{ marginRight: '0.5rem' }}
                    >
                      📥 Download
                    </button>
                    <button
                      className="ghost danger sm"
                      onClick={() => handleDelete(a.id)}
                      title="Delete archive file"
                    >
                      🗑️ Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
