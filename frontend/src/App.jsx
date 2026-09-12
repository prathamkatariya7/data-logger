import { useEffect, useState } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import DeviceChannelGrid from './pages/DeviceChannelGrid.jsx';
import ChannelDetail from './pages/ChannelDetail.jsx';
import Login from './pages/Login.jsx';
import Profile from './pages/Profile.jsx';
import Users from './pages/Users.jsx';
import { useTheme } from './lib/theme.js';
import { useAuth } from './lib/auth.jsx';
import { socket } from './lib/socket.js';

function ConnPill() {
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    socket.on('connect', on);
    socket.on('disconnect', off);
    return () => { socket.off('connect', on); socket.off('disconnect', off); };
  }, []);
  return (
    <span className="conn-pill" title={connected ? 'Realtime connected' : 'Reconnecting…'}>
      <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}

function UserMenu({ user, logout }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  return (
    <div className="user-menu" onClick={(e) => e.stopPropagation()}>
      <button className="ghost user-menu-trigger" onClick={() => setOpen(!open)}>
        <span className="user-menu-name">{user.username}</span>
        <span className={`role-badge ${user.role}`}>{user.role}</span>
        <span className="user-menu-chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="user-menu-dropdown">
          <Link to="/profile" className="user-menu-item" onClick={() => setOpen(false)}>
            Profile
          </Link>
          {user.role === 'admin' && (
            <Link to="/users" className="user-menu-item" onClick={() => setOpen(false)}>
              Users
            </Link>
          )}
          <div className="user-menu-divider" />
          <button className="user-menu-item danger-text" onClick={() => { setOpen(false); logout(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { theme, toggle } = useTheme();
  const { loading, authEnabled, authenticated, user, logout } = useAuth();

  if (loading) return <div className="app"><main className="app-main"><p className="muted">Loading…</p></main></div>;

  if (authEnabled && !authenticated) {
    return (
      <div className="app">
        <header className="app-header">
          <Link to="/" className="brand"><span className="brand-logo">◈</span> Data Logger</Link>
          <div className="header-spacer" />
          <button className="icon-btn" onClick={toggle} title="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
        </header>
        <main className="app-main"><Login /></main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand"><span className="brand-logo">◈</span> Data Logger</Link>
        <div className="header-spacer" />
        <div className="header-tools">
          <ConnPill />
          <button className="icon-btn" onClick={toggle} title="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
          {user && <UserMenu user={user} logout={logout} />}
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/devices/:id" element={<DeviceChannelGrid />} />
          <Route path="/devices/:id/:type/:num" element={<ChannelDetail />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/users" element={<Users />} />
          <Route path="*" element={<p>Not found. <Link to="/">Go home</Link></p>} />
        </Routes>
      </main>
    </div>
  );
}

