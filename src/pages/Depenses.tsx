import { useCallback, useEffect, useState } from 'react';
import { eur } from '../lib/calcul';
import { aller } from '../lib/router';
import {
  coutMensuel, enregistrerChargeFixe, enregistrerDepense, listerChantiers, listerChargesFixes,
  listerDepenses, listerMembres, supprimerChargeFixe, supprimerDepense,
  type ChantierAvecTiers, type DepenseDetaillee,
} from '../lib/db';
import type {
  CategorieCharge, CategorieDepense, ChargeFixe, Depense, Membre, Periodicite,
} from '../lib/types';
import Modale from '../components/Modale';
import Menu from '../components/Menu';
import Squelette from '../components/Squelette';

const CATEGORIES_CHARGE: Record<CategorieCharge, string> = {
  loyer: 'Loyer et locaux', vehicule: 'Véhicules', assurance: 'Assurances',
  abonnement: 'Abonnements', telephonie: 'Téléphonie', comptabilite: 'Comptabilité',
  banque: 'Banque', cotisation: 'Cotisations', outillage: 'Location d’outillage',
  certification: 'Certifications et agréments', autre: 'Autre',
};

const CATEGORIES_DEPENSE: Record<CategorieDepense, string> = {
  materiel: 'Matériel', fourniture: 'Fournitures', outillage: 'Outillage',
  carburant: 'Carburant', peage: 'Péages', repas: 'Repas', vehicule: 'Véhicule',
  formation: 'Formation', certification: 'Certification et agrément', autre: 'Autre',
};

const PERIODICITES: Record<Periodicite, string> = {
  mensuelle: 'Tous les mois', trimestrielle: 'Tous les trimestres',
  semestrielle: 'Tous les six mois', annuelle: 'Tous les ans',
  personnalisee: 'Tous les N mois, à préciser',
};

/** Ce qu'affiche le tableau : « tous les 24 mois » se lit mieux que « personnalisée ». */
function libellePeriodicite(c: Pick<ChargeFixe, 'periodicite' | 'mois_personnalises'>): string {
  if (c.periodicite !== 'personnalisee') return PERIODICITES[c.periodicite];
  return c.mois_personnalises ? `Tous les ${c.mois_personnalises} mois` : 'Périodicité à préciser';
}

function FlecheGauche() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         style={{ flex: '0 0 auto' }}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

/**
 * Ce que l'entreprise paie, en dehors des chantiers.
 *
 * Deux natures très différentes, d'où les deux onglets. Les charges fixes
 * reviennent qu'on travaille ou non : c'est le socle qu'il faut couvrir avant
 * de parler de marge. Les dépenses sont ponctuelles et, quand elles sont
 * rattachées à un chantier, elles entrent dans son coût réel.
 *
 * Le bouton de création est en tête de page et non en pied de tableau : c'est
 * la première chose qu'on cherche en arrivant, et la liste peut être longue.
 * Il ouvre le formulaire du bon onglet, d'où l'état d'édition tenu ici plutôt
 * que dans chaque sous-écran.
 */
export default function PageDepenses() {
  const [onglet, setOnglet] = useState<'charges' | 'depenses'>('charges');
  const [erreur, setErreur] = useState<string | null>(null);
  const [editionCharge, setEditionCharge] = useState<Partial<ChargeFixe> | null>(null);
  const [editionDepense, setEditionDepense] = useState<Partial<Depense> | null>(null);

  const nouvelleCharge = () => setEditionCharge({
    categorie: 'abonnement', periodicite: 'mensuelle', mois_personnalises: null,
    taux_tva: 20, actif: true, debut_le: new Date().toISOString().slice(0, 10),
  });

  const nouvelleDepense = () => setEditionDepense({
    categorie: 'materiel', taux_tva: 20, facture_au_nom_entreprise: true,
    date_achat: new Date().toISOString().slice(0, 10),
  });

  return (
    <>
      <div className="entete">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="action discret" onClick={() => aller('/analytique')}
                  title="Revenir à la Rentabilité"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FlecheGauche />
            Rentabilité
          </button>
          <h1>Dépenses</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onglet === 'charges' ? (
            <button className="action" onClick={nouvelleCharge}>Nouvelle charge fixe</button>
          ) : (
            <>
              <button className="action discret" onClick={nouvelleCharge}>
                Nouvelle charge fixe
              </button>
              <button className="action" onClick={nouvelleDepense}>Nouvelle dépense</button>
            </>
          )}
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="onglets">
        <button aria-current={onglet === 'charges'} onClick={() => setOnglet('charges')}>
          Charges fixes
        </button>
        <button aria-current={onglet === 'depenses'} onClick={() => setOnglet('depenses')}>
          Achats et frais
        </button>
      </div>

      {onglet === 'charges'
        ? <Charges onErreur={setErreur} edition={editionCharge} setEdition={setEditionCharge} />
        : <Achats onErreur={setErreur} edition={editionDepense} setEdition={setEditionDepense} />}
    </>
  );
}

// --- Charges fixes ----------------------------------------------------------

function Charges({ onErreur, edition, setEdition }: {
  onErreur: (m: string) => void;
  edition: Partial<ChargeFixe> | null;
  setEdition: (c: Partial<ChargeFixe> | null) => void;
}) {
  const [charges, setCharges] = useState<ChargeFixe[]>([]);
  const [charge, setCharge] = useState(false);

  const recharger = useCallback(async () => {
    try { setCharges(await listerChargesFixes()); }
    catch (e) { onErreur((e as Error).message); }
    setCharge(true);
  }, [onErreur]);

  useEffect(() => { void recharger(); }, [recharger]);
  if (!charge) return <Squelette lignes={7} colonnes={5} />;

  const mensuel = charges.reduce(
    (s, c) => s + coutMensuel(c.montant_ht, c.periodicite, c.mois_personnalises), 0);
  const annuel = mensuel * 12;
  const journalier = mensuel / 21;   // 21 jours ouvrés en moyenne

  const parCategorie = new Map<CategorieCharge, number>();
  for (const c of charges) {
    parCategorie.set(c.categorie, (parCategorie.get(c.categorie) ?? 0)
      + coutMensuel(c.montant_ht, c.periodicite, c.mois_personnalises));
  }
  const classees = [...parCategorie.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div style={{ display: 'grid', gap: 12, marginBottom: 18,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Chiffre libelle="Par mois, hors taxes" valeur={eur(mensuel)} />
        <Chiffre libelle="Par an" valeur={eur(annuel)} />
        <Chiffre libelle="Par jour ouvré" valeur={eur(journalier)}
                 note="À couvrir avant toute marge" />
        <Chiffre libelle="Lignes actives" valeur={charges.length} />
      </div>

      <div className="panneau" style={{ display: 'block' }}>
        <h3 style={{ marginBottom: 8 }}>Répartition mensuelle</h3>
        {classees.map(([cat, montant]) => (
          <div key={cat} style={{ marginBottom: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{CATEGORIES_CHARGE[cat]}</span>
              <span className="num">
                {eur(montant)}
                <span className="statut"> · {((montant / mensuel) * 100).toFixed(0)} %</span>
              </span>
            </div>
            <div className="jauge"><i style={{ width: `${(montant / mensuel) * 100}%` }} /></div>
          </div>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <th>Libellé</th><th style={{ width: 190 }}>Catégorie</th>
            <th style={{ width: 170 }}>Fournisseur</th>
            <th style={{ width: 160 }}>Périodicité</th>
            <th className="num" style={{ width: 120 }}>Montant HT</th>
            <th className="num" style={{ width: 120 }}>Par mois</th>
            <th style={{ width: 50 }} className="sans-impression" />
          </tr>
        </thead>
        <tbody>
          {charges.map((c) => (
            <tr key={c.id}>
              <td>{c.libelle}{c.notes && <div className="fiche">{c.notes}</div>}</td>
              <td className="statut">{CATEGORIES_CHARGE[c.categorie]}</td>
              <td className="ref">{c.fournisseur ?? '—'}</td>
              <td className="statut">{libellePeriodicite(c)}</td>
              <td className="num">{eur(Number(c.montant_ht))}</td>
              <td className="num">
                {eur(coutMensuel(c.montant_ht, c.periodicite, c.mois_personnalises))}
              </td>
              <td className="sans-impression">
                <Menu actions={[
                  { libelle: 'Modifier', faire: () => setEdition(c) },
                  { libelle: 'Supprimer', danger: true, faire: () => {
                      if (window.confirm(`Supprimer « ${c.libelle} » ?`)) {
                        void supprimerChargeFixe(c.id).then(recharger);
                      }
                    } },
                ]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {charges.length === 0 && (
        <div className="vide">
          Aucune charge fixe. Tant qu’elles ne sont pas saisies, la marge affichée
          en Rentabilité reste une marge brute.
        </div>
      )}

      {edition && (
        <Modale titre={edition.id ? `Modifier ${edition.libelle}` : 'Nouvelle charge fixe'}
                onFermer={() => setEdition(null)}>
          <FormulaireCharge key={edition.id ?? 'neuf'} charge={edition} onErreur={onErreur}
                            onEnregistre={() => { setEdition(null); void recharger(); }} />
        </Modale>
      )}
    </>
  );
}

function FormulaireCharge({ charge, onEnregistre, onErreur }: {
  charge: Partial<ChargeFixe>; onEnregistre: () => void; onErreur: (m: string) => void;
}) {
  const [c, setC] = useState<Partial<ChargeFixe>>(charge);
  const set = (k: keyof ChargeFixe, v: unknown) => setC((p) => ({ ...p, [k]: v }));
  const perso = c.periodicite === 'personnalisee';

  /**
   * Changer de périodicité efface le nombre de mois quand il n'a plus de sens.
   * La base l'exige — la contrainte refuse un nombre de mois sur une charge
   * mensuelle — et c'est aussi ce qu'on veut : une valeur oubliée qui
   * ressurgirait deux mois plus tard fausserait le calcul sans prévenir.
   */
  function changerPeriodicite(v: Periodicite) {
    setC((p) => ({
      ...p,
      periodicite: v,
      mois_personnalises: v === 'personnalisee' ? (p.mois_personnalises ?? 24) : null,
    }));
  }

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
      <div style={{ gridColumn: 'span 2' }}>
        <label>Libellé</label>
        <input value={c.libelle ?? ''} placeholder="Location du fourgon"
               onChange={(e) => set('libelle', e.target.value)} />
      </div>
      <div>
        <label>Catégorie</label>
        <select value={c.categorie} onChange={(e) => set('categorie', e.target.value)}>
          {Object.entries(CATEGORIES_CHARGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {c.categorie === 'certification' && (
          <p className="statut">
            RGE, Qualibat, QualiPAC, attestation de capacité fluides : ce qui se
            renouvelle à échéance et qu’on ne peut pas laisser expirer.
          </p>
        )}
      </div>
      <div>
        <label>Fournisseur</label>
        <input value={c.fournisseur ?? ''} onChange={(e) => set('fournisseur', e.target.value)} />
      </div>
      <div>
        <label>Montant HT</label>
        <input type="number" step="0.01" className="num" value={c.montant_ht ?? ''}
               onChange={(e) => set('montant_ht', Number(e.target.value))} />
      </div>
      <div>
        <label>Périodicité</label>
        <select value={c.periodicite ?? 'mensuelle'}
                onChange={(e) => changerPeriodicite(e.target.value as Periodicite)}>
          {Object.entries(PERIODICITES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {perso && (
        <div style={{ gridColumn: 'span 2' }}>
          <label>Tous les combien, en mois</label>
          <input type="number" min={1} max={240} step={1} className="num"
                 style={{ width: 140 }}
                 value={c.mois_personnalises ?? ''}
                 onChange={(e) => set('mois_personnalises',
                   e.target.value ? Number(e.target.value) : null)} />
          <p className="statut">
            Un contrôle réglementaire tous les deux ans : 24. Une requalification
            tous les quatre ans : 48. Le coût sera ramené au mois pour être
            comparable au reste.
          </p>
        </div>
      )}
      {c.montant_ht != null && c.periodicite && c.periodicite !== 'mensuelle'
        && (!perso || c.mois_personnalises) && (
        <p className="statut" style={{ gridColumn: 'span 2' }}>
          Soit {eur(coutMensuel(Number(c.montant_ht), c.periodicite,
                                c.mois_personnalises ?? null))} par mois.
        </p>
      )}
      <div>
        <label>Taux de TVA</label>
        <input type="number" step="0.1" className="num" value={c.taux_tva ?? 20}
               onChange={(e) => set('taux_tva', Number(e.target.value))} />
      </div>
      <div>
        <label>Depuis le</label>
        <input type="date" value={c.debut_le ?? ''} onChange={(e) => set('debut_le', e.target.value)} />
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <label>Notes</label>
        <textarea rows={2} value={c.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <button className="action" onClick={() => {
          if (!c.libelle?.trim()) return onErreur('Le libellé est obligatoire.');
          if (c.montant_ht == null) return onErreur('Le montant est obligatoire.');
          if (perso && !(c.mois_personnalises && c.mois_personnalises >= 1)) {
            return onErreur('Indiquez le nombre de mois entre deux échéances.');
          }
          void enregistrerChargeFixe(c).then(onEnregistre)
            .catch((e) => onErreur((e as Error).message));
        }}>Enregistrer</button>
      </div>
    </div>
  );
}

// --- Achats et frais --------------------------------------------------------

function Achats({ onErreur, edition, setEdition }: {
  onErreur: (m: string) => void;
  edition: Partial<Depense> | null;
  setEdition: (d: Partial<Depense> | null) => void;
}) {
  const [depenses, setDepenses] = useState<DepenseDetaillee[]>([]);
  const [chantiers, setChantiers] = useState<ChantierAvecTiers[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [charge, setCharge] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [parChantier, setParChantier] = useState('');

  const recharger = useCallback(async () => {
    try {
      const [d, c, m] = await Promise.all([listerDepenses(), listerChantiers(), listerMembres()]);
      setDepenses(d); setChantiers(c); setMembres(m);
    } catch (e) { onErreur((e as Error).message); }
    setCharge(true);
  }, [onErreur]);

  useEffect(() => { void recharger(); }, [recharger]);
  if (!charge) return <Squelette chiffres={3} lignes={7} colonnes={6} />;

  const q = recherche.trim().toLowerCase();
  const visibles = depenses
    .filter((d) => !parChantier ||
      (parChantier === 'aucun' ? !d.chantier_id : d.chantier_id === parChantier))
    .filter((d) => !q ||
      `${d.libelle} ${d.fournisseur ?? ''} ${d.numero_piece ?? ''}`.toLowerCase().includes(q));

  const total = visibles.reduce((s, d) => s + Number(d.montant_ht), 0);
  const surChantier = visibles.filter((d) => d.chantier_id)
    .reduce((s, d) => s + Number(d.montant_ht), 0);
  const tvaPerdue = visibles
    .filter((d) => !d.facture_au_nom_entreprise)
    .reduce((s, d) => s + Number(d.montant_ht) * Number(d.taux_tva) / 100, 0);

  return (
    <>
      <div style={{ display: 'grid', gap: 12, marginBottom: 16,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Chiffre libelle="Total hors taxes" valeur={eur(total)} />
        <Chiffre libelle="Rattaché à un chantier" valeur={eur(surChantier)}
                 note={`${((surChantier / (total || 1)) * 100).toFixed(0)} % du total`} />
        <Chiffre libelle="TVA non récupérable" valeur={eur(tvaPerdue)} alerte={tvaPerdue > 0}
                 note="Facture au nom du salarié" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input placeholder="Libellé, fournisseur, numéro de pièce" value={recherche}
               onChange={(e) => setRecherche(e.target.value)} style={{ width: 300 }} />
        <select value={parChantier} onChange={(e) => setParChantier(e.target.value)}
                style={{ width: 260 }}>
          <option value="">Tous les chantiers</option>
          <option value="aucun">Hors chantier, frais généraux</option>
          {chantiers.map((c) => (
            <option key={c.id} value={c.id}>{c.numero} — {c.libelle}</option>
          ))}
        </select>
      </div>

      {tvaPerdue > 0 && (
        <p className="statut" style={{ marginBottom: 12, color: 'var(--alerte)' }}>
          Une facture au nom d’un salarié ne permet pas de récupérer la TVA. Demandez
          systématiquement une facture au nom de l’entreprise chez les fournisseurs habituels.
        </p>
      )}

      <table>
        <thead>
          <tr>
            <th style={{ width: 96 }}>Date</th>
            <th>Libellé</th>
            <th style={{ width: 170 }}>Catégorie</th>
            <th style={{ width: 150 }}>Fournisseur</th>
            <th style={{ width: 190 }}>Chantier</th>
            <th className="num" style={{ width: 110 }}>HT</th>
            <th style={{ width: 50 }} className="sans-impression" />
          </tr>
        </thead>
        <tbody>
          {visibles.map((d) => (
            <tr key={d.id} style={!d.facture_au_nom_entreprise ? { background: '#fdf7ee' } : undefined}>
              <td className="num ref">{new Date(d.date_achat).toLocaleDateString('fr-FR')}</td>
              <td>
                {d.libelle}
                {d.numero_piece && <div className="ref">pièce {d.numero_piece}</div>}
                {!d.facture_au_nom_entreprise && (
                  <span className="jeton" data-r="retard">TVA non récupérable</span>
                )}
              </td>
              <td className="statut">{CATEGORIES_DEPENSE[d.categorie] ?? d.categorie}</td>
              <td className="ref">{d.fournisseur ?? '—'}</td>
              <td className="ref">
                {d.chantier
                  ? <a href={`#/chantiers/${d.chantier.id}`}>{d.chantier.numero}</a>
                  : <span className="statut">frais généraux</span>}
              </td>
              <td className="num">
                {eur(Number(d.montant_ht))}
                {/* Même règle qu'ailleurs : une date de règlement à venir ne
                    solde rien, elle annonce un virement programmé. */}
                {!(d.paye_le && d.paye_le <= new Date().toISOString().slice(0, 10)) && (
                  <div>
                    <span className="jeton" data-r={d.paye_le ? undefined : 'retard'}>
                      {d.paye_le ? 'programmé' : 'à payer'}
                    </span>
                  </div>
                )}
              </td>
              <td className="sans-impression">
                <Menu actions={[
                  { libelle: 'Modifier', faire: () => setEdition(d) },
                  { libelle: d.paye_le ? 'Marquer non payée' : 'Marquer payée',
                    faire: () => void enregistrerDepense({
                      id: d.id,
                      paye_le: d.paye_le ? null : new Date().toISOString().slice(0, 10),
                    }).then(recharger) },
                  { libelle: 'Supprimer', danger: true, faire: () => {
                      if (window.confirm(`Supprimer « ${d.libelle} » ?`)) {
                        void supprimerDepense(d.id).then(recharger);
                      }
                    } },
                ]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="panneau" style={{ display: 'block', marginTop: 14,
                                        borderLeft: '3px solid var(--bleu)' }}>
        <h3 style={{ marginBottom: 6 }}>La sous-traitance ne se saisit plus ici</h3>
        <p className="statut">
          Ce que coûte un sous-traitant est déjà écrit ailleurs : dans le prix d’achat
          de la ligne de devis qui porte sa prestation, et, pour ce qui se règle hors
          devis, dans les paiements de l’équipe. Le saisir une troisième fois en dépense
          revenait à compter le même euro deux fois dans le coût du chantier, sans que
          rien ne le signale. Les anciennes lignes ont été reversées en « Autre » et
          portent la mention de leur ancienne catégorie.
        </p>
      </div>

      {edition && (
        <Modale titre={edition.id ? 'Modifier la dépense' : 'Nouvelle dépense'}
                onFermer={() => setEdition(null)}>
          <FormulaireDepense key={edition.id ?? 'neuf'} depense={edition}
                             chantiers={chantiers} membres={membres} onErreur={onErreur}
                             onEnregistre={() => { setEdition(null); void recharger(); }} />
        </Modale>
      )}
    </>
  );
}

function FormulaireDepense({ depense, chantiers, membres, onEnregistre, onErreur }: {
  depense: Partial<Depense>;
  chantiers: ChantierAvecTiers[];
  membres: Membre[];
  onEnregistre: () => void;
  onErreur: (m: string) => void;
}) {
  const [d, setD] = useState<Partial<Depense>>(depense);
  const set = (k: keyof Depense, v: unknown) => setD((p) => ({ ...p, [k]: v }));

  // Le SQL 29 interdit cette combinaison. L'écran le dit avant que la base ne
  // refuse : un message d'erreur après coup n'apprend rien sur ce qu'il fallait
  // faire à la place.
  const materielDeChantier = d.categorie === 'materiel' || d.categorie === 'fourniture';

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
      <div style={{ gridColumn: 'span 2' }}>
        <label>Libellé</label>
        <input value={d.libelle ?? ''} placeholder="Liaisons frigorifiques et goulottes"
               onChange={(e) => set('libelle', e.target.value)} />
      </div>
      <div>
        <label>Catégorie</label>
        <select value={d.categorie}
                onChange={(e) => {
                  const c = e.target.value as Depense['categorie'];
                  setD((p) => ({
                    ...p, categorie: c,
                    // On détache plutôt que de laisser la base refuser
                    // l'enregistrement sur un choix qu'on vient de faire.
                    chantier_id: (c === 'materiel' || c === 'fourniture') ? null : p.chantier_id,
                  }));
                }}>
          {Object.entries(CATEGORIES_DEPENSE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label>Fournisseur</label>
        <input value={d.fournisseur ?? ''} onChange={(e) => set('fournisseur', e.target.value)} />
      </div>
      <div>
        <label>Montant HT</label>
        <input type="number" step="0.01" className="num" value={d.montant_ht ?? ''}
               onChange={(e) => set('montant_ht', Number(e.target.value))} />
      </div>
      <div>
        <label>Taux de TVA</label>
        <input type="number" step="0.1" className="num" value={d.taux_tva ?? 20}
               onChange={(e) => set('taux_tva', Number(e.target.value))} />
      </div>
      <div>
        <label>Date d’achat</label>
        <input type="date" value={d.date_achat ?? ''} onChange={(e) => set('date_achat', e.target.value)} />
      </div>
      <div>
        <label>Numéro de pièce</label>
        <input value={d.numero_piece ?? ''} placeholder="FA-2026-88214"
               onChange={(e) => set('numero_piece', e.target.value)} />
      </div>
      <div>
        <label>Chantier</label>
        <select value={d.chantier_id ?? ''}
                disabled={materielDeChantier}
                onChange={(e) => set('chantier_id', e.target.value || null)}>
          <option value="">Frais généraux, sans chantier</option>
          {chantiers.map((c) => <option key={c.id} value={c.id}>{c.numero} — {c.libelle}</option>)}
        </select>
        {materielDeChantier ? (
          <p className="statut" style={{ color: '#b8860b' }}>
            Du matériel rattaché à un chantier passe par <a href="#/achats">Achats</a>,
            où il se rapproche de ce qui était prévu. Saisi ici <em>et</em> là-bas, il
            compterait deux fois dans le coût du chantier. Le « ticket de comptoir »
            d’Achats prend trois champs.
          </p>
        ) : (
          <p className="statut">
            Rattachée à un chantier, la dépense entrera dans son coût réel.
          </p>
        )}
      </div>
      <div>
        <label>Engagée par</label>
        <select value={d.membre_id ?? ''} onChange={(e) => set('membre_id', e.target.value || null)}>
          <option value="">—</option>
          {membres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
        </select>
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <label style={{ color: 'var(--encre)' }}>
          <input type="checkbox" style={{ width: 'auto', marginRight: 8 }}
                 checked={d.facture_au_nom_entreprise ?? true}
                 onChange={(e) => set('facture_au_nom_entreprise', e.target.checked)} />
          La facture est au nom de l’entreprise
        </label>
        <p className="statut">
          Décochez si c’est un ticket au nom d’un salarié : la TVA ne sera pas récupérable,
          et l’application le signalera.
        </p>
      </div>
      <div>
        <label>Payée le</label>
        <input type="date" value={d.paye_le ?? ''}
               onChange={(e) => set('paye_le', e.target.value || null)} />
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <button className="action" onClick={() => {
          if (!d.libelle?.trim()) return onErreur('Le libellé est obligatoire.');
          if (d.montant_ht == null) return onErreur('Le montant est obligatoire.');
          void enregistrerDepense(d).then(onEnregistre)
            .catch((e) => onErreur((e as Error).message));
        }}>Enregistrer</button>
      </div>
    </div>
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
