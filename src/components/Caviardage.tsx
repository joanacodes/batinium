import { useState } from 'react';
import { demanderIAJson, IANonConfiguree } from '../lib/ia';

interface Passage { extrait: string; motif: string; remplacement: string }

/**
 * Le caviardage : relire un texte avant qu'il ne parte chez un client.
 *
 * Ce qu'on cherche : un prix d'achat resté dans une note, un nom de
 * fournisseur, une remise obtenue, un commentaire interne sur le client. Ce
 * sont des fuites banales et coûteuses — un client qui apprend votre marge
 * n'accepte plus le même prix.
 *
 * Le modèle propose, il ne corrige rien. Chaque passage se remplace d'un clic
 * ou s'ignore : une relecture automatique qui réécrirait le message
 * elle-même serait pire que le problème, parce qu'on cesserait de le lire.
 */
export default function Caviardage({ texte, onRemplacer }: {
  texte: string;
  onRemplacer: (avant: string, apres: string) => void;
}) {
  const [passages, setPassages] = useState<Passage[] | null>(null);
  const [encours, setEncours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [traites, setTraites] = useState<Set<string>>(new Set());

  async function relire() {
    if (!texte.trim()) return;
    setEncours(true); setErreur(null); setTraites(new Set());
    try {
      const r = await demanderIAJson<{ passages: Passage[] }>('caviardage', texte);
      setPassages(r.passages ?? []);
    } catch (e) {
      setErreur(e instanceof IANonConfiguree
        ? (e as Error).message
        : `Relecture impossible : ${(e as Error).message}`);
    }
    setEncours(false);
  }

  const restants = (passages ?? []).filter((p) => !traites.has(p.extrait) && texte.includes(p.extrait));

  return (
    <div style={{ borderTop: '1px solid var(--filet)', paddingTop: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="action discret" disabled={encours || !texte.trim()}
                onClick={() => void relire()}>
          {encours ? 'Relecture…' : 'Relire avant envoi'}
        </button>
        <span className="statut">
          Cherche un prix d’achat, une marge, un nom de fournisseur ou une note interne
          restés dans le message.
        </span>
      </div>

      {erreur && <p className="statut" style={{ color: 'var(--alerte)' }}>{erreur}</p>}

      {passages && restants.length === 0 && !erreur && (
        <p className="statut" style={{ marginTop: 8, color: 'var(--vert)' }}>
          Rien à signaler dans ce message.
        </p>
      )}

      {restants.map((p, i) => (
        <div key={i} style={{ marginTop: 10, padding: 10,
                              borderLeft: '3px solid var(--alerte)', background: '#fdf3f2' }}>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
            « {p.extrait} »
          </div>
          <div className="statut" style={{ marginTop: 4 }}>{p.motif}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="action" style={{ fontSize: 13 }}
                    onClick={() => {
                      onRemplacer(p.extrait, p.remplacement);
                      setTraites((t) => new Set(t).add(p.extrait));
                    }}>
              Remplacer par « {p.remplacement} »
            </button>
            <button type="button" className="action discret" style={{ fontSize: 13 }}
                    onClick={() => setTraites((t) => new Set(t).add(p.extrait))}>
              Laisser
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
