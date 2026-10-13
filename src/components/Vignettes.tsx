import { useEffect, useState } from 'react';
import { lienDocument, poids } from '../lib/db';
import type { Document } from '../lib/types';

/**
 * Les photos et vidéos d'une note ou d'une demande, en petit.
 *
 * Le seau est privé : chaque vignette réclame un lien signé, et on ne les
 * demande qu'une fois par document. Une vignette qui manque n'empêche pas la
 * note de s'afficher — l'explication vaut déjà quelque chose sans l'image.
 *
 * Sortie de la fiche chantier pour servir aussi aux demandes du terrain : une
 * seule façon d'afficher une pièce, plutôt que deux qui divergent.
 */
export default function Vignettes({ docs, onErreur }: { docs: Document[]; onErreur: (m: string) => void }) {
  const [liens, setLiens] = useState<Record<string, string>>({});

  useEffect(() => {
    let vivant = true;
    (async () => {
      for (const d of docs) {
        if (!d.chemin || liens[d.id]) continue;
        try {
          const url = await lienDocument(d.chemin);
          if (vivant) setLiens((l) => ({ ...l, [d.id]: url }));
        } catch { /* une vignette absente ne casse pas la note */ }
      }
    })();
    return () => { vivant = false; };
  }, [docs, liens]);

  async function ouvrir(d: Document) {
    if (!d.chemin) return;
    try { window.open(await lienDocument(d.chemin), '_blank', 'noopener'); }
    catch (e) { onErreur((e as Error).message); }
  }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {docs.map((d) => (
        <button key={d.id} className="galerie-vue" style={{ width: 84, height: 84 }}
                title={`${d.nom} — ${poids(d.taille_octets)}`}
                onClick={() => void ouvrir(d)}>
          {liens[d.id] && d.type_mime?.startsWith('image/')
            ? <img src={liens[d.id]} alt={d.legende ?? d.nom} />
            : <span className="galerie-icone" style={{ fontSize: 18 }}>
                {d.type_mime?.startsWith('video/') ? '▶' : '📄'}
              </span>}
        </button>
      ))}
    </div>
  );
}
