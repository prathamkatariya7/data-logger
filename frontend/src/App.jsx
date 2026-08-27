import { Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import DeviceChannelGrid from './pages/DeviceChannelGrid.jsx';
import ChannelDetail from './pages/ChannelDetail.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">Data Logger</Link>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/devices/:id" element={<DeviceChannelGrid />} />
          <Route path="/devices/:id/:type/:num" element={<ChannelDetail />} />
          <Route path="*" element={<p>Not found. <Link to="/">Go home</Link></p>} />
        </Routes>
      </main>
    </div>
  );
}
