import { useCallback, useEffect, useRef, useState } from 'react';
import {
  attacherFichier, enregistrerDocument, etatDocument, LIBELLES_DOCUMENT, lienDocument,
  listerDocuments, listerMembres, majDocument, poids, supprimerDocument, TAILLE_MAXIMALE,
  televerserDocument, type CibleDocument,
} from '../lib/db';
import type { Document, Membre, TypeDocument } from '../lib/types';

/**
 * La bibliothèque de documents, pour tout ce qui peut en porter.
 *
 * Un seul composant sert au chantier, au salarié et au sous-traitant, parce
 * que le geste est le même et que trois écrans qui se ressemblent finissent
 * par diverger. Ce qui change d'un usage à l'autre, c'est la présentation :
 *
 *   — `galerie` pour des photos de chantier, où l'image est l'information ;
 *   — `bibliotheque` pour des papiers, où ce qui compte est la nature de la
 *     pièce et sa date d'expiration ;
 *   — `liste` pour un dépôt sans enjeu, un simple tas de fichiers.
 *
 * Les fichiers vivent dans un seau privé. On n'affiche donc jamais une URL
 * durable : chaque ouverture demande un lien signé qui expire au bout de dix
 * minutes. C'est un aller-retour de plus, et c'est le prix pour qu'une
 * attestation URSSAF ou une photo prise chez un particulier ne se retrouve
 * pas indexée quelque part.
 */

const COULEUR = {
  perime: 'var(--alerte)', bientot: '#b8860b',
  a_jour: 'var(--vert)', sans_echeance: 'var(--encre-pale)',
} as const;

const MOT = {
  perime: 'périmé', bientot: 'bientôt', a_jour: 'à jour', sans_echeance: '—',
} as const;

export default function PiecesJointes({
  cible, titre, aide, presentation = 'liste', accepte, types, onErreur, onChange,
}: {
  cible: CibleDocument;
  titre?: string;
  aide?: string;
  presentation?: 'liste' | 'galerie' | 'bibliotheque';
  accepte?: string;
  /** Les natures proposées. Toutes si rien n'est passé. */
  types?: TypeDocument[];
  onErreur: (m: string) => void;
  onChange?: () => void;
}) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [charge, setCharge] = useState(false);
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [part, setPart] = useState<number | null>(null);
  const [apercus, setApercus] = useState<Record<string, string>>({});
  const [membres, setMembres] = useState<Membre[]>([]);
  const [neuf, setNeuf] = useState<Partial<Document>>({ type: types?.[0] ?? 'autre' });
  const champ = useRef<HTMLInputElement>(null);
  const cleCible = JSON.stringify(cible);
  const vocabulaire = types ?? (Object.keys(LIBELLES_DOCUMENT) as TypeDocument[]);

  const recharger = useCallback(async () => {
    try {
      // Les noms sont lus à part plutôt qu'en jointure : `document` porte deux
      // liens vers `membre`, celui du salarié concerné et celui du déposant, et
      // une jointure imbriquée devrait lever l'ambiguïté par un nom de
      // contrainte. La liste des membres est courte et déjà lisible par tous.
      const [d, m] = await Promise.all([
        listerDocuments(JSON.parse(cleCible) as CibleDocument),
        listerMembres().catch(() => []),
      ]);
      setDocs(d); setMembres(m);
    } catch (e) { onErreur((e as Error).message); }
    setCharge(true);
    onChange?.();
  }, [cleCible, onErreur, onChange]);

  useEffect(() => { void recharger(); }, [recharger]);

  // Les vignettes n'existent qu'en galerie : demander un lien signé par ligne
  // sur une liste de papiers ferait dix requêtes pour rien.
  useEffect(() => {
    if (presentation !== 'galerie') return;
    let vivant = true;
    (async () => {
      for (const d of docs) {
        if (!d.chemin || !d.type_mime?.startsWith('image/') || apercus[d.id]) continue;
        try {
          const url = await lienDocument(d.chemin);
          if (vivant) setApercus((a) => ({ ...a, [d.id]: url }));
        } catch { /* une vignette absente ne doit pas casser la page */ }
      }
    })();
    return () => { vivant = false; };
  }, [docs, presentation, apercus]);

  /** Qui a déposé la pièce, et quand. Une photo sans auteur ne se discute pas. */
  const signature = (d: Document) => {
    const qui = membres.find((m) => m.id === d.depose_par)?.nom;
    const quand = new Date(d.created_at).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return qui ? `déposée par ${qui} le ${quand}` : `déposée le ${quand}`;
  };

  async function deposer(fichiers: FileList | null) {
    if (!fichiers?.length) return;
    for (const f of Array.from(fichiers)) {
      if (f.size > TAILLE_MAXIMALE) {
        onErreur(`« ${f.name} » dépasse ${TAILLE_MAXIMALE / 1048576} Mo. Pour une vidéo longue, `
          + 'filmez plus court : c’est le geste qui compte, pas la durée.');
        continue;
      }
      setEnvoi(f.name);
      setPart(null);
      try {
        await televerserDocument(JSON.parse(cleCible) as CibleDocument, f, {
          type: presentation === 'galerie' ? 'photo' : 'autre',
          prise_le: f.lastModified ? new Date(f.lastModified).toISOString() : null,
          onProgression: (envoye, total) => setPart(envoye / total),
        });
      } catch (e) { onErreur((e as Error).message); }
    }
    setEnvoi(null);
    setPart(null);
    if (champ.current) champ.current.value = '';
    void recharger();
  }

  async function ouvrir(d: Document) {
    if (!d.chemin) return onErreur('Cette pièce n’a pas encore de fichier.');
    try { window.open(await lienDocument(d.chemin), '_blank', 'noopener'); }
    catch (e) { onErreur((e as Error).message); }
  }

  async function retirer(d: Document) {
    if (!window.confirm(`Supprimer « ${d.nom} » ?`)) return;
    try { await supprimerDocument(d); void recharger(); }
    catch (e) { onErreur((e as Error).message); }
  }

  /**
   * L'attestation URSSAF se renouvelle tous les six mois au-delà de 5 000 €
   * de contrat : l'échéance se calcule seule pour éviter l'oubli.
   */
  function majEmission(v: string) {
    setNeuf((p) => {
      const patch: Partial<Document> = { ...p, emis_le: v || null };
      if (v && p.type === 'attestation_urssaf') {
        const f = new Date(v);
        f.setMonth(f.getMonth() + 6);
        patch.expire_le = f.toISOString().slice(0, 10);
      }
      return patch;
    });
  }

  async function creer() {
    const def = LIBELLES_DOCUMENT[neuf.type as TypeDocument];
    if (def?.echeance && !neuf.expire_le) {
      return onErreur(`« ${def.libelle} » a une date de fin : renseignez-la, c’est elle que la cloche surveille.`);
    }
    try {
      await enregistrerDocument({
        ...(JSON.parse(cleCible) as Record<string, string>),
        type: neuf.type ?? 'autre',
        nom: def?.libelle ?? 'Document',
        emis_le: neuf.emis_le ?? null,
        expire_le: neuf.expire_le ?? null,
        conforme: true,
      });
      setNeuf({ type: types?.[0] ?? 'autre' });
      void recharger();
    } catch (e) { onErreur((e as Error).message); }
  }

  const depot = (
    <label className="depot">
      <input ref={champ} type="file" multiple accept={accepte} style={{ display: 'none' }}
             onChange={(e) => void deposer(e.target.files)} />
      {envoi ? `Envoi de ${envoi}…${part === null ? '' : ` ${Math.floor(part * 100)} %`}` : 'Ajouter des fichiers'}
    </label>
  );

  return (
    <>
      {titre && <h3 style={{ margin: '16px 0 6px' }}>{titre}</h3>}
      {aide && <p className="statut" style={{ marginBottom: 8 }}>{aide}</p>}

      {!charge ? (
        <p className="statut">Chargement…</p>
      ) : presentation === 'bibliotheque' ? (
        <>
          {docs.length === 0 ? (
            <div className="vide" style={{ padding: 20 }}>
              Aucune pièce enregistrée.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 250 }}>Nature</th>
                  <th>Fichier</th>
                  <th style={{ width: 105 }}>Émise le</th>
                  <th style={{ width: 105 }}>Expire le</th>
                  <th style={{ width: 90 }}>État</th>
                  <th style={{ width: 165 }} className="sans-impression" />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const etat = etatDocument(d);
                  return (
                    <tr key={d.id} style={etat === 'perime' ? { background: '#fdf3f2' } : undefined}>
                      <td>
                        <select defaultValue={d.type} style={{ padding: '3px 5px', fontSize: 12 }}
                                onChange={(e) => void majDocument(d.id,
                                  { type: e.target.value as TypeDocument }).then(recharger)}>
                          {vocabulaire.map((t) => (
                            <option key={t} value={t}>{LIBELLES_DOCUMENT[t].libelle}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {d.chemin
                          ? <>{d.nom}<div className="statut">{signature(d)} · {poids(d.taille_octets)}</div></>
                          : <span className="statut">aucun fichier — la date est suivie, le papier manque</span>}
                      </td>
                      <td>
                        <input type="date" defaultValue={d.emis_le ?? ''}
                               style={{ padding: '3px 4px', fontSize: 12 }}
                               onChange={(e) => void majDocument(d.id,
                                 { emis_le: e.target.value || null }).then(recharger)} />
                      </td>
                      <td>
                        <input type="date" defaultValue={d.expire_le ?? ''}
                               style={{ padding: '3px 4px', fontSize: 12 }}
                               onChange={(e) => void majDocument(d.id,
                                 { expire_le: e.target.value || null }).then(recharger)} />
                      </td>
                      <td>
                        <span className="jeton" style={{ color: COULEUR[etat], borderColor: COULEUR[etat] }}>
                          {MOT[etat]}
                        </span>
                      </td>
                      <td className="sans-impression" style={{ whiteSpace: 'nowrap' }}>
                        {d.chemin && (
                          <>
                            <button className="action discret" style={{ padding: '2px 8px' }}
                                    onClick={() => void ouvrir(d)}>Ouvrir</button>{' '}
                          </>
                        )}
                        <label className="lien-discret" style={{ margin: 0, cursor: 'pointer' }}>
                          <input type="file" style={{ display: 'none' }} accept=".pdf,image/*"
                                 onChange={(e) => {
                                   const f = e.target.files?.[0];
                                   if (f) {
                                     void attacherFichier(d.id, f).then(recharger)
                                       .catch((x) => onErreur((x as Error).message));
                                   }
                                 }} />
                          {d.chemin ? 'remplacer' : 'déposer'}
                        </label>{' '}
                        <button className="action discret" style={{ padding: '2px 7px' }}
                                onClick={() => void retirer(d)}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div style={{ display: 'grid', gap: 10, marginTop: 14, alignItems: 'end',
                        gridTemplateColumns: '1fr 150px 150px auto' }}>
            <div>
              <label>Ajouter une pièce</label>
              <select value={neuf.type ?? 'autre'}
                      onChange={(e) => setNeuf((p) => ({ ...p, type: e.target.value as TypeDocument }))}>
                {vocabulaire.map((t) => (
                  <option key={t} value={t}>{LIBELLES_DOCUMENT[t].libelle}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Émise le</label>
              <input type="date" value={neuf.emis_le ?? ''}
                     onChange={(e) => majEmission(e.target.value)} />
            </div>
            <div>
              <label>Expire le</label>
              <input type="date" value={neuf.expire_le ?? ''}
                     onChange={(e) => setNeuf((p) => ({ ...p, expire_le: e.target.value || null }))} />
            </div>
            <button className="action" onClick={() => void creer()}>Ajouter</button>
          </div>
          <p className="statut" style={{ marginTop: 6 }}>
            La pièce se crée d’abord, le fichier se dépose ensuite sur sa ligne. On connaît
            souvent l’échéance avant d’avoir reçu le papier, et une date surveillée vaut
            mieux qu’un oubli.
          </p>
        </>
      ) : docs.length === 0 ? (
        <div className="vide" style={{ padding: 20 }}>
          Aucune pièce. {depot}
        </div>
      ) : presentation === 'galerie' ? (
        <>
          <div className="galerie">
            {docs.map((d) => (
              <figure key={d.id} className="galerie-case">
                <button className="galerie-vue" onClick={() => void ouvrir(d)}
                        title={`Ouvrir ${d.nom}`}>
                  {apercus[d.id]
                    ? <img src={apercus[d.id]} alt={d.legende ?? d.nom} />
                    : <span className="galerie-icone">
                        {d.type_mime?.startsWith('video/') ? '▶' : '📄'}
                      </span>}
                </button>
                <figcaption>
                  <input defaultValue={d.legende ?? ''} placeholder="Ce que la photo montre"
                         onBlur={(e) => e.target.value !== (d.legende ?? '')
                           && void majDocument(d.id, { legende: e.target.value || null })
                             .then(recharger).catch((x) => onErreur((x as Error).message))} />
                  <span className="statut" style={{ display: 'block' }}>{signature(d)}</span>
                  <span className="statut">
                    {d.prise_le && `prise le ${new Date(d.prise_le).toLocaleDateString('fr-FR')} · `}
                    {poids(d.taille_octets)}
                    {' · '}
                    <button className="lien-discret" onClick={() => void retirer(d)}>retirer</button>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>{depot}</div>
        </>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Fichier</th>
                <th style={{ width: 220 }}>Légende</th>
                <th style={{ width: 210 }}>Déposée par</th>
                <th className="num" style={{ width: 80 }}>Poids</th>
                <th style={{ width: 130 }} className="sans-impression" />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.nom}</td>
                  <td>
                    <input defaultValue={d.legende ?? ''} placeholder="—"
                           onBlur={(e) => e.target.value !== (d.legende ?? '')
                             && void majDocument(d.id, { legende: e.target.value || null })
                               .then(recharger).catch((x) => onErreur((x as Error).message))}
                           style={{ padding: '3px 5px', fontSize: 12 }} />
                  </td>
                  <td className="ref">{signature(d)}</td>
                  <td className="num ref">{poids(d.taille_octets)}</td>
                  <td className="sans-impression" style={{ whiteSpace: 'nowrap' }}>
                    <button className="action discret" style={{ padding: '2px 8px' }}
                            onClick={() => void ouvrir(d)}>Ouvrir</button>{' '}
                    <button className="action discret" style={{ padding: '2px 8px' }}
                            onClick={() => void retirer(d)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}>{depot}</div>
        </>
      )}
    </>
  );
}
