import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { calculerFacture, eur } from '../lib/calcul';
import {
  ajouterLigneFacture, chargerFacture, chargerParametres, creerAvoir, emettreFacture,
  enregistrerFacture, LIBELLES_FACTURE, majLigneFacture, supprimerLigneFacture,
  type FactureComplete,
} from '../lib/db';
import type { Facture, FactureLigne, Parametres } from '../lib/types';
import FilAriane from '../components/FilAriane';

/**
 * Une facture.
 *
 * Deux écrans selon son état, et ce n'est pas une commodité d'interface :
 * un brouillon est un travail en cours, qu'on modifie ; une facture émise
 * **est** le document, qu'on lit et qu'on imprime. Elle ne se modifie plus —
 * la base refuse, y compris depuis l'éditeur SQL. La seule façon de revenir
 * dessus est d'écrire son contraire : un avoir.
 */
export default function PageFacture({ factureId }: { factureId: string }) {
  const [f, setF] = useState<FactureComplete | null>(null);
  const [p, setP] = useState<Parametres | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try {
      const [complete, params] = await Promise.all([
        chargerFacture(factureId), chargerParametres().catch(() => null),
      ]);
      setF(complete); setP(params);
    } catch (e) { setErreur((e as Error).message); }
  }, [factureId]);

  useEffect(() => { void recharger(); }, [recharger]);
  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!f) return null;

  const { facture, lignes, tiers, site } = f;
  const calcul = calculerFacture(facture, lignes);
  const brouillon = facture.statut === 'brouillon';

  async function emettre() {
    if (!window.confirm(
      'Émettre cette facture ?\n\nElle recevra son numéro définitif et son contenu sera figé. '
      + 'Ensuite, seul un avoir permettra de revenir dessus.')) return;
    try { await emettreFacture(factureId); void recharger(); }
    catch (e) { setErreur((e as Error).message); }
  }

  async function avoir() {
    const motif = window.prompt('Motif de l’avoir ?', 'Annulation de la facture');
    if (motif === null) return;
    try {
      const a = await creerAvoir(factureId, motif);
      aller(`/factures/${a.id}`);
    } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <>
      <div className="sans-impression">
        <FilAriane etapes={[
          { libelle: 'Factures', vers: '/factures' },
          { libelle: facture.numero ?? 'Brouillon' },
        ]} />

        <div className="entete">
          <div>
            <h1>{facture.numero ?? 'Brouillon de facture'}</h1>
            <div className="statut">
              {LIBELLES_FACTURE[facture.type]} · {tiers?.nom ?? 'sans client'} · {facture.statut}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {brouillon
              ? <button className="action" onClick={() => void emettre()}>Émettre</button>
              : (
                <>
                  <button className="action" onClick={() => window.print()}>
                    Imprimer ou enregistrer en PDF
                  </button>
                  {facture.type !== 'avoir' && facture.statut !== 'annulee' && (
                    <button className="action discret" onClick={() => void avoir()}>
                      Établir un avoir
                    </button>
                  )}
                </>
              )}
            <button className="action discret" onClick={() => aller('/factures')}>Retour</button>
          </div>
        </div>

        {brouillon ? (
          <div className="panneau" style={{ display: 'block',
                                            borderLeft: '3px solid #b8860b' }}>
            <strong>Ce brouillon n’a pas de numéro.</strong>{' '}
            <span className="statut">
              Il en recevra un à l’émission, et pas avant : un numéro attribué puis
              supprimé laisserait un trou dans la série, ce qu’un contrôle regarde.
              Tant qu’il est ici, tout se corrige.
            </span>
          </div>
        ) : (
          <div className="panneau" style={{ display: 'block',
                                            borderLeft: '3px solid var(--bleu)' }}>
            <strong>Facture émise le{' '}
              {facture.emise_le && new Date(facture.emise_le).toLocaleDateString('fr-FR')}.</strong>{' '}
            <span className="statut">
              Son contenu est figé. Pour la corriger, établissez un avoir : on ne raye
              pas une facture, on écrit son contraire, et les deux documents restent.
            </span>
          </div>
        )}

        {brouillon && (
          <Edition facture={facture} lignes={lignes} onErreur={setErreur} onChange={recharger} />
        )}
      </div>

      {/* Le document lui-même : c'est lui qui part chez le client. */}
      {!brouillon && p && (
        <div className="document">
          <div className="doc-entete">
            <div>
              {p.logo_data_url && (
                <img src={p.logo_data_url} alt="" style={{ maxHeight: 54, marginBottom: 8 }} />
              )}
              <div style={{ fontWeight: 600, fontSize: 15 }}>{p.raison_sociale}</div>
              <div className="doc-petit">
                {p.adresse}<br />{p.code_postal} {p.ville}<br />
                {p.telephone} — {p.email}<br />
                {p.forme_juridique}<br />
                SIRET {p.siret} — TVA {p.tva_intracom}
              </div>
            </div>
            <div className="doc-client">
              <div className="doc-petit">Facturé à</div>
              <div style={{ fontWeight: 600 }}>{tiers?.nom}</div>
              <div className="doc-petit">
                {tiers?.adresse}<br />{tiers?.code_postal} {tiers?.ville}
                {tiers?.siret && <><br />SIRET {tiers.siret}</>}
              </div>
              {site && (
                <div className="doc-petit" style={{ marginTop: 8 }}>
                  <strong>Lieu des travaux</strong><br />
                  {site.adresse}<br />{site.code_postal} {site.ville}
                </div>
              )}
            </div>
          </div>

          <div className="doc-titre">
            <h2>{LIBELLES_FACTURE[facture.type]} {facture.numero}</h2>
            <div className="doc-petit">
              Émise le {new Date(facture.date_emission).toLocaleDateString('fr-FR')}
              {facture.echeance_le && (
                <> — échéance le {new Date(facture.echeance_le).toLocaleDateString('fr-FR')}</>
              )}
            </div>
          </div>

          {facture.intro && <div className="doc-encadre">{facture.intro}</div>}

          <table className="doc-table">
            <thead>
              <tr>
                <th>Désignation</th>
                <th style={{ width: 60 }}>Qté</th>
                <th style={{ width: 50 }}>Unité</th>
                <th style={{ width: 90 }}>PU HT</th>
                <th style={{ width: 60 }}>TVA</th>
                <th style={{ width: 95 }}>Total HT</th>
              </tr>
            </thead>
            <tbody>
              {calcul.lignes.map((l) => (
                <tr key={l.ligne.id}>
                  <td>
                    {l.ligne.designation}
                    {l.ligne.description && <div className="doc-fiche">{l.ligne.description}</div>}
                  </td>
                  <td className="num">{Number(l.ligne.quantite).toLocaleString('fr-FR')}</td>
                  <td>{l.ligne.unite}</td>
                  <td className="num">{eur(Number(l.ligne.prix_unitaire_ht))}</td>
                  <td className="num">{Number(l.ligne.taux_tva)} %</td>
                  <td className="num">{eur(l.totalHt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="doc-totaux">
            <tbody>
              <tr><td>Sous-total HT</td><td className="num">{eur(calcul.sousTotalHt)}</td></tr>
              {calcul.remise !== 0 && (
                <tr>
                  <td>{facture.remise_libelle ?? 'Remise'}</td>
                  <td className="num">− {eur(calcul.remise)}</td>
                </tr>
              )}
              <tr className="fort"><td>Total HT</td><td className="num">{eur(calcul.totalHt)}</td></tr>
              {calcul.ventilation.map((v) => (
                <tr key={v.taux}>
                  <td>TVA {v.taux} % sur {eur(v.baseHt)}</td>
                  <td className="num">{eur(v.montantTva)}</td>
                </tr>
              ))}
              <tr className="fort"><td>Total TTC</td><td className="num">{eur(calcul.totalTtc)}</td></tr>
              {calcul.acompteDeduit !== 0 && (
                <tr>
                  <td>Acompte déjà facturé</td>
                  <td className="num">− {eur(calcul.acompteDeduit)}</td>
                </tr>
              )}
              <tr className="grand">
                <td>Net à payer</td>
                <td className="num">{eur(calcul.netAPayer)}</td>
              </tr>
            </tbody>
          </table>

          <div className="doc-mentions">
            <h3>Règlement</h3>
            <p>
              Par virement sur le compte {p.iban}, à réception de facture
              {facture.echeance_le && (
                <>, au plus tard le {new Date(facture.echeance_le).toLocaleDateString('fr-FR')}</>
              )}.
            </p>
            {/* Réglable dans Entreprise. La valeur posée au SQL 21 reprend les
                mentions supplétives du code de commerce, pour que le document
                soit conforme même si personne n'y touche. */}
            {p.penalites_retard && <p>{p.penalites_retard}</p>}
            {p.mentions_reglement && <p>{p.mentions_reglement}</p>}
            {p.assureur_nom && (
              <p>
                Assurance décennale {p.assureur_nom}, contrat n° {p.assureur_police}
                {p.assureur_couverture && ` — couverture : ${p.assureur_couverture}`}.
              </p>
            )}
            {p.attestation_capacite && (
              <p>Attestation de capacité fluides frigorigènes n° {p.attestation_capacite}.</p>
            )}
          </div>

          <footer className="doc-pied">
            {p.raison_sociale} — {p.adresse}, {p.code_postal} {p.ville} — {p.telephone}<br />
            {p.forme_juridique} — SIRET {p.siret} {p.rcs} — TVA intra. {p.tva_intracom}
          </footer>
        </div>
      )}
    </>
  );
}

// --- Édition d'un brouillon -------------------------------------------------

function Edition({ facture, lignes, onErreur, onChange }: {
  facture: Facture;
  lignes: FactureLigne[];
  onErreur: (m: string) => void;
  onChange: () => void;
}) {
  const calcul = calculerFacture(facture, lignes);

  async function patcher(id: string, patch: Partial<FactureLigne>) {
    try { await majLigneFacture(id, patch); onChange(); }
    catch (e) { onErreur((e as Error).message); }
  }

  async function patcherFacture(patch: Partial<Facture>) {
    try { await enregistrerFacture({ id: facture.id, ...patch }); onChange(); }
    catch (e) { onErreur((e as Error).message); }
  }

  return (
    <>
      <div className="panneau" style={{ display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div>
          <label>Titre</label>
          <input defaultValue={facture.titre ?? ''}
                 onBlur={(e) => void patcherFacture({ titre: e.target.value || null })} />
        </div>
        <div>
          <label>Date d’émission</label>
          <input type="date" defaultValue={facture.date_emission}
                 onBlur={(e) => void patcherFacture({ date_emission: e.target.value })} />
        </div>
        <div>
          <label>Échéance</label>
          <input type="date" defaultValue={facture.echeance_le ?? ''}
                 onBlur={(e) => void patcherFacture({ echeance_le: e.target.value || null })} />
        </div>
        <div>
          <label>Acompte déjà facturé</label>
          <input type="number" step="0.01" className="num" defaultValue={facture.acompte_deduit}
                 onBlur={(e) => void patcherFacture({ acompte_deduit: Number(e.target.value) })} />
          <p className="statut">Se déduit du net à payer, pas de la base taxable.</p>
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label>Introduction, imprimée avant le tableau</label>
          <input defaultValue={facture.intro ?? ''}
                 onBlur={(e) => void patcherFacture({ intro: e.target.value || null })} />
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Désignation</th>
            <th style={{ width: 80 }} className="num">Qté</th>
            <th style={{ width: 70 }}>Unité</th>
            <th style={{ width: 110 }} className="num">PU HT</th>
            <th style={{ width: 80 }} className="num">TVA</th>
            <th style={{ width: 110 }} className="num">Total HT</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {calcul.lignes.map((l) => (
            <tr key={l.ligne.id}>
              <td>
                <input defaultValue={l.ligne.designation} style={{ padding: '3px 5px' }}
                       onBlur={(e) => void patcher(l.ligne.id, { designation: e.target.value })} />
              </td>
              <td>
                <input type="number" step="0.01" className="num" defaultValue={l.ligne.quantite}
                       style={{ padding: '3px 5px' }}
                       onBlur={(e) => void patcher(l.ligne.id, { quantite: Number(e.target.value) })} />
              </td>
              <td>
                <input defaultValue={l.ligne.unite} style={{ padding: '3px 5px', fontSize: 12 }}
                       onBlur={(e) => void patcher(l.ligne.id, { unite: e.target.value })} />
              </td>
              <td>
                <input type="number" step="0.01" className="num"
                       defaultValue={l.ligne.prix_unitaire_ht} style={{ padding: '3px 5px' }}
                       onBlur={(e) => void patcher(l.ligne.id,
                         { prix_unitaire_ht: Number(e.target.value) })} />
              </td>
              <td>
                <input type="number" step="0.1" className="num" defaultValue={l.ligne.taux_tva}
                       style={{ padding: '3px 5px' }}
                       onBlur={(e) => void patcher(l.ligne.id, { taux_tva: Number(e.target.value) })} />
              </td>
              <td className="num">{eur(l.totalHt)}</td>
              <td>
                <button className="action discret" style={{ padding: '2px 7px' }}
                        onClick={() => void supprimerLigneFacture(l.ligne.id).then(onChange)}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="action discret" style={{ marginTop: 10 }}
              onClick={() => void ajouterLigneFacture({
                facture_id: facture.id, position: lignes.length,
                designation: '', quantite: 1, prix_unitaire_ht: 0, taux_tva: 20,
              }).then(onChange).catch((e) => onErreur((e as Error).message))}>
        Ajouter une ligne
      </button>

      <table style={{ marginTop: 16, marginLeft: 'auto', width: 340 }}>
        <tbody>
          <tr><td>Total HT</td><td className="num">{eur(calcul.totalHt)}</td></tr>
          {calcul.ventilation.map((v) => (
            <tr key={v.taux}>
              <td className="statut">TVA {v.taux} %</td>
              <td className="num">{eur(v.montantTva)}</td>
            </tr>
          ))}
          <tr><td>Total TTC</td><td className="num">{eur(calcul.totalTtc)}</td></tr>
          <tr style={{ fontWeight: 600 }}>
            <td>Net à payer</td><td className="num">{eur(calcul.netAPayer)}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
