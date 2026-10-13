import { useCallback, useEffect, useState } from 'react';
import { eur } from '../lib/calcul';
import {
  approvisionnementsOuverts, ecartsAchat, enregistrerAchat, enregistrerLigneAchat,
  alignerPrixCatalogue, listerAchats, listerChantiers, listerLignesAchat, listerMembres,
  rapprocher, saisieRapideAchat, STATUTS_ACHAT, supprimerAchat, supprimerLigneAchat,
  type AchatAvecLignes, type ChantierAvecTiers,
} from '../lib/db';
import PiecesJointes from '../components/PiecesJointes';
import type {
  Achat, AchatLigne, Approvisionnement, Chantier, EcartAchat, Membre,
} from '../lib/types';
import Modale from '../components/Modale';
import Menu from '../components/Menu';
import Squelette from '../components/Squelette';

type ApproOuvert = Approvisionnement & {
  chantier: Pick<Chantier, 'id' | 'numero' | 'libelle'> | null;
};

/**
 * Les achats.
 *
 * La seconde moitié de la marge réelle. On savait ce qu'un chantier coûtait en
 * heures depuis le pointage ; il manquait ce qu'il coûte en matériel — le
 * vrai, celui de la facture, et non le prix d'achat inscrit au catalogue il y
 * a huit mois.
 *
 * Une facture fournisseur ne se rattache pas à un chantier : une commande
 * couvre souvent deux ou trois chantiers, plus du stock. C'est ligne à ligne
 * que le rattachement se fait, et c'est là que le travail se trouve.
 */
export default function PageAchats() {
  const [onglet, setOnglet] = useState<'factures' | 'ecarts'>('factures');
  const [erreur, setErreur] = useState<string | null>(null);

  return (
    <>
      <div className="entete"><h1>Achats</h1></div>
      {erreur && <div className="erreur">{erreur}</div>}

      <div className="onglets">
        <button aria-current={onglet === 'factures'} onClick={() => setOnglet('factures')}>
          Factures fournisseurs
        </button>
        <button aria-current={onglet === 'ecarts'} onClick={() => setOnglet('ecarts')}>
          Écarts de prix
        </button>
      </div>

      {onglet === 'factures'
        ? <Factures onErreur={setErreur} />
        : <Ecarts onErreur={setErreur} />}
    </>
  );
}

// --- Factures fournisseurs --------------------------------------------------

function Factures({ onErreur }: { onErreur: (m: string) => void }) {
  const [achats, setAchats] = useState<AchatAvecLignes[]>([]);
  const [appros, setAppros] = useState<ApproOuvert[]>([]);
  const [charge, setCharge] = useState(false);
  const [ouvert, setOuvert] = useState<Achat | null>(null);
  const [edition, setEdition] = useState<Partial<Achat> | null>(null);
  const [rapide, setRapide] = useState(false);
  const [chantiers, setChantiers] = useState<ChantierAvecTiers[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);

  const recharger = useCallback(async () => {
    try {
      const [a, ap, c, m] = await Promise.all([
        listerAchats(), approvisionnementsOuverts().catch(() => []),
        listerChantiers().catch(() => []), listerMembres().catch(() => []),
      ]);
      setAchats(a); setAppros(ap as ApproOuvert[]);
      setChantiers(c); setMembres(m.filter((x) => x.actif));
    } catch (e) { onErreur((e as Error).message); }
    setCharge(true);
  }, [onErreur]);

  useEffect(() => { void recharger(); }, [recharger]);
  if (!charge) return <Squelette chiffres={3} lignes={6} colonnes={6} />;

  const aRapprocher = achats.filter((a) => a.rattachees < a.lignes || a.lignes === 0);
  const total = (l: AchatAvecLignes[]) => l.reduce((s, a) => s + Number(a.montant_ht ?? 0), 0);
  const impayees = achats.filter((a) => !a.paye_le);

  return (
    <>
      <div style={{ display: 'grid', gap: 12, marginBottom: 16,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Chiffre libelle="Factures reçues" valeur={achats.length} />
        <Chiffre libelle="À rapprocher" valeur={aRapprocher.length}
                 alerte={aRapprocher.length > 0}
                 note="lignes non rattachées à un chantier" />
        <Chiffre libelle="Restant à payer" valeur={eur(total(impayees))}
                 note={`${impayees.length} facture${impayees.length > 1 ? 's' : ''}`} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {/* Le ticket de comptoir d'abord : c'est le geste le plus fréquent, et
            celui qu'on abandonne s'il prend trois écrans. */}
        <button className="action" onClick={() => setRapide(true)}>
          Ticket de comptoir
        </button>
        <button className="action discret"
                onClick={() => setEdition({
                  fournisseur: '', statut: 'a_rapprocher',
                  date_facture: new Date().toISOString().slice(0, 10),
                })}>
          Facture détaillée
        </button>
      </div>

      {achats.length === 0 ? (
        <div className="vide">
          Aucune facture fournisseur. Sans elles, la marge d’un chantier reste une
          prévision : on compare un prix de vente à un prix de catalogue.
        </div>
      ) : (
        <div className="tableau-defilant">
          <table>
            <thead>
              <tr>
                <th style={{ width: 160 }}>Fournisseur</th>
                <th style={{ width: 140 }}>Numéro</th>
                <th style={{ width: 105 }}>Date</th>
                <th className="num" style={{ width: 110 }}>Montant HT</th>
                <th style={{ width: 150 }}>Rapprochement</th>
                <th style={{ width: 110 }}>État</th>
                <th style={{ width: 50 }} className="sans-impression" />
              </tr>
            </thead>
            <tbody>
              {achats.map((a) => {
                const complet = a.lignes > 0 && a.rattachees === a.lignes;
                return (
                  <tr key={a.id} className="cliquable" onClick={() => setOuvert(a)}
                      style={!complet ? { background: '#fdf7ee' } : undefined}>
                    <td><strong>{a.fournisseur}</strong></td>
                    <td className="ref">{a.numero ?? '—'}</td>
                    <td className="num ref">
                      {new Date(a.date_facture).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="num">{a.montant_ht != null ? eur(Number(a.montant_ht)) : '—'}</td>
                    <td>
                      <span className="jeton" data-r={complet ? 'recu' : 'retard'}>
                        {a.rattachees} / {a.lignes} ligne{a.lignes > 1 ? 's' : ''}
                      </span>
                    </td>
                    <td className="statut">{STATUTS_ACHAT[a.statut]}</td>
                    <td className="sans-impression" style={{ whiteSpace: 'nowrap' }}
                        onClick={(e) => e.stopPropagation()}>
                      {/* Explicite plutôt que caché dans le menu : contrairement
                          à nos factures, celles des fournisseurs ne sont pas
                          figées — notre saisie peut toujours être fausse, et la
                          corriger doit être le geste évident. */}
                      <button className="action discret" style={{ padding: '2px 9px' }}
                              onClick={() => setEdition(a)}>Modifier</button>{' '}
                      <Menu actions={[
                        { libelle: 'Ouvrir et rapprocher', faire: () => setOuvert(a) },
                        { libelle: 'Modifier l’en-tête', faire: () => setEdition(a) },
                        { libelle: 'Supprimer', danger: true, faire: () => {
                            if (window.confirm(`Supprimer la facture ${a.numero ?? ''} ?`)) {
                              void supprimerAchat(a.id).then(recharger)
                                .catch((e) => onErreur((e as Error).message));
                            }
                          } },
                      ]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rapide && (
        <Modale titre="Ticket de comptoir" onFermer={() => setRapide(false)}>
          <SaisieRapide chantiers={chantiers} membres={membres} onErreur={onErreur}
                        onEnregistre={() => { setRapide(false); void recharger(); }} />
        </Modale>
      )}

      {edition && (
        <Modale titre={edition.id ? 'Modifier la facture' : 'Nouvelle facture fournisseur'}
                taille="large" onFermer={() => setEdition(null)}>
          <Entete achat={edition} onErreur={onErreur}
                  onEnregistre={(a) => { setEdition(null); void recharger(); if (!edition.id) setOuvert(a); }} />
        </Modale>
      )}

      {ouvert && (
        <Modale titre={`${ouvert.fournisseur} — ${ouvert.numero ?? 'sans numéro'}`}
                taille="large" onFermer={() => { setOuvert(null); void recharger(); }}>
          <Lignes achat={ouvert} appros={appros} onErreur={onErreur} />
        </Modale>
      )}
    </>
  );
}

function Entete({ achat, onEnregistre, onErreur }: {
  achat: Partial<Achat>;
  onEnregistre: (a: Achat) => void;
  onErreur: (m: string) => void;
}) {
  const [a, setA] = useState<Partial<Achat>>(achat);
  const set = (k: keyof Achat, v: unknown) => setA((p) => ({ ...p, [k]: v }));

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
      <div>
        <label>Fournisseur</label>
        <input value={a.fournisseur ?? ''} placeholder="Cedeo, Rexel, Daikin…"
               onChange={(e) => set('fournisseur', e.target.value)} />
      </div>
      <div>
        <label>Numéro de facture</label>
        <input value={a.numero ?? ''} onChange={(e) => set('numero', e.target.value || null)} />
      </div>
      <div>
        <label>Date de facture</label>
        <input type="date" value={a.date_facture ?? ''}
               onChange={(e) => set('date_facture', e.target.value)} />
      </div>
      <div>
        <label>Échéance</label>
        <input type="date" value={a.echeance_le ?? ''}
               onChange={(e) => set('echeance_le', e.target.value || null)} />
      </div>
      <div>
        <label>Total HT lu sur la facture</label>
        <input type="number" step="0.01" className="num" value={a.montant_ht ?? ''}
               onChange={(e) => set('montant_ht', e.target.value ? Number(e.target.value) : null)} />
        <p className="statut">
          Sert de contrôle : la somme des lignes saisies devra y correspondre.
        </p>
      </div>
      <div>
        <label>Payée le</label>
        <input type="date" value={a.paye_le ?? ''}
               onChange={(e) => set('paye_le', e.target.value || null)} />
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <button className="action" onClick={() => {
          if (!a.fournisseur?.trim()) return onErreur('Le fournisseur est obligatoire.');
          void enregistrerAchat(a).then(onEnregistre)
            .catch((e) => onErreur((e as Error).message));
        }}>Enregistrer</button>
      </div>

      {a.id && (
        <div style={{ gridColumn: 'span 2' }}>
          <PiecesJointes cible={{ achat_id: a.id }} presentation="liste"
                         accepte=".pdf,image/*" titre="La facture elle-même"
                         onErreur={onErreur}
            aide="Le scan ou la photo. Une facture saisie sans sa pièce oblige à
                  retourner au classeur dès qu’un montant est contesté — et en cas
                  de contrôle, c’est la pièce qu’on demande, pas la ligne de la base." />
        </div>
      )}
    </div>
  );
}

// --- Le rapprochement -------------------------------------------------------

function Lignes({ achat, appros, onErreur }: {
  achat: Achat; appros: ApproOuvert[]; onErreur: (m: string) => void;
}) {
  const [lignes, setLignes] = useState<AchatLigne[]>([]);
  const [charge, setCharge] = useState(false);

  const recharger = useCallback(async () => {
    try { setLignes(await listerLignesAchat(achat.id)); }
    catch (e) { onErreur((e as Error).message); }
    setCharge(true);
  }, [achat.id, onErreur]);

  useEffect(() => { void recharger(); }, [recharger]);
  if (!charge) return <p className="statut">Chargement…</p>;

  const totalLignes = lignes.reduce(
    (s, l) => s + Number(l.quantite) * Number(l.prix_unitaire_ht), 0);
  const annonce = Number(achat.montant_ht ?? 0);
  const ecart = annonce ? Math.round((totalLignes - annonce) * 100) / 100 : 0;

  async function patcher(id: string, patch: Partial<AchatLigne>) {
    try { await enregistrerLigneAchat({ id, ...patch }); void recharger(); }
    catch (e) { onErreur((e as Error).message); }
  }

  return (
    <>
      <p className="statut" style={{ marginBottom: 12 }}>
        Rattachez chaque ligne à ce qui était prévu sur un chantier. Une ligne sans
        rattachement n’entre dans le coût d’aucun chantier — ce n’est pas grave pour du
        stock, ça l’est pour du matériel posé.
      </p>

      {lignes.length === 0 ? (
        <div className="vide" style={{ padding: 20 }}>Aucune ligne saisie.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Désignation</th>
              <th className="num" style={{ width: 70 }}>Qté</th>
              <th className="num" style={{ width: 100 }}>PU HT</th>
              <th className="num" style={{ width: 100 }}>Total</th>
              <th style={{ width: 260 }}>Rapproché de</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id} style={!l.chantier_id ? { background: '#fdf7ee' } : undefined}>
                <td>
                  <input defaultValue={l.designation} style={{ padding: '3px 5px' }}
                         onBlur={(e) => e.target.value !== l.designation
                           && void patcher(l.id, { designation: e.target.value })} />
                </td>
                <td>
                  <input type="number" step="0.01" className="num" defaultValue={l.quantite}
                         style={{ padding: '3px 5px' }}
                         onBlur={(e) => void patcher(l.id, { quantite: Number(e.target.value) })} />
                </td>
                <td>
                  <input type="number" step="0.01" className="num"
                         defaultValue={l.prix_unitaire_ht} style={{ padding: '3px 5px' }}
                         onBlur={(e) => void patcher(l.id,
                           { prix_unitaire_ht: Number(e.target.value) })} />
                </td>
                <td className="num">
                  {eur(Number(l.quantite) * Number(l.prix_unitaire_ht))}
                </td>
                <td>
                  <select value={l.approvisionnement_id ?? ''}
                          style={{ padding: '3px 5px', fontSize: 12 }}
                          onChange={(e) => void rapprocher(l.id, e.target.value || null)
                            .then(recharger).catch((x) => onErreur((x as Error).message))}>
                    <option value="">Non rattaché — stock ou frais</option>
                    {appros.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.chantier?.numero ?? '?'} — {a.designation}
                        {a.livre_le ? ' (livré)' : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className="action discret" style={{ padding: '2px 7px' }}
                          onClick={() => void supprimerLigneAchat(l.id).then(recharger)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center',
                    flexWrap: 'wrap' }}>
        <button className="action discret"
                onClick={() => void enregistrerLigneAchat({
                  achat_id: achat.id, position: lignes.length,
                  designation: '', quantite: 1, prix_unitaire_ht: 0,
                }).then(recharger).catch((e) => onErreur((e as Error).message))}>
          Ajouter une ligne
        </button>
        <span className="statut">
          Somme des lignes {eur(totalLignes)}
          {annonce > 0 && ` · total annoncé ${eur(annonce)}`}
        </span>
        {annonce > 0 && Math.abs(ecart) > 0.02 && (
          <span className="jeton" data-r="retard">
            écart de {eur(Math.abs(ecart))} — une ligne manque ou un prix est faux
          </span>
        )}
      </div>
    </>
  );
}

// --- Écarts de prix ---------------------------------------------------------

function Ecarts({ onErreur }: { onErreur: (m: string) => void }) {
  const [ecarts, setEcarts] = useState<EcartAchat[]>([]);
  const [charge, setCharge] = useState(false);
  const [tic, setTic] = useState(0);

  useEffect(() => {
    ecartsAchat()
      .then(setEcarts)
      .catch((e) => onErreur((e as Error).message))
      .finally(() => setCharge(true));
  }, [onErreur, tic]);

  if (!charge) return <Squelette lignes={6} colonnes={5} />;

  const derives = ecarts.filter((e) => (e.ecart_pct ?? 0) > 3);

  return (
    <>
      <p className="statut" style={{ marginBottom: 12 }}>
        Ce que le catalogue annonce contre ce que le fournisseur facture réellement.
        L’écart porte sur le <strong>dernier prix payé</strong>, pas sur la moyenne :
        une référence achetée douze fois à 780 € puis deux fois à 845 € afficherait une
        moyenne rassurante, alors que c’est 845 € que vous paierez demain.
      </p>

      {ecarts.length === 0 ? (
        <div className="vide">
          Rien à comparer. Les écarts apparaissent quand des lignes de facture sont
          rattachées à une référence du catalogue.
        </div>
      ) : (
        <>
          {derives.length > 0 && (
            <div className="erreur">
              {derives.length} référence{derives.length > 1 ? 's' : ''} coûte
              {derives.length > 1 ? 'nt' : ''} plus cher que ce que dit le catalogue.
              Corrigez le prix d’achat, sinon chaque devis établi part avec une marge
              surestimée.
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Référence</th>
                <th>Désignation</th>
                <th className="num" style={{ width: 110 }}>Catalogue</th>
                <th className="num" style={{ width: 130 }}>Dernier facturé</th>
                <th className="num" style={{ width: 90 }}>Écart</th>
                <th style={{ width: 110 }}>Dernier achat</th>
                <th style={{ width: 130 }} className="sans-impression" />
              </tr>
            </thead>
            <tbody>
              {ecarts.map((e) => (
                <tr key={e.produit_id}
                    style={(e.ecart_pct ?? 0) > 3 ? { background: '#fdf3f2' } : undefined}>
                  <td className="ref">{e.reference}</td>
                  <td>{e.designation}</td>
                  <td className="num">
                    {e.prix_catalogue != null
                      ? eur(Number(e.prix_catalogue))
                      : <span className="statut">non renseigné</span>}
                  </td>
                  <td className="num">
                    {eur(Number(e.prix_facture_dernier))}
                    <div className="statut">
                      {/* La moyenne reste sous les yeux : un dernier prix isolé
                          peut être une erreur de saisie, et les voir côte à côte
                          permet de trancher. */}
                      moyenne {eur(Number(e.prix_facture_moyen))} sur {e.nombre_achats}
                    </div>
                  </td>
                  <td className="num" style={{
                    color: (e.ecart_pct ?? 0) > 3 ? 'var(--alerte)'
                      : (e.ecart_pct ?? 0) < -3 ? 'var(--vert)' : undefined,
                    fontWeight: 600,
                  }}>
                    {e.ecart_pct != null ? `${e.ecart_pct > 0 ? '+' : ''}${e.ecart_pct} %` : '—'}
                  </td>
                  <td className="num ref">
                    {new Date(e.dernier_achat).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="sans-impression">
                    {/* Constater une dérive sans pouvoir la corriger sur place
                        obligerait à retrouver la référence au catalogue — et on
                        ne le ferait pas. */}
                    {Math.abs(e.ecart_pct ?? 0) > 1 && (
                      <button className="action discret" style={{ padding: '2px 9px' }}
                              onClick={() => {
                                if (window.confirm(
                                  `Passer le prix d’achat de ${e.reference} à `
                                  + `${Number(e.prix_facture_dernier).toFixed(2)} € ?\n\n`
                                  + 'Les devis déjà établis ne bougent pas : ils portent '
                                  + 'leur propre prix, figé à leur création.')) {
                                  void alignerPrixCatalogue(e.produit_id,
                                    Number(e.prix_facture_dernier))
                                    .then(() => setTic((t) => t + 1))
                                    .catch((x) => onErreur((x as Error).message));
                                }
                              }}>
                        Aligner
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function Chiffre({ libelle, valeur, note, alerte }:
  { libelle: string; valeur: string | number; note?: string; alerte?: boolean }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--filet)',
      borderLeft: `3px solid ${alerte ? 'var(--alerte)' : 'var(--filet)'}`, padding: '12px 14px',
    }}>
      <div className="statut">{libelle}</div>
      <div className="num" style={{ fontSize: 23, fontWeight: 600, textAlign: 'left' }}>{valeur}</div>
      {note && <div className="statut">{note}</div>}
    </div>
  );
}


// --- Ticket de comptoir -----------------------------------------------------

/**
 * L'achat rapide, en trois champs.
 *
 * Depuis le SQL 29, un matériel rattaché à un chantier ne peut plus être saisi
 * en dépense : il compterait deux fois dans le coût réel. Interdire sans
 * offrir un geste aussi court aurait simplement fait disparaître ces achats
 * de la comptabilité analytique — l'inverse du but recherché.
 *
 * Ce qui sort est une facture d'achat ordinaire, à une ligne, rapprochable
 * comme les autres. Rien de spécial en base.
 */
function SaisieRapide({ chantiers, membres, onEnregistre, onErreur }: {
  chantiers: ChantierAvecTiers[];
  membres: Membre[];
  onEnregistre: () => void;
  onErreur: (m: string) => void;
}) {
  const [fournisseur, setFournisseur] = useState('');
  const [libelle, setLibelle] = useState('');
  const [montant, setMontant] = useState('');
  const [chantier, setChantier] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [numero, setNumero] = useState('');
  const [auNom, setAuNom] = useState(true);
  const [membre, setMembre] = useState('');
  const [travail, setTravail] = useState(false);

  async function creer() {
    if (!fournisseur.trim()) return onErreur('Le fournisseur est obligatoire.');
    if (!montant) return onErreur('Le montant est obligatoire.');
    setTravail(true);
    try {
      await saisieRapideAchat({
        fournisseur,
        libelle: libelle || 'Achat au comptoir',
        montant_ht: Number(montant),
        chantier_id: chantier || null,
        date_facture: date,
        numero: numero || null,
        tva_recuperable: auNom,
        membre_id: membre || null,
      });
      onEnregistre();
    } catch (e) { onErreur((e as Error).message); }
    setTravail(false);
  }

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
      <p className="statut" style={{ gridColumn: 'span 2', margin: 0 }}>
        Pour un ticket pris au comptoir. Il devient une facture d’achat à une ligne,
        rapprochable comme les autres. Le matériel d’un chantier passe par ici et non
        par les dépenses : sinon il compterait deux fois dans son coût réel.
      </p>

      <div>
        <label>Fournisseur</label>
        <input value={fournisseur} placeholder="Cedeo, Rexel…"
               onChange={(e) => setFournisseur(e.target.value)} />
      </div>
      <div>
        <label>Montant HT</label>
        <input type="number" step="0.01" className="num" value={montant}
               onChange={(e) => setMontant(e.target.value)} />
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <label>Ce qui a été acheté</label>
        <input value={libelle} placeholder="Goulottes, colliers, bac à condensats"
               onChange={(e) => setLibelle(e.target.value)} />
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <label>Chantier</label>
        <select value={chantier} onChange={(e) => setChantier(e.target.value)}>
          <option value="">Aucun — stock ou atelier</option>
          {chantiers.map((c) => (
            <option key={c.id} value={c.id}>{c.numero} — {c.libelle}</option>
          ))}
        </select>
      </div>
      <div>
        <label>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div>
        <label>Numéro du ticket</label>
        <input value={numero} placeholder="facultatif"
               onChange={(e) => setNumero(e.target.value)} />
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <label style={{ color: 'var(--encre)' }}>
          <input type="checkbox" style={{ width: 'auto', marginRight: 8 }}
                 checked={auNom} onChange={(e) => setAuNom(e.target.checked)} />
          Le ticket est au nom de l’entreprise
        </label>
        <p className="statut">
          Décochez si c’est un ticket au nom d’un salarié : la TVA ne sera pas
          récupérable, et Batinium le retiendra.
        </p>
      </div>
      {!auNom && (
        <div style={{ gridColumn: 'span 2' }}>
          <label>Engagé par</label>
          <select value={membre} onChange={(e) => setMembre(e.target.value)}>
            <option value="">—</option>
            {membres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select>
        </div>
      )}
      <div style={{ gridColumn: 'span 2' }}>
        <button className="action" disabled={travail} onClick={() => void creer()}>
          {travail ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
