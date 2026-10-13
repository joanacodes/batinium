import { useEffect, useRef, useState } from 'react';
import { televerserDocument, type CibleDocument } from '../lib/db';
import type { Document } from '../lib/types';

/**
 * Signer au doigt.
 *
 * Un canevas, pas de bibliothèque : tracer une signature, c'est relier des
 * points. Pour une fiche d'intervention ou un bon, une signature « simple » —
 * un tracé horodaté, avec l'identité déclarée du signataire — est admise ;
 * on n'a pas besoin d'un prestataire de signature qualifiée.
 *
 * L'image part dans la bibliothèque comme document de type « signature »,
 * rattaché à ce qui est signé, la légende disant qui a signé. C'est cette
 * légende que la base relit pour accepter la signature : un rôle mal écrit et
 * la fiche resterait non signée.
 */
export default function Signature({ cible, role, nom, onNom, onSignee, onAnnuler, onErreur }: {
  cible: CibleDocument;
  /** Écrit dans la légende du document : « operateur », « detenteur », « client »… */
  role: string;
  nom: string;
  /** Quand le nom est saisi sur place (le client), le composant le laisse modifier. */
  onNom?: (nom: string) => void;
  onSignee: (document: Document) => void;
  onAnnuler: () => void;
  onErreur: (message: string) => void;
}) {
  const canevas = useRef<HTMLCanvasElement>(null);
  const trace = useRef(false);
  const [vide, setVide] = useState(true);
  const [envoi, setEnvoi] = useState(false);

  // Le canevas se dimensionne en pixels réels de l'écran : sans ça, sur un
  // téléphone à forte densité, le trait sort flou et décalé du doigt.
  useEffect(() => {
    const c = canevas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = c.getBoundingClientRect();
    c.width = Math.round(width * ratio);
    c.height = Math.round(height * ratio);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#16202b';
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function debut(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    trace.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // Un simple appui laisse un point : c'est parfois toute une paraphe.
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    setVide(false);
  }

  function suite(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!trace.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function fin() { trace.current = false; }

  function effacer() {
    const c = canevas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    setVide(true);
  }

  async function valider() {
    const c = canevas.current;
    if (!c || vide) return onErreur('Signez dans le cadre avant de valider.');
    if (!nom.trim()) return onErreur('Le nom du signataire est obligatoire.');
    setEnvoi(true);
    try {
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
      if (!blob) throw new Error('La signature n’a pas pu être enregistrée en image.');
      const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
      const fichier = new File([blob], `signature-${role}-${horodatage}.png`, { type: 'image/png' });
      const doc = await televerserDocument(cible, fichier, {
        type: 'signature',
        legende: role,
        prise_le: new Date().toISOString(),
      });
      onSignee(doc);
    } catch (e) {
      onErreur((e as Error).message);
    }
    setEnvoi(false);
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <label>Nom du signataire</label>
        {onNom
          ? <input value={nom} onChange={(e) => onNom(e.target.value)} autoComplete="name" />
          : <div style={{ fontWeight: 600 }}>{nom || '—'}</div>}
        <div className="statut">
          Le {new Date().toLocaleDateString('fr-FR')} à{' '}
          {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {/* touch-action: none — sans lui, le doigt fait défiler la page au lieu
          de tracer, et la signature sort en pointillés. */}
      <canvas ref={canevas}
              style={{ width: '100%', height: 180, background: '#fff', borderRadius: 3,
                       border: '1px solid var(--filet)', touchAction: 'none', cursor: 'crosshair' }}
              onPointerDown={debut} onPointerMove={suite}
              onPointerUp={fin} onPointerCancel={fin} onPointerLeave={fin}
              aria-label="Zone de signature" />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="action" disabled={envoi || vide} onClick={() => void valider()}>
          {envoi ? 'Enregistrement…' : 'Valider la signature'}
        </button>
        <button className="action discret" disabled={envoi || vide} onClick={effacer}>
          Effacer
        </button>
        <button className="action discret" disabled={envoi} onClick={onAnnuler}>
          Annuler
        </button>
      </div>
    </div>
  );
}
