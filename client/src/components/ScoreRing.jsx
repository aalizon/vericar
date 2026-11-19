export default function ScoreRing({ score = 0, riskLevel = 'medium' }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Number(score) || 0));
  const offset = circumference - (clamped / 100) * circumference;

  const strokeColor =
    riskLevel === 'high'
      ? 'var(--danger)'
      : riskLevel === 'medium'
        ? 'var(--warn)'
        : 'var(--ok)';

  const caption =
    riskLevel === 'high'
      ? 'Risque élevé'
      : riskLevel === 'medium'
        ? 'Vigilance'
        : 'Confiance élevée';

  return (
    <div className="score-ring-box" aria-label={`Score de confiance ${clamped} sur 100`}>
      <div className="score-ring-wrap">
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle
            cx="48"
            cy="48"
            r={radius}
            fill="none"
            stroke="var(--border-subtle)"
            strokeWidth="8"
          />
          <circle
            cx="48"
            cy="48"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 48 48)"
            style={{ transition: 'stroke-dashoffset 600ms ease' }}
          />
        </svg>
        <div className="score-ring-value">
          <span className="score-ring-number" style={{ color: strokeColor }}>
            {clamped}
          </span>
          <span className="score-ring-den">/ 100</span>
        </div>
      </div>
      <span className="score-ring-caption">{caption}</span>
    </div>
  );
}
