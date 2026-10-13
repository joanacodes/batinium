import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { chargerFichePose, type FichePose, type LignePose } from '../lib/db';
import PiecesJointes from '../components/PiecesJointes';
import FilAriane from '../components/FilAriane';

/**
 * La fiche de pose.
 *
 * Le premier écran de Batinium écrit pour le terrain et non pour le bureau.
 * Un technicien n'a pas besoin d'un devis avec ses remises et sa TVA : il a
 * besoin de savoir ce qu'il pose, en quelle quantité, dans quelle pièce, et
 * de ce qu'il ne faut pas oublier en arrivant.
 *
 * Les prix ne sont pas masqués : ils ne descendent pas. La vue `v_fiche_pose`
 * ne les expose pas, et le SQL 18 refuse de s'exécuter si quelqu'un les y
 * remet un jour. Cacher un prix avec du CSS l'aurait quand même laissé dans
 * la mémoire du téléphone.
 */
export default function PageFichePose({ chantierId }: { chantierId: string }) {
  const [f, setF] = useState<FichePose | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try { setF(await chargerFichePose(chantierId)); }
    catch (e) { setErreur((e as Error).message); }
  }, [chantierId]);

  useEffect(() => { void recharger(); }, [recharger]);

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!f) return null;

  const { chantier, site, tiers, lignes, sansDevis } = f;

  // Regroupement par zone puis par sous-lot, dans l'ordre du devis. La vue
  // fournit déjà le tri : on ne fait qu'empiler.
  const zones: { titre: string; blocs: { titre: string | null; lignes: LignePose[] }[] }[] = [];
  for (const l of lignes) {
    const nomZone = l.zone ?? 'Prestations';
    let zone = zones.find((z) => z.titre === nomZone);
    if (!zone) { zone = { titre: nomZone, blocs: [] }; zones.push(zone); }
    let bloc = zone.blocs.find((b) => b.titre === (l.sous_lot ?? null));
    if (!bloc) { bloc = { titre: l.sous_lot ?? null, lignes: [] }; zone.blocs.push(bloc); }
    bloc.lignes.push(l);
  }

  const totalLignes = lignes.length;
  const totalPieces = lignes.reduce((s, l) => s + Number(l.quantite), 0);

  return (
    <>
      <FilAriane etapes={[
        { libelle: 'Chantiers', vers: '/chantiers' },
        { libelle: chantier.numero, vers: `/chantiers/${chantierId}` },
        { libelle: 'Fiche de pose' },
      ]} />

      <div className="entete">
        <div>
          <h1>Fiche de pose</h1>
          <div className="statut">
            {chantier.numero} — {chantier.libelle}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }} className="sans-impression">
          <button className="action discret" onClick={() => window.print()}>Imprimer</button>
          <button className="action discret" onClick={() => aller('/heures')}>
            Pointer mes heures
          </button>
          <button className="action discret" onClick={() => aller(`/chantiers/${chantierId}`)}>
            Le chantier
          </button>
        </div>
      </div>

      <div className="panneau" style={{ display: 'block' }}>
        <div style={{ display: 'grid', gap: 14,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div>
            <span className="statut">Client</span>
            <div style={{ fontWeight: 600 }}>{tiers?.nom ?? '—'}</div>
            {tiers?.telephone && (
              <a href={`tel:${tiers.telephone.replace(/\s/g, '')}`}>{tiers.telephone}</a>
            )}
          </div>
          <div>
            <span className="statut">Adresse</span>
            <div>{site?.adresse ?? '—'}</div>
            <div>{[site?.code_postal, site?.ville].filter(Boolean).join(' ')}</div>
            {site?.adresse && (
              <a className="statut"
                 href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                   [site.adresse, site.code_postal, site.ville].filter(Boolean).join(' '))}`}
                 target="_blank" rel="noopener">
                Ouvrir l’itinéraire
              </a>
            )}
          </div>
          <div>
            <span className="statut">Dates</span>
            <div>
              {chantier.date_debut
                ? new Date(chantier.date_debut).toLocaleDateString('fr-FR')
                : 'à planifier'}
              {chantier.date_fin && ` → ${new Date(chantier.date_fin).toLocaleDateString('fr-FR')}`}
            </div>
          </div>
        </div>

        {site?.contraintes_acces && (
          <div style={{ marginTop: 12, borderLeft: '3px solid #b8860b', paddingLeft: 10 }}>
            <span className="statut">Accès</span>
            <div>{site.contraintes_acces}</div>
          </div>
        )}

        {chantier.notes && (
          <div style={{ marginTop: 12, borderLeft: '3px solid var(--bleu)', paddingLeft: 10 }}>
            <span className="statut">Notes de chantier</span>
            <div className="fiche">{chantier.notes}</div>
          </div>
        )}
      </div>

      {sansDevis ? (
        <div className="vide">
          Ce chantier n’est rattaché à aucun devis : il n’y a pas de liste à poser.
          Reportez-vous aux notes ci-dessus et au journal.
        </div>
      ) : totalLignes === 0 ? (
        <div className="vide">Le devis de ce chantier ne comporte aucune ligne.</div>
      ) : (
        <>
          <p className="statut" style={{ marginBottom: 10 }}>
            {totalLignes} ligne{totalLignes > 1 ? 's' : ''}, {totalPieces.toLocaleString('fr-FR')} unité
            {totalPieces > 1 ? 's' : ''} au total. Cochez au fur et à mesure sur le papier :
            le pointage dans l’application viendra.
          </p>

          {zones.map((z) => (
            <div key={z.titre} style={{ marginBottom: 18 }}>
              <h2 style={{ marginBottom: 8 }}>{z.titre}</h2>
              {z.blocs.map((b, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  {b.titre && <h3 style={{ margin: '8px 0 6px' }}>{b.titre}</h3>}
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 74 }} className="num">Qté</th>
                        <th>À poser</th>
                        <th style={{ width: 160 }}>Emplacement</th>
                        <th style={{ width: 120 }}>Référence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.lignes.map((l) => (
                        <tr key={l.id}>
                          <td className="num" style={{ fontWeight: 600 }}>
                            {Number(l.quantite).toLocaleString('fr-FR')}
                            <div className="statut">{l.unite}</div>
                          </td>
                          <td>
                            {l.designation}
                            {l.description && <div className="fiche">{l.description}</div>}
                            {l.consigne_pose && (
                              <div style={{ marginTop: 4, borderLeft: '3px solid #b8860b',
                                            paddingLeft: 8, fontSize: 12 }}>
                                <strong>Consigne de pose.</strong> {l.consigne_pose}
                              </div>
                            )}
                          </td>
                          <td className="ref">{l.emplacement ?? '—'}</td>
                          <td className="ref">{l.reference ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      <div className="sans-impression">
        <PiecesJointes cible={{ chantier_id: chantierId }} presentation="galerie"
                       accepte="image/*,video/*" titre="Photos du chantier"
                       onErreur={setErreur}
          aide="Ce qui a déjà été pris sur ce chantier. Pour ajouter une photo avec son
                explication, passez par le journal du chantier." />
      </div>
    </>
  );
}
