import { useState } from 'react';

export default function MileageChart({ readings = [], rollbackEvent = null }) {
  const [selectedIdx, setSelectedIdx] = useState(null);

  if (!readings || readings.length < 2) {
    return null;
  }

  const width = 660;
  const height = 240;
  const pad = { top: 26, right: 28, bottom: 38, left: 68 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const parsedTimes = readings.map((r) => new Date(r.date).getTime());
  const allDatesValid = parsedTimes.every((t) => Number.isFinite(t));
  const times = allDatesValid ? parsedTimes : readings.map((_, idx) => idx);

  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const timeSpan = Math.max(1, maxT - minT);

  const maxKmRaw = Math.max(...readings.map((r) => Number(r.km) || 0), 10000);
  const maxKm = Math.ceil(maxKmRaw / 25000) * 25000;

  const points = readings.map((r, idx) => {
    const kmVal = Number(r.km) || 0;
    const x =
      maxT === minT
        ? pad.left + (idx / Math.max(1, readings.length - 1)) * plotW
        : pad.left + ((times[idx] - minT) / timeSpan) * plotW;
    const y = pad.top + plotH - (kmVal / maxKm) * plotH;
    return { ...r, km: kmVal, x, y, idx };
  });

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    km: Math.round(maxKm * ratio),
    y: pad.top + plotH - ratio * plotH,
  }));

  const segments = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const isDrop = curr.km < prev.km - 500;
    segments.push({ prev, curr, isDrop });
  }

  const activePoint =
    selectedIdx !== null && selectedIdx >= 0 && selectedIdx < points.length
      ? points[selectedIdx]
      : null;

  return (
    <div className="chart-container">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Courbe d’évolution du kilométrage relevé"
      >
        {/* Horizontal reference lines */}
        {yTicks.map((tick) => (
          <g key={tick.km}>
            <line
              x1={pad.left}
              y1={tick.y}
              x2={width - pad.right}
              y2={tick.y}
              stroke="rgba(22, 30, 41, 0.08)"
              strokeDasharray={tick.km === 0 ? undefined : '4 4'}
            />
            <text
              x={pad.left - 10}
              y={tick.y + 4}
              textAnchor="end"
              fontSize="11"
              fill="#64748b"
              fontFamily="JetBrains Mono, monospace"
            >
              {(tick.km / 1000).toFixed(0)}k km
            </text>
          </g>
        ))}

        {/* Connecting segments (red dashed if rollback drop) */}
        {segments.map((seg, i) => (
          <line
            key={i}
            x1={seg.prev.x}
            y1={seg.prev.y}
            x2={seg.curr.x}
            y2={seg.curr.y}
            stroke={seg.isDrop ? '#c4253b' : '#16468c'}
            strokeWidth={seg.isDrop ? 3 : 2.5}
            strokeDasharray={seg.isDrop ? '6 4' : undefined}
          />
        ))}

        {/* Rollback annotation callout */}
        {rollbackEvent &&
          (() => {
            const dropIdx = points.findIndex((p) => p.anomaly);
            if (dropIdx <= 0) return null;
            const prev = points[dropIdx - 1];
            const curr = points[dropIdx];
            const midX = (prev.x + curr.x) / 2;
            const midY = (prev.y + curr.y) / 2;
            const boxX = Math.min(width - 170, Math.max(pad.left, midX - 68));
            const boxY = Math.max(8, midY - 14);
            return (
              <g>
                <rect x={boxX} y={boxY} width="148" height="24" rx="6" fill="#c4253b" />
                <text
                  x={boxX + 74}
                  y={boxY + 15.5}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="700"
                  fill="#ffffff"
                  fontFamily="JetBrains Mono, monospace"
                >
                  -{Number(rollbackEvent.dropKm || 0).toLocaleString('fr-FR')} km
                </text>
              </g>
            );
          })()}

        {/* Interactive Data points (hover, click, touch, keyboard) */}
        {points.map((pt) => {
          const isAnomaly = Boolean(pt.anomaly);
          const isSelected = selectedIdx === pt.idx;
          return (
            <g
              key={`${pt.date}-${pt.idx}`}
              style={{ cursor: 'pointer', outline: 'none' }}
              tabIndex={0}
              role="button"
              aria-label={`Relevé du ${pt.date} : ${pt.km.toLocaleString('fr-FR')} km (${pt.source})`}
              onMouseEnter={() => setSelectedIdx(pt.idx)}
              onFocus={() => setSelectedIdx(pt.idx)}
              onClick={() => setSelectedIdx(pt.idx)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedIdx(pt.idx);
                }
              }}
            >
              <circle cx={pt.x} cy={pt.y} r="14" fill="transparent" />
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isSelected ? 7.5 : 5}
                fill={isAnomaly ? '#c4253b' : '#16468c'}
                stroke="#ffffff"
                strokeWidth="2.5"
              />
              <text
                x={pt.x}
                y={height - 12}
                textAnchor="middle"
                fontSize="10.5"
                fill="#64748b"
                fontFamily="JetBrains Mono, monospace"
              >
                {String(pt.date || '').slice(0, 4)}
              </text>
            </g>
          );
        })}
      </svg>

      {activePoint ? (
        <div
          id="mileage-chart-detail"
          style={{
            marginTop: 8,
            padding: '8px 12px',
            borderRadius: 8,
            background: '#fff',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            fontSize: 13,
          }}
        >
          <span>
            <strong className="mono">{activePoint.date}</strong> · {activePoint.source} ({activePoint.country})
          </span>
          <strong className="mono" style={{ color: activePoint.anomaly ? 'var(--danger)' : 'var(--accent)' }}>
            {activePoint.km.toLocaleString('fr-FR')} km
          </strong>
        </div>
      ) : (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-muted)' }}>
          Survolez ou cliquez sur un point de la courbe pour consulter le détail exact du relevé kilométrique.
        </div>
      )}
    </div>
  );
}
