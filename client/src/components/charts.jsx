import { useState } from 'react';

/* Single-series charts in the brand blue. Values are text-coloured, the bar carries magnitude. */

export function BarList({ data, valueFormat = (v) => v, label = 'name', value = 'value', emptyText = 'No data' }) {
  const max = Math.max(...data.map((d) => d[value]), 0);
  if (!data.length || max === 0) return <div className="muted small chart-empty">{emptyText}</div>;
  return (
    <ul className="barlist">
      {data.map((d) => (
        <li key={d[label]} title={`${d[label]}: ${valueFormat(d[value])}`}>
          <div className="barlist-row">
            <span className="barlist-label">{d[label]}</span>
            <span className="barlist-value">{valueFormat(d[value])}</span>
          </div>
          <div className="barlist-track">
            <div className="barlist-bar" style={{ width: `${Math.max((d[value] / max) * 100, d[value] > 0 ? 1.5 : 0)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ColumnChart({ data, x, y, xFormat = (v) => v, yFormat = (v) => v, tooltipExtra, height = 200 }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...data.map((d) => d[y]), 0) || 1;
  const ticks = [0, 0.5, 1].map((t) => t * max);
  return (
    <div className="colchart" style={{ height }}>
      <div className="colchart-axis">
        {ticks.slice().reverse().map((t) => <span key={t}>{yFormat(t)}</span>)}
      </div>
      <div className="colchart-plot">
        {ticks.map((t) => <div key={t} className="colchart-grid" style={{ bottom: `${(t / max) * 100}%` }} />)}
        <div className="colchart-cols">
          {data.map((d, i) => (
            <div
              key={d[x]}
              className={`colchart-col ${hover === i ? 'is-hover' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="colchart-bar" style={{ height: `${(d[y] / max) * 100}%` }} />
              <span className="colchart-x">{xFormat(d[x], i)}</span>
              {hover === i && (
                <div className={`chart-tip ${i > data.length - 4 ? 'tip-left' : ''}`}>
                  <strong>{xFormat(d[x], i, true)}</strong>
                  <span>{yFormat(d[y], true)}</span>
                  {tooltipExtra && <span className="muted">{tooltipExtra(d)}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
