import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { aller } from '../lib/router';
import { calculerDevis, eur, type DevisCalcule, type LigneCalculee, type LotCalcule } from '../lib/calcul';
import {
  ajouterFil, ajouterLigne, ajouterLot, appliquerGabarit, chantierDepuisDevis, chargerDevis,
  dupliquerZone, listerGabarits, listerProduits, listerVariantes, ligneDepuisProduit,
  ligneDepuisVariante, majDevis, majLigne, majLot, signerDevis, supprimerLigne, supprimerLot,
  type SuiteSignature,
  type DevisComplet,
} from '../lib/db';
import type { Devis, DevisLigne, Gabarit, Produit, Variante } from '../lib/types';
import Modale from '../components/Modale';
import FilAriane from '../components/FilAriane';
import Caviardage from '../components/Caviardage';
import { jetonGoogle } from '../lib/session';
import SelecteurProduit from '../components/SelecteurProduit';
import PanneauTotaux from '../components/PanneauTotaux';

export default function PageEditeur({ devisId }: { devisId: string }) {
  const [d, setD] = useState<DevisComplet | null>(null);
  const [produits, setProduits] = useState<Produit[]>([]);
  const [variantes, setVariantes] = useState<Variante[]>([]);
  const [gabarits, setGabarits] = useState<Gabarit[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajoutDans, setAjoutDans] = useState<string | null>(null);
  const [signature, setSignature] = useState(false);
  const [suite, setSuite] = useState<SuiteSignature | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [occupe, setOccupe] = useState(false);
  // Tout est déjà écrit au fil de la frappe : l'horodatage le rend visible.
  const [enregistreA, setEnregistreA] = useState<Date | null>(null);

  const recharger = useCallback(async () => {
    try {
      setD(await chargerDevis(devisId));
    } catch (e) {
      setErreur((e as Error).message);
    }
  }, [devisId]);

  useEffect(() => {
    void recharger();
    listerProduits().then(setProduits).catch((e) => setErreur((e as Error).message));
    listerVariantes().then(setVariantes).catch(() => setVariantes([]));
    listerGabarits().then(setGabarits).catch((e) => setErreur((e as Error).message));
  }, [recharger]);

  const calcul: DevisCalcule | null = useMemo(() => {
    if (!d) return null;
    try {
      return calculerDevis(d.devis, d.lots, d.lignes, new Map(produits.map((p) => [p.id, p])), d.site);
    } catch (e) {
      setErreur((e as Error).message);
      return null;
    }
  }, [d, produits]);

  /** Écriture optimiste : l'écran ne bloque jamais sur le réseau. */
  function patcherDevis(patch: Partial<Devis>) {
    if (!d) return;
    setD({ ...d, devis: { ...d.devis, ...patch } });
    majDevis(devisId, patch)
      .then(() => setEnregistreA(new Date()))
      .catch((e) => setErreur((e as Error).message));
  }

  function patcherLigne(id: string, patch: Partial<DevisLigne>) {
    if (!d) return;
    setD({ ...d, lignes: d.lignes.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
    majLigne(id, patch)
      .then(() => setEnregistreA(new Date()))
      .catch((e) => setErreur((e as Error).message));
  }

  async function agir(action: () => Promise<unknown>) {
    setOccupe(true);
    try {
      await action();
      await recharger();
    } catch (e) {
      setErreur((e as Error).message);
    }
    setOccupe(false);
  }

  if (!d || !calcul) return erreur ? <div className="erreur">{erreur}</div> : null;

  const racines = calcul.arbre;

  return (
    <>
      <FilAriane etapes={[
        { libelle: 'Aujourd’hui', vers: '/bord' },
        { libelle: 'Devis', vers: '/devis' },
        ...(d.tiers ? [{ libelle: d.tiers.nom, vers: `/clients/${d.tiers.id}` }] : []),
        { libelle: d.devis.numero },
      ]} />

      <div className="entete sans-impression">
        <div>
          <h1>{d.devis.numero}</h1>
          <div className="statut">
            {d.tiers?.nom ?? 'Sans client'}
            {d.site ? ` — ${d.site.adresse}, ${d.site.ville ?? ''}` : ''}
            {d.site?.annee_achevement
              ? ` · achevé en ${d.site.annee_achevement}`
              : ' · année d’achèvement inconnue, TVA à 20 %'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="statut" style={{ marginRight: 4 }}>
            {enregistreA
              ? `Enregistré à ${enregistreA.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
              : 'Enregistrement automatique'}
          </span>
          <button className="action discret" onClick={() => aller('/devis')}>Retour</button>
          <button className="action discret" onClick={() => void agir(async () => {
            await majDevis(devisId, {});
            setEnregistreA(new Date());
          })}>Enregistrer</button>
          <button className="action discret" onClick={() => aller(`/imprimer/${devisId}`)}>
            Aperçu et PDF
          </button>
          {d.lignes.length > 0 && d.devis.statut !== 'signe' && (
            <button className="action discret" onClick={() => setEnvoi(true)}>Envoyer</button>
          )}
          {d.devis.statut !== 'signe' && d.lignes.length > 0 && (
            <button className="action" onClick={() => setSignature(true)}>Signé</button>
          )}
          {d.devis.statut === 'signe' && (
            <button className="action" onClick={() => void agir(async () => {
              const c = await chantierDepuisDevis(devisId);
              aller(`/chantiers/${c.id}`);
            })}>Ouvrir le chantier</button>
          )}
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {d.devis.statut === 'signe' && d.devis.retractation_fin_le && (
        <div className="erreur sans-impression"
             style={{ borderColor: 'var(--bleu)', color: 'var(--encre)', background: 'var(--bleu-pale)' }}>
          Rétractation possible jusqu’au{' '}
          {new Date(d.devis.retractation_fin_le).toLocaleDateString('fr-FR')}.
          {d.devis.encaissement_autorise_le &&
            new Date(d.devis.encaissement_autorise_le) > new Date() && (
            <> Aucun encaissement avant le{' '}
              {new Date(d.devis.encaissement_autorise_le).toLocaleDateString('fr-FR')} :
              contrat conclu hors établissement.</>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20 }}>
        <div>
          <EnteteEditable devis={d.devis} onChange={patcherDevis} />

          {racines.length === 0 ? (
            <div className="vide">
              Devis vide. Ajoutez une zone depuis un gabarit, c’est le plus rapide.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 56 }}>N°</th>
                  <th>Désignation</th>
                  <th style={{ width: 70 }} className="num">Qté</th>
                  <th style={{ width: 66 }}>Unité</th>
                  <th style={{ width: 110 }} className="num">PU HT</th>
                  <th style={{ width: 92 }}>TVA</th>
                  <th style={{ width: 120 }} className="num">Total HT</th>
                  <th style={{ width: 40 }} className="sans-impression" />
                </tr>
              </thead>
              <tbody>
                {racines.map((lot) => (
                  <BlocLot
                    key={lot.lot.id}
                    noeud={lot}
                    profondeur={0}
                    onPatchLigne={patcherLigne}
                    onSupprimerLigne={(id) => void agir(() => supprimerLigne(id))}
                    onRenommer={(id, titre) => void majLot(id, { titre })}
                    onSupprimerLot={(id) =>
                      window.confirm('Supprimer ce lot et tout ce qu’il contient ?') &&
                      void agir(() => supprimerLot(id))
                    }
                    onAjouterLigne={setAjoutDans}
                    onAjouterSousLot={(parentId, position) =>
                      void agir(() => ajouterLot(devisId, 'Nouveau sous-lot', parentId, position))
                    }
                    onDupliquerZone={(id) => void agir(() => dupliquerZone(devisId, id))}
                  />
                ))}
              </tbody>
            </table>
          )}

          <BarreOutils
            gabarits={gabarits}
            occupe={occupe}
            onNouvelleZone={() =>
              void agir(() => ajouterLot(devisId, 'NOUVELLE ZONE', null, racines.length))
            }
            onGabarit={(g) =>
              void agir(() =>
                appliquerGabarit(devisId, g, g.nom.toUpperCase(), produits, racines.length),
              )
            }
          />
        </div>

        <PanneauTotaux devis={d.devis} calcul={calcul} onChange={patcherDevis} />
      </div>

      {envoi && (
        <Envoi
          devis={d.devis}
          nomClient={d.tiers?.nom ?? ''}
          emailClient={d.tiers?.email ?? ''}
          onAnnuler={() => setEnvoi(false)}
          onEnvoye={() => {
            setEnvoi(false);
            void agir(async () => {
              await majDevis(devisId, {
                statut: 'envoye',
                envoye_le: new Date().toISOString(),
                relance_prochaine_le: dans(3),
              });
              if (d.devis.tiers_id) {
                await ajouterFil({
                  tiers_id: d.devis.tiers_id, devis_id: devisId, type: 'devis_envoye',
                  sujet: `Devis ${d.devis.numero} envoyé`,
                });
              }
            });
          }}
        />
      )}

      {suite && (
        <Modale titre={`Devis ${suite.devis.numero} signé`} onFermer={() => setSuite(null)}>
          <p style={{ marginBottom: 12 }}>
            Le chantier <strong>{suite.chantier.numero}</strong> est ouvert.
          </p>
          <ul style={{ marginBottom: 12 }}>
            <li>{suite.approvisionnements} référence(s) à commander, reprises du devis.</li>
            <li>{suite.machines} machine(s) créée(s) — numéro de série à relever sur la plaque.</li>
            <li>{suite.interventions} intervention(s) créée(s), sans date ni personne.</li>
            <li>{suite.encaissements} échéance(s) d’encaissement.</li>
            <li>
              {suite.facture
                ? 'Facture d’acompte préparée en brouillon.'
                : 'Aucune facture d’acompte.'}
            </li>
          </ul>
          {suite.avertissements.length > 0 && (
            <div className="erreur">
              {suite.avertissements.map((a, i) => <div key={i}>{a}</div>)}
            </div>
          )}
          <p className="statut" style={{ marginBottom: 12 }}>
            Il reste à faire ce que la machine ne peut pas décider : dater les
            interventions et y affecter des personnes.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="action" onClick={() => aller(`/chantiers/${suite.chantier.id}`)}>
              Ouvrir le chantier
            </button>
            {suite.facture && (
              <button className="action discret"
                      onClick={() => aller(`/factures/${suite.facture!.id}`)}>
                Voir la facture d’acompte
              </button>
            )}
            <button className="action discret" onClick={() => setSuite(null)}>Rester ici</button>
          </div>
        </Modale>
      )}

      {signature && (
        <Signature
          onAnnuler={() => setSignature(false)}
          onValider={(mode, acompte) => {
            setSignature(false);
            void agir(async () => {
              // Un seul geste : chantier, matériel à commander, interventions
              // à planifier, échéances et facture d'acompte. Il ne restera au
              // gérant que les dates et les personnes.
              const suite = await signerDevis(devisId, mode, { acompte: acompte > 0,
                                                               pourcentageAcompte: acompte });
              setSuite(suite);
            });
          }}
        />
      )}

      {ajoutDans && (
        <SelecteurProduit
          produits={produits}
          variantes={variantes}
          onFermer={() => setAjoutDans(null)}
          onChoisir={(p, q, v) => {
            const position = d.lignes.filter((l) => l.lot_id === ajoutDans).length;
            void agir(() => ajouterLigne(v
              ? ligneDepuisVariante(p, v, devisId, ajoutDans, position, q)
              : ligneDepuisProduit(p, devisId, ajoutDans, position, q)));
          }}
        />
      )}
    </>
  );
}

// --- En-tête du devis -------------------------------------------------------

function EnteteEditable({ devis, onChange }: { devis: Devis; onChange: (p: Partial<Devis>) => void }) {
  return (
    <div
      className="sans-impression"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--filet)',
        padding: 14,
        marginBottom: 14,
        display: 'grid',
        gap: 10,
        gridTemplateColumns: '2fr 1fr 1fr',
      }}
    >
      <div>
        <label>Objet</label>
        <input
          value={devis.titre ?? ''}
          onChange={(e) => onChange({ titre: e.target.value })}
          placeholder="CLIMATISATION A CONDENSATION"
        />
      </div>
      <div>
        <label>Nature des travaux</label>
        <select
          value={devis.type_prestation}
          onChange={(e) => onChange({ type_prestation: e.target.value as Devis['type_prestation'] })}
        >
          <option value="installation">Installation</option>
          <option value="mise_en_service">Mise en service</option>
          <option value="entretien">Entretien</option>
          <option value="depannage">Dépannage</option>
        </select>
      </div>
      <div>
        <label>Validité (jours)</label>
        <input
          type="number"
          className="num"
          value={devis.validite_jours}
          onChange={(e) => onChange({ validite_jours: Number(e.target.value) })}
        />
      </div>
      <div style={{ gridColumn: 'span 3', display: 'grid', gap: 10,
                    gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <label>Note pour le client — imprimée sur le devis</label>
          <textarea
            rows={4}
            value={devis.intro ?? ''}
            onChange={(e) => onChange({ intro: e.target.value })}
            placeholder="Devis établi suite à visite. Le comptage de l’eau doit être individuel…"
          />
        </div>
        <div>
          <label style={{ color: 'var(--alerte)' }}>
            Note interne — jamais imprimée, jamais envoyée
          </label>
          <textarea
            rows={4}
            style={{ background: '#fdfaf3' }}
            value={devis.notes_internes ?? ''}
            onChange={(e) => onChange({ notes_internes: e.target.value })}
            placeholder="Le syndic est exigeant sur le bruit. Prévoir large sur le caisson."
          />
        </div>
      </div>
    </div>
  );
}

// --- Arborescence -----------------------------------------------------------

interface ActionsLot {
  onPatchLigne: (id: string, p: Partial<DevisLigne>) => void;
  onSupprimerLigne: (id: string) => void;
  onRenommer: (id: string, titre: string) => void;
  onSupprimerLot: (id: string) => void;
  onAjouterLigne: (lotId: string) => void;
  onAjouterSousLot: (parentId: string, position: number) => void;
  onDupliquerZone: (id: string) => void;
}

function BlocLot({
  noeud,
  profondeur,
  ...a
}: { noeud: LotCalcule; profondeur: number } & ActionsLot) {
  const racine = profondeur === 0;
  return (
    <Fragment>
      <tr style={{ background: racine ? 'var(--bleu-pale)' : 'var(--papier)' }}>
        <td className="num">{noeud.numero}</td>
        <td colSpan={5}>
          <input
            defaultValue={noeud.lot.titre}
            onBlur={(e) => a.onRenommer(noeud.lot.id, e.target.value)}
            style={{
              border: 0,
              background: 'transparent',
              padding: 0,
              fontWeight: 600,
              fontSize: racine ? 15 : 13,
            }}
          />
        </td>
        <td className="num" style={{ fontWeight: 600 }}>
          {eur(noeud.totalHt)}
        </td>
        <td className="sans-impression" style={{ whiteSpace: 'nowrap' }}>
          <Menu
            actions={[
              ['Ajouter un produit ou un service', () => a.onAjouterLigne(noeud.lot.id)],
              ['Ajouter un sous-lot', () => a.onAjouterSousLot(noeud.lot.id, noeud.enfants.length)],
              ...(racine
                ? ([['Dupliquer la zone', () => a.onDupliquerZone(noeud.lot.id)]] as [string, () => void][])
                : []),
              ['Supprimer', () => a.onSupprimerLot(noeud.lot.id)],
            ]}
          />
        </td>
      </tr>

      {noeud.lignes.map((l) => (
        <LigneEditable key={l.id} ligne={l} {...a} />
      ))}

      {noeud.enfants.map((e) => (
        <BlocLot key={e.lot.id} noeud={e} profondeur={profondeur + 1} {...a} />
      ))}
    </Fragment>
  );
}

function LigneEditable({
  ligne,
  onPatchLigne,
  onSupprimerLigne,
}: { ligne: LigneCalculee } & ActionsLot) {
  const [voirTva, setVoirTva] = useState(false);
  const auto = ligne.justificationAuto;
  const ecart = ligne.taux_force && Number(ligne.taux_tva) !== auto.taux;

  return (
    <>
      <tr>
        <td className="num ref">{ligne.numero}</td>
        <td>
          <input
            defaultValue={ligne.designation}
            onBlur={(e) => onPatchLigne(ligne.id, { designation: e.target.value })}
            style={{ border: 0, background: 'transparent', padding: 0 }}
          />
          {ligne.description && <div className="fiche">{ligne.description}</div>}
        </td>
        <td>
          <input
            type="number"
            step="0.01"
            className="num"
            defaultValue={ligne.quantite}
            onBlur={(e) => onPatchLigne(ligne.id, { quantite: Number(e.target.value) })}
            style={{ border: 0, background: 'transparent', padding: 0 }}
          />
        </td>
        <td>
          <input
            defaultValue={ligne.unite}
            onBlur={(e) => onPatchLigne(ligne.id, { unite: e.target.value })}
            style={{ border: 0, background: 'transparent', padding: 0 }}
          />
        </td>
        <td>
          <input
            type="number"
            step="0.01"
            className="num"
            defaultValue={ligne.prix_unitaire_ht}
            onBlur={(e) => onPatchLigne(ligne.id, { prix_unitaire_ht: Number(e.target.value) })}
            style={{ border: 0, background: 'transparent', padding: 0 }}
          />
        </td>
        <td>
          <button
            className="taux"
            data-t={String(ligne.taux_tva)}
            onClick={() => setVoirTva(!voirTva)}
            style={{ cursor: 'pointer', background: 'none' }}
            title="Voir pourquoi ce taux"
          >
            {String(ligne.taux_tva).replace('.', ',')} %{ecart ? ' ⚑' : ''}
          </button>
        </td>
        <td className="num">{eur(ligne.totalHt)}</td>
        <td className="sans-impression">
          <button
            className="action discret"
            style={{ padding: '2px 8px' }}
            onClick={() => onSupprimerLigne(ligne.id)}
            title="Supprimer la ligne"
          >
            ×
          </button>
        </td>
      </tr>

      {voirTva && (
        <tr className="sans-impression">
          <td />
          <td colSpan={7} style={{ background: 'var(--papier)' }}>
            <strong>{auto.libelle}</strong> — {auto.taux} %{' '}
            <span className="statut">({auto.baseLegale})</span>
            <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
              {auto.criteres.map((c) => (
                <li key={c.code} style={{ color: c.satisfait ? 'var(--vert)' : 'var(--alerte)' }}>
                  {c.satisfait ? '✓' : '✗'} {c.libelle} — constaté : {c.constate}
                </li>
              ))}
              {auto.criteres.length === 0 && <li className="statut">Aucun critère : taux par défaut.</li>}
            </ul>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ margin: 0 }}>Forcer le taux</label>
              <select
                style={{ width: 150 }}
                value={ligne.taux_force ? String(ligne.taux_tva) : 'auto'}
                onChange={(e) =>
                  onPatchLigne(
                    ligne.id,
                    e.target.value === 'auto'
                      ? { taux_force: false, taux_tva: auto.taux, justification_tva: null }
                      : {
                          taux_force: true,
                          taux_tva: Number(e.target.value),
                          justification_tva: auto,
                        },
                  )
                }
              >
                <option value="auto">Automatique ({auto.taux} %)</option>
                <option value="5.5">5,5 %</option>
                <option value="10">10 %</option>
                <option value="20">20 %</option>
              </select>
              {ecart && (
                <span className="statut" style={{ color: 'var(--alerte)' }}>
                  Taux forcé, différent de ce que le moteur applique. La justification d’origine reste archivée.
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// --- Petits composants ------------------------------------------------------

function Menu({ actions }: { actions: [string, () => void][] }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <span style={{ position: 'relative' }}>
      <button
        className="action discret"
        style={{ padding: '2px 8px' }}
        onClick={() => setOuvert(!ouvert)}
      >
        ⋯
      </button>
      {ouvert && (
        <>
          <span
            style={{ position: 'fixed', inset: 0, zIndex: 20 }}
            onClick={() => setOuvert(false)}
          />
          <span
            style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              zIndex: 21,
              background: 'var(--surface)',
              border: '1px solid var(--filet)',
              boxShadow: '0 6px 20px rgba(22,32,43,.14)',
              minWidth: 190,
              display: 'block',
            }}
          >
            {actions.map(([libelle, action]) => (
              <button
                key={libelle}
                onClick={() => {
                  setOuvert(false);
                  action();
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 12px',
                  border: 0,
                  background: 'none',
                  font: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {libelle}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}

function BarreOutils({
  gabarits,
  occupe,
  onNouvelleZone,
  onGabarit,
}: {
  gabarits: Gabarit[];
  occupe: boolean;
  onNouvelleZone: () => void;
  onGabarit: (g: Gabarit) => void;
}) {
  return (
    <div
      className="sans-impression"
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}
    >
      <button className="action" onClick={onNouvelleZone} disabled={occupe}>
        Nouvelle zone
      </button>
      <span className="statut">ou depuis un gabarit :</span>
      {gabarits.map((g) => (
        <button
          key={g.id}
          className="action discret"
          onClick={() => onGabarit(g)}
          disabled={occupe}
          title={g.description ?? ''}
        >
          {g.nom}
        </button>
      ))}
      {occupe && <span className="statut">…</span>}
    </div>
  );
}


// --- Signature : le mode de conclusion décide des délais légaux -------------

function dans(jours: number): string {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  return d.toISOString().slice(0, 10);
}

function Signature({ onAnnuler, onValider }: {
  onAnnuler: () => void;
  /** `acompte` en pourcentage, 0 pour n'en pas établir. */
  onValider: (mode: Devis['mode_conclusion'], acompte: number) => void;
}) {
  const [mode, setMode] = useState<Devis['mode_conclusion']>('distance');
  const [acompte, setAcompte] = useState(30);
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(22,32,43,.35)',
      display: 'grid', placeItems: 'center', zIndex: 50,
    }} onClick={onAnnuler}>
      <div onClick={(e) => e.stopPropagation()} className="panneau"
           style={{ width: 'min(560px, 94vw)', display: 'block', margin: 0 }}>
        <h2 style={{ marginBottom: 8 }}>Comment le devis a-t-il été signé ?</h2>
        <p className="statut" style={{ marginBottom: 12 }}>
          Ce choix détermine le délai de rétractation et la date à partir de laquelle
          l’acompte peut être encaissé. Il n’est pas cosmétique.
        </p>

        {([
          ['distance', 'À distance', 'Le client a renvoyé le devis signé par courriel. Rétractation de 14 jours, encaissement possible immédiatement.'],
          ['hors_etablissement', 'Chez le client', 'Signé en votre présence au domicile du client. Rétractation de 14 jours et aucun encaissement pendant 7 jours.'],
          ['etablissement', 'Dans vos locaux', 'Le client est venu signer chez vous. Pas de droit de rétractation.'],
        ] as [Devis['mode_conclusion'], string, string][]).map(([cle, titre, texte]) => (
          <label key={cle} style={{
            display: 'flex', gap: 10, alignItems: 'start', padding: 10, marginBottom: 6,
            border: `1px solid ${mode === cle ? 'var(--bleu)' : 'var(--filet)'}`,
            background: mode === cle ? 'var(--bleu-pale)' : 'transparent',
            color: 'var(--encre)', cursor: 'pointer',
          }}>
            <input type="radio" name="mode" checked={mode === cle} style={{ width: 'auto', marginTop: 3 }}
                   onChange={() => setMode(cle)} />
            <span>
              <strong>{titre}</strong>
              <div className="statut">{texte}</div>
            </span>
          </label>
        ))}

        <div style={{ borderTop: '1px solid var(--filet)', marginTop: 14, paddingTop: 12 }}>
          <label>Facture d’acompte</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="number" min={0} max={100} step={1} className="num" style={{ width: 90 }}
                   value={acompte} onChange={(e) => setAcompte(Number(e.target.value))} />
            <span className="statut">% — mettre 0 pour ne pas en établir</span>
          </div>
          <p className="statut" style={{ marginTop: 8 }}>
            En enregistrant, Batinium ouvre le chantier, y recopie le matériel à commander,
            crée les interventions à planifier, génère les échéances d’encaissement et
            prépare la facture d’acompte en brouillon. Il vous restera les dates et
            les personnes.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="action" onClick={() => onValider(mode, acompte)}>
            Enregistrer la signature
          </button>
          <button className="action discret" onClick={onAnnuler}>Annuler</button>
        </div>
      </div>
    </div>
  );
}


// --- Envoi du devis ---------------------------------------------------------

/**
 * Prépare le message, marque le devis envoyé et programme la relance à trois
 * jours. La pièce jointe reste manuelle : générer le PDF côté serveur viendra
 * avec le module d'impression, et mieux vaut le dire que le laisser croire.
 */
function Envoi({ devis, nomClient, emailClient, onAnnuler, onEnvoye }: {
  devis: Devis;
  nomClient: string;
  emailClient: string;
  onAnnuler: () => void;
  onEnvoye: () => void;
}) {
  const [destinataire, setDestinataire] = useState(emailClient);
  const [objet, setObjet] = useState(
    `Votre devis ${devis.numero}${devis.titre ? ` — ${devis.titre}` : ''}`,
  );
  const [message, setMessage] = useState(
    `Bonjour${nomClient ? ` ${nomClient}` : ''},\n\n` +
    `Vous trouverez ci-joint le devis ${devis.numero} correspondant à notre échange.\n` +
    `Il est valable ${devis.validite_jours} jours.\n\n` +
    `Je reste à votre disposition pour toute question.\n\n` +
    `Cordialement,`,
  );

  const google = Boolean(jetonGoogle());

  function ouvrirMessagerie() {
    const url = `mailto:${encodeURIComponent(destinataire)}` +
      `?subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    onEnvoye();
  }

  return (
    <Modale titre={`Envoyer le devis ${devis.numero}`} onFermer={onAnnuler}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label>Destinataire</label>
          <input type="email" value={destinataire}
                 onChange={(e) => setDestinataire(e.target.value)} />
          {!emailClient && (
            <p className="statut" style={{ color: 'var(--alerte)' }}>
              Ce client n’a pas d’adresse enregistrée. Saisissez-la ici, puis complétez sa fiche.
            </p>
          )}
        </div>
        <div>
          <label>Objet</label>
          <input value={objet} onChange={(e) => setObjet(e.target.value)} />
        </div>
        <div>
          <label>Message</label>
          <textarea rows={9} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>

        <div className="panneau" style={{ display: 'block', margin: 0,
                                          borderLeft: '3px solid #b8860b' }}>
          <strong style={{ fontSize: 13 }}>Avant d’envoyer</strong>
          <p className="statut">
            Le PDF n’est pas encore joint automatiquement. Passez par « Aperçu et PDF »,
            enregistrez le fichier, puis joignez-le à votre message. La génération
            automatique arrivera avec le module d’impression serveur.
          </p>
        </div>

        {/* Une relecture avant que le message ne parte : un prix d'achat ou une
            note interne oubliés dans un courriel ne se rattrapent pas. */}
        <Caviardage texte={message}
                    onRemplacer={(avant, apres) => setMessage((m) => m.split(avant).join(apres))} />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="action" disabled={!destinataire} onClick={ouvrirMessagerie}>
            Ouvrir dans ma messagerie
          </button>
          <button className="action discret" onClick={onEnvoye}>
            Marquer envoyé seulement
          </button>
          <button className="action discret" onClick={onAnnuler}>Annuler</button>
        </div>

        <p className="statut">
          Dans les deux cas, le devis passe en « envoyé », l’événement s’inscrit à
          l’historique du client et une relance est programmée dans trois jours.
          {google ? '' : ' Connectez Google si vous voulez envoyer depuis Batinium plus tard.'}
        </p>
      </div>
    </Modale>
  );
}
