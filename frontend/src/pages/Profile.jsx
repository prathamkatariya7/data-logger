import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';

export default function Profile() {
  const { user, changePassword } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!newPw) { toast.error('New password cannot be empty'); return; }
    if (newPw !== confirm) { toast.error('New passwords do not match'); return; }
    setBusy(true);
    try {
      await changePassword(current, newPw);
      toast.success('Password changed successfully');
      setCurrent('');
      setNewPw('');
      setConfirm('');
    } catch (err) {
      toast.error(err.message || 'Failed to change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-page">
      <Link to="/" className="back">← Dashboard</Link>
      <h1>Profile</h1>

      <div className="profile-info panel">
        <div className="profile-field">
          <span className="value-label">Username</span>
          <span className="profile-value">{user?.username}</span>
        </div>
        <div className="profile-field">
          <span className="value-label">Role</span>
          <span className={`role-badge ${user?.role}`}>{user?.role}</span>
        </div>
      </div>

      <div className="panel">
        <h3>Change Password</h3>
        <p className="muted small">Enter your current password and choose a new one. No length restrictions — only non-empty is required.</p>
        <form className="password-form" onSubmit={submit}>
          <label className="field">
            <span>Current password</span>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </div>
    </div>
  );
}
