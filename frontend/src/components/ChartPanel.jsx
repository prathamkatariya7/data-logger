import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// Live trend chart. `series` is [{ key, name, color, data: [{t, v}] }].
// Data points use `t` (epoch ms) and `v` (number|null). Nulls create gaps
// (connectNulls=false) rather than interpolating.
export default function ChartPanel({ title = 'Live trend', series, height = 320 }) {
  // Merge all series into rows keyed by timestamp for Recharts.
  const rows = useMemo(() => {
    const byT = new Map();
    for (const s of series) {
      for (const p of s.data) {
        let row = byT.get(p.t);
        if (!row) { row = { t: p.t }; byT.set(p.t, row); }
        row[s.key] = p.v;
      }
    }
    return Array.from(byT.values()).sort((a, b) => a.t - b.t);
  }, [series]);

  const fmtTime = (t) => new Date(t).toLocaleTimeString();

  return (
    <section className="panel">
      <div className="panel-head"><h3>{title}</h3></div>
      <div className="chart-wrap" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="t"
              tickFormatter={fmtTime}
              stroke="var(--muted)"
              fontSize={11}
              minTickGap={40}
            />
            <YAxis stroke="var(--muted)" fontSize={11} width={48} domain={['auto', 'auto']} />
            <Tooltip
              labelFormatter={fmtTime}
              contentStyle={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text)',
                fontSize: 12,
              }}
              formatter={(v) => (v == null ? '—' : Number(v).toFixed(2))}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
                strokeWidth={2}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
