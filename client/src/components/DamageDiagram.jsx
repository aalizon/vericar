import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

/**
 * Coordinates (% X, % Y) on top-down studio sedan photograph (/images/sedan-topdown.jpg)
 */
const ZONE_COORDS = {
  front_bumper: { x: 50, y: 12, label: 'Pare-chocs avant' },
  hood: { x: 50, y: 23, label: 'Capot moteur' },
  front_left: { x: 31, y: 21, label: 'Aile / optique avant gauche' },
  front_right: { x: 69, y: 21, label: 'Aile / optique avant droit' },
  left_side: { x: 28, y: 50, label: 'Flanc / portières gauches' },
  right_side: { x: 72, y: 50, label: 'Flanc / portières droites' },
  roof: { x: 50, y: 52, label: 'Pavillon / toit' },
  rear_left: { x: 32, y: 78, label: 'Aile arrière gauche' },
  rear_right: { x: 68, y: 78, label: 'Aile arrière droite' },
  rear_bumper: { x: 50, y: 88, label: 'Pare-chocs arrière' },
};

export default function DamageDiagram({ damages = [], note = '' }) {
  const [selectedId, setSelectedId] = useState(damages[0]?.id || null);

  if (!damages || damages.length === 0) {
    return (
      <div className="damage-layout">
        <div className="damage-diagram-frame">
          <img
            src="/images/sedan-topdown.jpg"
            alt="Vue aérienne de carrosserie sans sinistre déclaré"
            className="damage-diagram-img"
          />
        </div>
        <div className="surface-card" style={{ background: 'var(--bg-canvas)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <ShieldCheck size={20} color="var(--ok)" aria-hidden="true" />
            <strong>Aucun sinistre majeur recensé dans les sources consultées</strong>
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-secondary)' }}>
            {note ||
              'Aucune déclaration d’accident ou procédure d’expertise lourde (VGE/VEI) n’a été trouvée. Contrôlez toujours l’alignement des panneaux, les joints de pare-brise et l’homogénéité de la peinture lors de la visite.'}
          </p>
        </div>
      </div>
    );
  }

  const activeId = damages.some((d) => d.id === selectedId) ? selectedId : damages[0]?.id || null;

  // Build map of hotspots from damage records
  const hotspots = [];
  damages.forEach((rec, idx) => {
    (rec.zones || []).forEach((zoneKey) => {
      const coord = ZONE_COORDS[zoneKey];
      if (coord) {
        hotspots.push({
          key: `${rec.id}-${zoneKey}`,
          recordId: rec.id,
          index: idx + 1,
          severity: rec.severity,
          ...coord,
        });
      }
    });
  });

  return (
    <div className="damage-layout">
      <div className="damage-diagram-frame">
        <img
          src="/images/sedan-topdown.jpg"
          alt="Schéma interactif des zones de carrosserie impactées"
          className="damage-diagram-img"
        />
        {hotspots.map((spot) => (
          <button
            key={spot.key}
            type="button"
            className={`damage-hotspot ${spot.severity} ${activeId === spot.recordId ? 'active' : ''}`}
            style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
            title={`${spot.label} (Sinistre #${spot.index})`}
            aria-label={`${spot.label} — Sinistre ${spot.index}`}
            aria-pressed={activeId === spot.recordId}
            onClick={() => setSelectedId(spot.recordId)}
          >
            {spot.index}
          </button>
        ))}
      </div>

      <div className="damage-record-list">
        {damages.map((rec, idx) => {
          const isSelected = activeId === rec.id;
          const badgeClass =
            rec.severity === 'high' ? 'danger' : rec.severity === 'medium' ? 'warn' : 'info';
          const hasMin = rec.estimatedCostMin !== null && rec.estimatedCostMin !== undefined;
          const hasMax = rec.estimatedCostMax !== null && rec.estimatedCostMax !== undefined;

          return (
            <div
              key={rec.id}
              className={`damage-record ${isSelected ? 'selected' : ''}`}
              onClick={() => setSelectedId(rec.id)}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedId(rec.id);
                }
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`status-badge ${badgeClass}`}>
                    #{idx + 1} · {rec.severityLabel}
                  </span>
                  <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                    {rec.date} ({rec.country})
                  </span>
                </div>
                {(hasMin || hasMax) && (
                  <strong className="mono" style={{ fontSize: 13.5, color: 'var(--ink-primary)' }}>
                    {hasMin && hasMax
                      ? `${Number(rec.estimatedCostMin).toLocaleString('fr-FR')} € – ${Number(rec.estimatedCostMax).toLocaleString('fr-FR')} €`
                      : `~${Number(hasMin ? rec.estimatedCostMin : rec.estimatedCostMax).toLocaleString('fr-FR')} €`}
                  </strong>
                )}
              </div>

              <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--ink-secondary)' }}>
                {rec.summary}
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12 }}>
                {(rec.zones || []).map((z) => (
                  <span key={z} className="status-badge neutral">
                    {ZONE_COORDS[z]?.label || z}
                  </span>
                ))}
                <span className="status-badge neutral">Source : {rec.source}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
