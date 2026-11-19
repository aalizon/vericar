import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  FileCheck2,
  Loader2,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api } from '../api.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { useRouter } from '../lib/router.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function HistovecImportView({ samplePayload: initialSamplePayload, onReportGenerated }) {
  const { navigate } = useRouter();
  const { isAuthenticated, openAuthModal, setCreditsBalance } = useAuth();
  const { showToast } = useToast();

  const [fetchedSample, setFetchedSample] = useState(null);
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Seller message generator state
  const [vehicleLabel, setVehicleLabel] = useState('votre Peugeot 3008');
  const [plate, setPlate] = useState('');
  const [sellerCountry, setSellerCountry] = useState('FR');
  const [sellerMsg, setSellerMsg] = useState(
    'Bonjour,\n\nJe suis très intéressé par votre Peugeot 3008. Avant de me déplacer, pourriez-vous générer et me partager le lien officiel gratuit HistoVec (sur histovec.interieur.gouv.fr, cela prend 1 minute avec votre carte grise) ainsi que le numéro VIN (champ E) ?\n\nMerci beaucoup pour votre transparence, je reste disponible pour convenir d’un rendez-vous rapidement !'
  );
  const [generatingMsg, setGeneratingMsg] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (initialSamplePayload) return undefined;
    let cancelled = false;
    api
      .getSamples()
      .then((res) => {
        if (!cancelled && (res?.sampleHistovec || res?.histovecSample)) {
          setFetchedSample(res.sampleHistovec || res.histovecSample);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialSamplePayload]);

  const samplePayload = initialSamplePayload || fetchedSample;

  const handleLoadSample = () => {
    if (!samplePayload) {
      setError('Impossible de charger l’exemple HistoVec pour le moment.');
      return;
    }
    setRawText(JSON.stringify(samplePayload, null, 2));
    setError('');
  };

  const performImport = async (payloadText) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.importHistovec(payloadText);
      const report = res?.report || res;
      if (typeof res?.creditsBalance === 'number') {
        setCreditsBalance(res.creditsBalance);
      }
      showToast({
        type: 'success',
        title: 'HistoVec fusionné (0 crédit)',
        message: 'Votre rapport enrichi a été enregistré dans votre bibliothèque.',
      });
      onReportGenerated?.(report);
      if (report?.id) {
        navigate(`/rapport/${encodeURIComponent(report.id)}`);
      }
    } catch (err) {
      if (err?.status === 401) {
        openAuthModal({
          mode: 'register',
          reason:
            'L’import et la fusion HistoVec sont 100 % gratuits (0 crédit). Créez un compte ou connectez-vous pour enregistrer votre rapport.',
          onSuccess: () => performImport(payloadText),
        });
        return;
      }
      setError(err?.message || 'Erreur lors de la fusion du rapport HistoVec.');
    } finally {
      setLoading(false);
    }
  };

  const handleImportSubmit = async (e) => {
    e.preventDefault();
    const trimmed = rawText.trim();
    if (!trimmed) {
      setError('Collez un rapport HistoVec (texte ou JSON) ou chargez l’exemple proposé.');
      return;
    }
    if (!isAuthenticated) {
      openAuthModal({
        mode: 'register',
        reason:
          'L’import HistoVec est entièrement gratuit (0 crédit). Créez un compte ou connectez-vous pour générer et sauvegarder votre rapport.',
        onSuccess: () => performImport(trimmed),
      });
      return;
    }
    await performImport(trimmed);
  };

  const handleGenerateMessage = async () => {
    setGeneratingMsg(true);
    try {
      const res = await api.generateSellerMessage({
        vehicleLabel: vehicleLabel.trim() || undefined,
        plate: plate.trim() || undefined,
        country: sellerCountry,
      });
      if (res?.message) {
        setSellerMsg(res.message);
        showToast({ type: 'info', message: 'Message vendeur actualisé.' });
      }
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Impossible de générer le message.' });
    } finally {
      setGeneratingMsg(false);
    }
  };

  const handleCopyMessage = async () => {
    const ok = await copyToClipboard(sellerMsg);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
      showToast({ type: 'success', message: 'Message vendeur copié dans le presse-papiers.' });
    } else {
      showToast({ type: 'warning', message: 'Copie automatique impossible — copiez le texte manuellement.' });
    }
  };

  return (
    <main className="container" style={{ paddingBottom: 56 }}>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <span className="status-badge ok">
            <ShieldCheck size={13} aria-hidden="true" />
            100 % gratuit · 0 crédit consommé
          </span>
        </div>
        <h1>Import HistoVec &amp; Kit Acheteur France</h1>
        <p>
          En France, HistoVec (Ministère de l’Intérieur) est gratuit mais exige l’action du propriétaire.
          Collez ici un extrait ou un export JSON HistoVec : VériCar le fusionne gratuitement avec le
          décodage VIN ISO 3779, l’analyse de courbe kilométrique, la vignette Crit’Air et les rappels
          RappelConso en direct.
        </p>
      </div>

      <div className="card-grid-2">
        {/* Left: Import & Fuse */}
        <section className="surface-card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
              marginBottom: 14,
            }}
          >
            <h2
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                margin: 0,
                fontSize: 18,
                fontFamily: 'var(--font-display)',
              }}
            >
              <FileCheck2 size={20} color="var(--accent)" aria-hidden="true" />
              Analyser &amp; fusionner un rapport HistoVec
            </h2>
            <button
              id="btn-load-histovec-sample"
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!samplePayload}
              onClick={handleLoadSample}
            >
              <Sparkles size={14} aria-hidden="true" />
              Charger un exemple
            </button>
          </div>

          <form onSubmit={handleImportSubmit}>
            <label htmlFor="histovec-raw-input" className="field-label">
              Texte copié depuis histovec.interieur.gouv.fr ou JSON structuré
            </label>
            <textarea
              id="histovec-raw-input"
              className="text-area"
              placeholder={
                'Exemple de texte libre accepté :\nPlaque : AB-123-CD\nVIN : VF1RJB00265819432\nMarque : Renault\nModèle : Clio V\n10/03/2024 - Contrôle technique : 54 200 km\n05/03/2026 - Contrôle technique : 79 100 km\nNon gagé, non volé, aucun sinistre'
              }
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />

            {error && (
              <div className="search-error" role="alert">
                <AlertCircle size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10,
                marginTop: 14,
              }}
            >
              <a
                href="https://histovec.interieur.gouv.fr/"
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13.5, fontWeight: 600 }}
              >
                Ouvrir histovec.interieur.gouv.fr <ExternalLink size={14} aria-hidden="true" />
              </a>

              <button
                id="btn-submit-histovec"
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                ) : (
                  <FileCheck2 size={16} aria-hidden="true" />
                )}
                Fusionner &amp; générer le rapport (0 crédit)
              </button>
            </div>
          </form>
        </section>

        {/* Right: Seller request assistant */}
        <section className="surface-card">
          <h2
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              margin: '0 0 8px',
              fontSize: 18,
              fontFamily: 'var(--font-display)',
            }}
          >
            <MessageSquare size={20} color="var(--accent)" aria-hidden="true" />
            Demander le HistoVec / Car-Pass au vendeur
          </h2>
          <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--ink-secondary)' }}>
            Un vendeur sérieux partage volontiers son lien HistoVec ou son code Car-Pass avant la visite.
            Générez un message poli prêt à envoyer sur Leboncoin, La Centrale ou WhatsApp.
          </p>

          <div className="form-grid-2" style={{ marginBottom: 12 }}>
            <div>
              <label htmlFor="seller-vehicle-label" className="field-label">
                Véhicule concerné
              </label>
              <input
                id="seller-vehicle-label"
                type="text"
                className="text-input"
                value={vehicleLabel}
                onChange={(e) => setVehicleLabel(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="seller-plate-input" className="field-label">
                Immatriculation (optionnel)
              </label>
              <input
                id="seller-plate-input"
                type="text"
                className="text-input mono"
                placeholder="ex. GH-418-KP"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
              marginBottom: 12,
            }}
          >
            <div style={{ minWidth: 190, flex: '1 1 190px' }}>
              <label htmlFor="seller-country-select" className="field-label">
                Pays vendeur
              </label>
              <select
                id="seller-country-select"
                className="text-input"
                value={sellerCountry}
                onChange={(e) => setSellerCountry(e.target.value)}
              >
                <option value="FR">France (HistoVec)</option>
                <option value="BE">Belgique (Car-Pass)</option>
              </select>
            </div>

            <button
              id="btn-refresh-seller-msg"
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={generatingMsg}
              onClick={handleGenerateMessage}
            >
              {generatingMsg && <Loader2 size={14} className="spin" aria-hidden="true" />}
              Actualiser le message
            </button>
          </div>

          <textarea
            aria-label="Message prêt à envoyer au vendeur"
            className="text-area"
            style={{ minHeight: 150, fontFamily: 'var(--font-sans)', fontSize: 13.5 }}
            value={sellerMsg}
            onChange={(e) => setSellerMsg(e.target.value)}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              id="btn-copy-seller-msg"
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleCopyMessage}
            >
              {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              {copied ? 'Message copié !' : 'Copier le message'}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
