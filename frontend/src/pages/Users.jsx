import { useEffect, useState, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';

const ROLES = ['admin', 'engineer'];

export default function Users() {
  const { user } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Create user form
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('engineer');
  const [creating, setCreating] = useState(false);

  // Reset password
  const [resetId, setResetId] = useState(null);
  const [resetPw, setResetPw] = useState('');
  const [resetting, setResetting] = useState(false);

  // Confirm delete
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = user && user.role === 'admin';

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setUsers(await api.listUsers());
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [toast, isAdmin]);

  useEffect(() => { load(); }, [load]);

  // Route guard: non-admins are redirected home (after all hooks)
  if (!isAdmin) return <Navigate to="/" replace />;

  // --- Create ---
  async function handleCreate(e) {
    e.preventDefault();
    const uname = newUsername.trim();
    if (!uname) { toast.error('Username required'); return; }
    if (!newPassword) { toast.error('Password required'); return; }
    setCreating(true);
    try {
      await api.createUser(uname, newPassword, newRole);
      toast.success(`User "${uname}" created`);
      setNewUsername(''); setNewPassword(''); setNewRole('engineer'); setShowCreate(false);
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to create user');
    } finally {
      setCreating(false);
    }
  }

  // --- Delete ---
  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await api.deleteUser(deleteId);
      toast.success('User removed');
      setDeleteId(null);
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to delete user');
    } finally {
      setDeleting(false);
    }
  }

  // --- Reset password ---
  async function handleReset(e) {
    e.preventDefault();
    if (!resetPw) { toast.error('New password required'); return; }
    setResetting(true);
    try {
      await api.resetPassword(resetId, resetPw);
      toast.success('Password reset');
      setResetId(null); setResetPw('');
    } catch (err) {
      toast.error(err.message || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  }

  // --- Change role ---
  async function handleRoleChange(id, newRoleVal) {
    try {
      await api.setUserRole(id, newRoleVal);
      toast.success('Role updated');
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to change role');
    }
  }

  return (
    <div className="users-page">
      <Link to="/" className="back">← Dashboard</Link>
      <div className="page-head">
        <h1>Users</h1>
        <button onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : '+ Create user'}
        </button>
      </div>

      {/* --- Create user form --- */}
      {showCreate && (
        <form className="panel create-user-form" onSubmit={handleCreate}>
          <h3>New user</h3>
          <div className="field-row">
            <label className="field" style={{ flex: 2 }}>
              <span>Username</span>
              <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoComplete="off" />
            </label>
            <label className="field" style={{ flex: 2 }}>
              <span>Password</span>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Role</span>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create'}</button>
            <button type="button" className="ghost" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* --- Users table --- */}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : users.length === 0 ? (
        <p className="muted">No users found.</p>
      ) : (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap" style={{ maxHeight: 'none' }}>
            <table className="data-table users-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th>Created by</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="user-name">{u.username}</span>
                      {u.username === user.username && <span className="badge muted" style={{ marginLeft: 8 }}>you</span>}
                    </td>
                    <td>
                      <span className={`role-badge ${u.role}`}>{u.role}</span>
                    </td>
                    <td className="muted small">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                    <td className="muted small">{u.created_by || '—'}</td>
                    <td>
                      <div className="action-btns">
                        {/* Role toggle */}
                        {u.username !== user.username && (
                          <button
                            className="link-btn"
                            onClick={() => handleRoleChange(u.id, u.role === 'admin' ? 'engineer' : 'admin')}
                            title={u.role === 'admin' ? 'Demote to engineer' : 'Promote to admin'}
                          >
                            {u.role === 'admin' ? '↓ Demote' : '↑ Promote'}
                          </button>
                        )}
                        {/* Reset password */}
                        <button className="link-btn" onClick={() => { setResetId(u.id); setResetPw(''); }}>
                          Reset pw
                        </button>
                        {/* Delete */}
                        {u.username !== user.username && (
                          <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={() => setDeleteId(u.id)}>
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- Reset password modal --- */}
      {resetId && (
        <div className="modal-overlay" onClick={() => setResetId(null)}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleReset}>
            <h3>Reset password</h3>
            <p className="muted small">
              Set a new password for <strong>{users.find((u) => u.id === resetId)?.username}</strong>. No length restrictions.
            </p>
            <label className="field">
              <span>New password</span>
              <input type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} autoComplete="new-password" autoFocus />
            </label>
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button type="submit" disabled={resetting}>{resetting ? 'Resetting…' : 'Reset password'}</button>
              <button type="button" className="ghost" onClick={() => setResetId(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* --- Delete confirmation modal --- */}
      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Remove user</h3>
            <p>
              Are you sure you want to remove <strong>{users.find((u) => u.id === deleteId)?.username}</strong>?
              This cannot be undone.
            </p>
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button className="danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Removing…' : 'Remove'}
              </button>
              <button className="ghost" onClick={() => setDeleteId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
