import { useState } from 'react';

// Reusable CSV download panel with an optional date-time range and both
// with-master / without-master variants. `buildUrl(withMaster, from, to)`
// returns the href for a given variant.
export default function DownloadPanel({ title = 'Downloads', buildUrl, extra = null }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // datetime-local gives "YYYY-MM-DDTHH:MM"; pass through as-is.
  const href = (withMaster) => buildUrl(withMaster, from || undefined, to || undefined);

  return (
    <section className="panel">
      <h3>{title}</h3>
      <div className="range-row">
        <label>
          <span>From</span>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span>To</span>
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(from || to) && (
          <button className="ghost" onClick={() => { setFrom(''); setTo(''); }}>Clear range</button>
        )}
      </div>
      <p className="muted small">Leave the range empty to export everything.</p>
      <div className="panel-actions">
        <a className="btn" href={href(true)}>Download — with master</a>
        <a className="btn" href={href(false)}>Download — without master</a>
        {extra}
      </div>
    </section>
  );
}
