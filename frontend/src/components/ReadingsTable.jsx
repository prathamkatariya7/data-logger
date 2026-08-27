function fmt(v, digits = 3) {
  return v == null ? '' : Number(v).toFixed(digits);
}
function tsLabel(r) {
  if (r.rtc_date && r.rtc_time) return `${r.rtc_date} ${r.rtc_time}`;
  return new Date(r.ts).toLocaleTimeString();
}

// Live readings table (newest first). Rows are prepended as WS updates arrive.
export default function ReadingsTable({ rows }) {
  return (
    <section className="panel">
      <h3>Live readings</h3>
      <div className="table-wrap">
        <table className="readings-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Raw</th>
              <th>Calculated °C</th>
              <th>Master °C</th>
              <th>Error factor</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="muted">Waiting for data…</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={`${r.ts}-${i}`}>
                <td>{tsLabel(r)}</td>
                <td>{fmt(r.raw_value, 2)}</td>
                <td>{fmt(r.calculated_temp_c)}</td>
                <td>{r.master_temp_c == null ? '—' : fmt(r.master_temp_c)}</td>
                <td>{r.error_factor == null ? '—' : fmt(r.error_factor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
