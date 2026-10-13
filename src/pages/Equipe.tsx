import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { eur } from '../lib/calcul';
import { estDirection } from '../lib/session';
import {
  chargerParametres, enregistrerMembre, enregistrerPaiementEquipe, enregistrerTiers, coutEmployeur, enregistrerRemuneration, etatDocument,
  LIBELLES_DOCUMENT, listerChantiers, listerDocumentsTiers, listerMembres, listerPaie,
  listerRemunerations, listerTiers, remunerationCourante, supprimerPaiementEquipe,
  supprimerRemuneration, tauxHoraire,
  type ChantierAvecTiers, type PaiementDetaille,
} from '../lib/db';
import type {
  Document, Membre, PaiementEquipe, Remuneration, Role, Tiers, TypeDocument,
} from '../lib/types';
import PiecesJointes from '../components/PiecesJointes';
import Menu from '../components/Menu';
import Modale from '../components/Modale';
import Bulle from '../components/Bulle';
import ChampAdresse from '../components/ChampAdresse';
import ChampEntreprise from '../components/ChampEntreprise';
import { formaterSiret } from '../lib/entreprises';

/** Ce qu'on range dans le dossier d'un salarié, dans l'ordre où on le cherche. */
const PIECES_SALARIE: TypeDocument[] = [
  'contrat', 'avenant', 'attestation_aptitude_fluides', 'permis', 'visite_medicale',
  'diplome', 'bulletin', 'rib', 'autre',
];

const LIBELLE_ROLE: Record<Role, string> = {
  direction: 'Direction', chef_chantier: 'Chef de chantier',
  technicien: 'Technicien', sous_traitant: 'Sous-traitant',
};

export default function PageEquipe() {
  const [onglet, setOnglet] = useState<'salaries' | 'soustraitants' | 'paie'>('salaries');
  const [erreur, setErreur] = useState<string | null>(null);
  // La paie relève de l'employeur, pas du chantier : ni un technicien ni un
  // chef de chantier n'y écrit. L'onglet ne s'affiche donc pas du tout plutôt
  // que de s'ouvrir sur un bouton qui refusera d'enregistrer. Chaque salarié
  // retrouve la sienne sur sa propre fiche.
  const direction = estDirection();

  return (
    <>
      <div className="entete"><h1>Équipe</h1></div>
      {erreur && <div className="erreur">{erreur}</div>}

      <div className="onglets">
        <button aria-current={onglet === 'salaries'} onClick={() => setOnglet('salaries')}>
          Salariés
        </button>
        <button aria-current={onglet === 'soustraitants'} onClick={() => setOnglet('soustraitants')}>
          Sous-traitants
        </button>
        {direction && (
          <button aria-current={onglet === 'paie'} onClick={() => setOnglet('paie')}>
            Paie et règlements
          </button>
        )}
      </div>

      {onglet === 'salaries' ? <Salaries onErreur={setErreur} />
        : onglet === 'soustraitants' ? <SousTraitants onErreur={setErreur} />
        : direction ? <Paie onErreur={setErreur} />
        : <Salaries onErreur={setErreur} />}
    </>
  );
}

// --- Salariés ---------------------------------------------------------------

function Salaries({ onErreur }: { onErreur: (m: string) => void }) {
  const [membres, setMembres] = useState<Membre[]>([]);
  const [remunerations, setRemunerations] = useState<Remuneration[]>([]);
  const [coefficient, setCoefficient] = useState(1.42);
  const [edition, setEdition] = useState<Partial<Membre> | null>(null);
  const [pieces, setPieces] = useState<Membre | null>(null);
  const [salaireDe, setSalaireDe] = useState<Membre | null>(null);
  const direction = estDirection();

  const recharger = useCallback(async () => {
    try {
      const [m, r, p] = await Promise.all([
        listerMembres(),
        listerRemunerations().catch(() => []),
        chargerParametres().catch(() => null),
      ]);
      setMembres(m);
      setRemunerations(r);
      if (p?.coefficient_charges) setCoefficient(Number(p.coefficient_charges));
    } catch (e) { onErreur((e as Error).message); }
  }, [onErreur]);

  useEffect(() => { void recharger(); }, [recharger]);

  const aujourdhui = new Date().toISOString().slice(0, 10);
  const dans60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  return (
    <>
      <p className="statut" style={{ marginBottom: 12 }}>
        Un salarié peut être créé ici avant de s’inscrire : sa fiche existe, il apparaît
        au planning, et son compte s’y rattachera tout seul quand il rejoindra l’entreprise
        avec le code d’invitation.
      </p>

      {membres.length === 0 ? (
        <div className="vide">Aucun salarié.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nom</th><th style={{ width: 140 }}>Rôle</th>
              {direction && <th className="num" style={{ width: 120 }}>Brut mensuel</th>}
              {direction && <th className="num" style={{ width: 140 }}>Coût employeur</th>}
              <th style={{ width: 190 }}>Attestation fluides</th>
              <th style={{ width: 110 }}>Compte</th>
              <th style={{ width: 80 }}>Actif</th>
              <th style={{ width: 130 }} className="sans-impression" />
            </tr>
          </thead>
          <tbody>
            {membres.map((m) => {
              const exp = m.aptitude_fluides_expire_le;
              const etat = !exp ? null : exp <= aujourdhui ? 'retard' : exp <= dans60 ? 'bientot' : 'ok';
              return (
                <tr key={m.id} className="cliquable" onClick={() => aller(`/equipe/${m.id}`)}
                    style={{ opacity: m.actif ? 1 : 0.5 }}>
                  <td><strong>{m.nom}</strong></td>
                  <td className="statut">{LIBELLE_ROLE[m.role]}</td>
                  {direction && (() => {
                    const r = remunerationCourante(remunerations, m.id);
                    const c = r ? coutEmployeur(r, coefficient) : null;
                    return (
                      <>
                        <td className="num">
                          {r ? eur(Number(r.brut_mensuel)) : <span className="statut">—</span>}
                          {r && <div className="statut">{eur(tauxHoraire(r))} / h</div>}
                        </td>
                        <td className="num">
                          {c ? eur(c.montant) : <span className="statut">—</span>}
                          {c?.estime && <div className="statut">estimé ×{coefficient}</div>}
                        </td>
                      </>
                    );
                  })()}
                  <td className="ref">
                    {m.aptitude_fluides_num ?? '—'}
                    {exp && (
                      <div style={{
                        color: etat === 'retard' ? 'var(--alerte)'
                          : etat === 'bientot' ? '#b8860b' : 'var(--vert)',
                      }}>
                        {etat === 'retard' ? 'expirée le ' : 'jusqu’au '}
                        {new Date(exp).toLocaleDateString('fr-FR')}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="jeton" data-r={m.user_id ? 'salarie' : undefined}>
                      {m.user_id ? 'rattaché' : 'sans compte'}
                    </span>
                  </td>
                  <td className="statut">{m.actif ? 'oui' : 'non'}</td>
                  <td className="sans-impression" onClick={(e) => e.stopPropagation()}>
                    <button className="action discret" onClick={() => setEdition(m)}>Modifier</button>{' '}
                    <Menu actions={[
                      { libelle: 'Voir la fiche', faire: () => aller(`/equipe/${m.id}`) },
                      { libelle: 'Modifier', faire: () => setEdition(m) },
                      { libelle: 'Pièces jointes', faire: () => setPieces(m) },
                      ...(direction
                        ? [{ libelle: 'Rémunération', faire: () => setSalaireDe(m) }]
                        : []),
                      { libelle: m.actif ? 'Désactiver' : 'Réactiver', danger: m.actif,
                        faire: () => void enregistrerMembre({ id: m.id, actif: !m.actif })
                          .then(recharger).catch((e) => onErreur((e as Error).message)) },
                    ]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <button className="action" style={{ marginTop: 12 }}
              onClick={() => setEdition({ nom: '', role: 'technicien', actif: true })}>
        Nouveau salarié
      </button>

      {edition && (
        <Modale titre={edition.id ? `Modifier ${edition.nom}` : 'Nouveau salarié'}
                onFermer={() => setEdition(null)}>
          <FormulaireMembre membre={edition} onErreur={onErreur}
                            onEnregistre={() => { setEdition(null); void recharger(); }} />
        </Modale>
      )}

      {direction && membres.length > 0 && (
        <p className="statut" style={{ marginTop: 10 }}>
          Masse salariale mensuelle estimée{' '}
          <strong>{eur(membres.filter((m) => m.actif).reduce((s, m) => {
            const r = remunerationCourante(remunerations, m.id);
            return s + (r ? coutEmployeur(r, coefficient).montant : 0);
          }, 0))}</strong>, charges comprises. Ce chiffre sert au prévisionnel :
          Batinium ne calcule pas la paie, il ne produit ni bulletin ni déclaration.
        </p>
      )}

      {salaireDe && (
        <Modale titre={`Rémunération de ${salaireDe.nom}`} taille="large"
                onFermer={() => setSalaireDe(null)}>
          <Remunerations membre={salaireDe} coefficient={coefficient}
                         liste={remunerations.filter((r) => r.membre_id === salaireDe.id)}
                         onErreur={onErreur} onChange={recharger} />
        </Modale>
      )}

      {pieces && (
        <Modale titre={`Pièces de ${pieces.nom}`} taille="large"
                onFermer={() => setPieces(null)}>
          <PiecesJointes cible={{ membre_id: pieces.id }} presentation="bibliotheque"
                         types={PIECES_SALARIE} onErreur={onErreur}
            aide="Contrat, avenants, attestation d’aptitude fluides, permis, visite médicale.
                  Ce qui porte une échéance remonte dans la cloche. Ces pièces ne sont
                  visibles que de la direction et des chefs de chantier." />
        </Modale>
      )}
    </>
  );
}

function FormulaireMembre({ membre, onEnregistre, onErreur }: {
  membre: Partial<Membre>; onEnregistre: () => void; onErreur: (m: string) => void;
}) {
  const [m, setM] = useState<Partial<Membre>>(membre);
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
      <div>
        <label>Nom</label>
        <input value={m.nom ?? ''} onChange={(e) => setM((x) => ({ ...x, nom: e.target.value }))} />
      </div>
      <div>
        <label>Rôle</label>
        <select value={m.role} onChange={(e) => setM((x) => ({ ...x, role: e.target.value as Role }))}>
          {Object.entries(LIBELLE_ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label>N° d’attestation d’aptitude fluides</label>
        <input value={m.aptitude_fluides_num ?? ''}
               onChange={(e) => setM((x) => ({ ...x, aptitude_fluides_num: e.target.value }))} />
      </div>
      <div>
        <label>Valable jusqu’au</label>
        <input type="date" value={m.aptitude_fluides_expire_le ?? ''}
               onChange={(e) => setM((x) => ({
                 ...x, aptitude_fluides_expire_le: e.target.value || null }))} />
      </div>
      <p className="statut" style={{ gridColumn: 'span 2' }}>
        Manipuler des fluides frigorigènes sans attestation valide est une infraction pénale.
        L’application signalera l’échéance soixante jours avant.
      </p>
      <div style={{ gridColumn: 'span 2' }}>
        <button className="action" onClick={() => {
          if (!m.nom?.trim()) return onErreur('Le nom est obligatoire.');
          void enregistrerMembre(m).then(onEnregistre)
            .catch((e) => onErreur((e as Error).message));
        }}>Enregistrer</button>
      </div>
    </div>
  );
}

// --- Sous-traitants ---------------------------------------------------------

function SousTraitants({ onErreur }: { onErreur: (m: string) => void }) {
  const [st, setSt] = useState<Tiers[]>([]);
  const [docs, setDocs] = useState<Document[]>([]);
  const [edition, setEdition] = useState<Partial<Tiers> | null>(null);

  const recharger = useCallback(async () => {
    try {
      const [t, d] = await Promise.all([
        listerTiers('sous_traitant'), listerDocumentsTiers().catch(() => []),
      ]);
      setSt(t); setDocs(d);
    } catch (e) { onErreur((e as Error).message); }
  }, [onErreur]);

  useEffect(() => { void recharger(); }, [recharger]);

  return (
    <>
      <p className="statut" style={{ marginBottom: 12 }}>
        Attestation URSSAF à renouveler tous les six mois au-delà de 5 000 € HT. Un
        sous-traitant non à jour vous expose à la solidarité financière sur ses cotisations
        et ses salaires impayés.
      </p>

      {st.length === 0 ? (
        <div className="vide">Aucun sous-traitant. Ajoutez le premier ci-dessous.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nom</th><th style={{ width: 210 }}>Coordonnées</th>
              <th style={{ width: 150 }}>SIRET</th>
              <th>Pièces</th>
              <th style={{ width: 140 }} className="sans-impression" />
            </tr>
          </thead>
          <tbody>
            {st.map((t) => {
              const siens = docs.filter((d) => d.tiers_id === t.id);
              const perime = siens.filter((d) => etatDocument(d) === 'perime').length;
              return (
                <tr key={t.id} className="cliquable"
                    onClick={() => aller(`/soustraitant/${t.id}`)}
                    style={perime ? { background: '#fdf3f2' } : undefined}>
                  <td><strong>{t.nom}</strong>{t.ville ? <div className="ref">{t.ville}</div> : null}</td>
                  <td className="ref">
                    {t.telephone ?? ''}{t.telephone && t.email ? <br /> : null}{t.email ?? ''}
                  </td>
                  <td className="ref">{t.siret ?? '—'}</td>
                  <td>
                    {siens.length === 0
                      ? <span className="jeton" data-r="retard">aucune pièce</span>
                      : siens.map((d) => {
                          const e = etatDocument(d);
                          return (
                            <span key={d.id} className="jeton"
                                  data-r={e === 'perime' ? 'retard' : e === 'a_jour' ? 'recu' : undefined}
                                  style={{ marginRight: 4, marginBottom: 3 }}
                                  title={d.expire_le
                                    ? `${LIBELLES_DOCUMENT[d.type].libelle} — expire le ${new Date(d.expire_le).toLocaleDateString('fr-FR')}`
                                    : LIBELLES_DOCUMENT[d.type].libelle}>
                              {LIBELLES_DOCUMENT[d.type].libelle.split(' ')[0]}
                              {e !== 'sans_echeance' && ` · ${
                                e === 'perime' ? 'périmé' : e === 'bientot' ? 'bientôt' : 'à jour'}`}
                            </span>
                          );
                        })}
                  </td>
                  <td className="sans-impression" style={{ whiteSpace: 'nowrap' }}
                      onClick={(e) => e.stopPropagation()}>
                    <button className="action discret"
                            onClick={() => aller(`/soustraitant/${t.id}`)}>Ouvrir</button>{' '}
                    <Menu actions={[
                      { libelle: 'Voir la fiche', faire: () => aller(`/soustraitant/${t.id}`) },
                      { libelle: 'Modifier les coordonnées', faire: () => setEdition(t) },
                    ]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Bulle texte="Créez la fiche, puis ajoutez ses attestations.">
        <button className="action" style={{ marginTop: 12 }}
                onClick={() => setEdition({ type: 'professionnel', categorie: 'sous_traitant', nom: '' })}>
          Nouveau sous-traitant
        </button>
      </Bulle>

      {edition && (
        <Modale titre={edition.id ? `Modifier ${edition.nom}` : 'Nouveau sous-traitant'}
                onFermer={() => setEdition(null)}>
          <FormulaireSousTraitant tiers={edition} onErreur={onErreur}
                                  onEnregistre={() => { setEdition(null); void recharger(); }} />
        </Modale>
      )}

    </>
  );
}

function FormulaireSousTraitant({ tiers, onEnregistre, onErreur }: {
  tiers: Partial<Tiers>; onEnregistre: () => void; onErreur: (m: string) => void;
}) {
  const [t, setT] = useState<Partial<Tiers>>(tiers);
  const set = (k: keyof Tiers, v: string) => setT((x) => ({ ...x, [k]: v }));
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
      <div style={{ gridColumn: 'span 2' }}>
        <label>Raison sociale</label>
        <ChampEntreprise valeur={t.nom ?? ''} onChange={(v) => set('nom', v)}
          onChoisir={(e) => setT((p) => ({
            ...p,
            nom: e.nom,
            siret: formaterSiret(e.siret),
            adresse: e.adresse || p.adresse,
            code_postal: e.codePostal || p.code_postal,
            ville: e.ville || p.ville,
            notes: e.cessee
              ? `⚠ Entreprise déclarée cessée dans l’annuaire public.\n${p.notes ?? ''}`.trim()
              : p.notes,
          }))} />
        <p className="statut">
          Tapez le nom ou le SIRET : la raison sociale, le SIRET et l’adresse du siège
          se remplissent depuis l’annuaire public des entreprises.
        </p>
      </div>
      <div><label>Téléphone</label>
        <input value={t.telephone ?? ''} onChange={(e) => set('telephone', e.target.value)} /></div>
      <div><label>E-mail</label>
        <input value={t.email ?? ''} onChange={(e) => set('email', e.target.value)} /></div>
      <div style={{ gridColumn: 'span 2' }}><label>Adresse</label>
        <ChampAdresse valeur={t.adresse ?? ''} onChange={(v) => set('adresse', v)}
          onChoisir={(s) => setT((p) => ({
            ...p, adresse: s.voie || s.texte,
            code_postal: s.codePostal || p.code_postal,
            ville: s.ville || p.ville,
          }))} /></div>
      <div><label>Ville</label>
        <input value={t.ville ?? ''} onChange={(e) => set('ville', e.target.value)} /></div>
      <div><label>SIRET</label>
        <input value={t.siret ?? ''} onChange={(e) => set('siret', e.target.value)} /></div>
      <div style={{ gridColumn: 'span 2' }}><label>Notes internes</label>
        <textarea rows={3} value={t.notes ?? ''}
                  onChange={(e) => setT((x) => ({ ...x, notes: e.target.value }))} /></div>
      <div style={{ gridColumn: 'span 2' }}>
        <button className="action" onClick={() => {
          if (!t.nom?.trim()) return onErreur('La raison sociale est obligatoire.');
          void enregistrerTiers({ ...t, type: 'professionnel', categorie: 'sous_traitant' })
            .then(onEnregistre).catch((e) => onErreur((e as Error).message));
        }}>Enregistrer</button>
      </div>
    </div>
  );
}

// --- Paie et règlements -----------------------------------------------------

const TYPES_PAIEMENT: Record<PaiementEquipe['type'], string> = {
  salaire: 'Salaire', prime: 'Prime', acompte: 'Acompte',
  facture: 'Facture de sous-traitant', note_de_frais: 'Note de frais', autre: 'Autre',
};

const MOYENS = ['virement', 'carte', 'cheque', 'especes', 'prelevement'];

/**
 * Ce qui est dû à l'équipe et aux sous-traitants, et ce qui a été payé.
 *
 * Batinium ne calcule pas la paie : ni cotisations, ni bulletin, ni
 * déclaration. Ce n'est pas son métier et ce serait prétendre remplacer un
 * comptable. Il suit ce qui est dû, ce qui est réglé, et à quel chantier ça se
 * rattache — trois informations que le comptable, lui, n'a pas.
 *
 * C'est aussi le seul endroit où se saisit désormais un règlement à un
 * sous-traitant : la catégorie de dépense a été retirée au SQL 12 pour qu'un
 * même euro n'ait pas deux saisies possibles. Rentabilité lit cette table.
 */
function Paie({ onErreur }: { onErreur: (m: string) => void }) {
  const [paie, setPaie] = useState<PaiementDetaille[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [soustraitants, setSoustraitants] = useState<Tiers[]>([]);
  const [chantiers, setChantiers] = useState<ChantierAvecTiers[]>([]);
  const [charge, setCharge] = useState(false);
  const [edition, setEdition] = useState<Partial<PaiementEquipe> | null>(null);
  const [qui, setQui] = useState<'tous' | 'salaries' | 'soustraitants'>('tous');
  const [etat, setEtat] = useState<'tous' | 'du' | 'paye'>('tous');
  const [cadre, setCadre] = useState<'mois' | 'mois_dernier' | 'annee' | 'tout'>('annee');

  const recharger = useCallback(async () => {
    try {
      const [p, m, t, c] = await Promise.all([
        listerPaie(), listerMembres(), listerTiers('sous_traitant'), listerChantiers(),
      ]);
      setPaie(p); setMembres(m.filter((x) => x.actif)); setSoustraitants(t); setChantiers(c);
    } catch (e) { onErreur((e as Error).message); }
    setCharge(true);
  }, [onErreur]);

  useEffect(() => { void recharger(); }, [recharger]);
  if (!charge) return <p className="statut">Chargement…</p>;

  const n = new Date();
  const j = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const bornes = {
    mois: [j(new Date(n.getFullYear(), n.getMonth(), 1)), j(new Date(n.getFullYear(), n.getMonth() + 1, 0))],
    mois_dernier: [j(new Date(n.getFullYear(), n.getMonth() - 1, 1)), j(new Date(n.getFullYear(), n.getMonth(), 0))],
    annee: [`${n.getFullYear()}-01-01`, `${n.getFullYear()}-12-31`],
    tout: [null, null],
  }[cadre] as [string | null, string | null];

  const aujourdhui = j(n);
  const dansPeriode = (d: string | null) => {
    if (!bornes[0]) return true;
    if (!d) return false;
    return d >= bornes[0] && d <= (bornes[1] ?? '9999');
  };

  const visibles = paie
    .filter((p) => dansPeriode(p.paye_le ?? p.du_le))
    .filter((p) => qui === 'tous' || (qui === 'salaries' ? p.membre_id : p.tiers_id))
    .filter((p) => etat === 'tous'
      || (etat === 'paye'
        ? (!!p.paye_le && p.paye_le <= j(n))
        : !(p.paye_le && p.paye_le <= j(n))));

  const somme = (l: PaiementDetaille[]) => l.reduce((s, p) => s + Number(p.montant), 0);

  /**
   * Payé veut dire payé, pas « payé le mois prochain ».
   *
   * Une date de règlement dans le futur est légitime — un virement programmé
   * se saisit le jour où on le programme. Mais tant qu'elle n'est pas arrivée,
   * l'argent est encore sur le compte : la ligne reste dans le reste à payer
   * et s'affiche comme programmée. Compter ces sommes en payées gonflait les
   * sorties du mois et vidait le reste à payer de son sens.
   */
  const estPaye = (p: PaiementDetaille) => !!p.paye_le && p.paye_le <= aujourdhui;

  const du      = visibles.filter((p) => !estPaye(p));
  const retard  = du.filter((p) => p.du_le && p.du_le < aujourdhui && !p.paye_le);
  const salaires = visibles.filter((p) => p.membre_id);
  const st       = visibles.filter((p) => p.tiers_id);

  return (
    <>
      <p className="statut" style={{ marginBottom: 12 }}>
        Batinium ne calcule pas la paie : il suit ce qui est dû et ce qui est réglé.
        Les bulletins et les déclarations restent chez le comptable. C’est ici, en
        revanche, que se saisit tout règlement à un sous-traitant — Rentabilité y lit
        sa ligne de sous-traitance.
      </p>

      <div style={{ display: 'grid', gap: 12, marginBottom: 16,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Chiffre libelle="Reste à payer" valeur={eur(somme(du))}
                 note={`${du.length} ligne${du.length > 1 ? 's' : ''}, virements programmés compris`} />
        <Chiffre libelle="En retard" valeur={eur(somme(retard))} alerte={retard.length > 0}
                 note={retard.length ? 'échéance dépassée' : 'rien en retard'} />
        <Chiffre libelle="Salariés sur la période" valeur={eur(somme(salaires))} />
        <Chiffre libelle="Sous-traitants sur la période" valeur={eur(somme(st))} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={qui} onChange={(e) => setQui(e.target.value as typeof qui)}
                style={{ width: 200 }}>
          <option value="tous">Tout le monde</option>
          <option value="salaries">Salariés</option>
          <option value="soustraitants">Sous-traitants</option>
        </select>
        <select value={cadre} onChange={(e) => setCadre(e.target.value as typeof cadre)}
                style={{ width: 190 }}>
          <option value="mois">Mois en cours</option>
          <option value="mois_dernier">Mois dernier</option>
          <option value="annee">Année en cours</option>
          <option value="tout">Depuis le début</option>
        </select>
        <select value={etat} onChange={(e) => setEtat(e.target.value as typeof etat)}
                style={{ width: 160 }}>
          <option value="tous">Payé et à payer</option>
          <option value="du">À payer</option>
          <option value="paye">Payé</option>
        </select>
        <div style={{ marginLeft: 'auto' }}>
          <button className="action" onClick={() => setEdition({
            type: 'salaire', montant: 0,
            periode: `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`,
            du_le: j(new Date(n.getFullYear(), n.getMonth() + 1, 0)),
          })}>
            Nouveau règlement
          </button>
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="vide">
          Rien sur cette période. Un salaire, une facture de sous-traitant, un acompte :
          tout ce qui sort vers une personne se note ici.
        </div>
      ) : (
        <div className="tableau-defilant">
          <table>
            <thead>
              <tr>
                <th style={{ width: 190 }}>Bénéficiaire</th>
                <th style={{ width: 160 }}>Nature</th>
                <th>Libellé</th>
                <th style={{ width: 90 }}>Période</th>
                <th style={{ width: 160 }}>Chantier</th>
                <th style={{ width: 100 }}>Dû le</th>
                <th className="num" style={{ width: 110 }}>Montant</th>
                <th style={{ width: 130 }}>Payé le</th>
                <th style={{ width: 50 }} className="sans-impression" />
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => {
                const programme = !!p.paye_le && p.paye_le > aujourdhui;
                const enRetard = !p.paye_le && p.du_le && p.du_le < aujourdhui;
                return (
                  <tr key={p.id} style={enRetard ? { background: '#fdf3f2' } : undefined}>
                    <td>
                      <strong>{p.membre?.nom ?? p.tiers?.nom ?? '—'}</strong>
                      <div>
                        <span className="jeton" data-r={p.membre_id ? 'salarie' : 'sous_traitant'}>
                          {p.membre_id ? 'salarié' : 'sous-traitant'}
                        </span>
                      </div>
                    </td>
                    <td className="statut">{TYPES_PAIEMENT[p.type]}</td>
                    <td>{p.libelle}{p.notes && <div className="fiche">{p.notes}</div>}</td>
                    <td className="ref num">{p.periode ?? '—'}</td>
                    <td className="ref">
                      {p.chantier
                        ? <a href={`#/chantiers/${p.chantier.id}`}>{p.chantier.numero}</a>
                        : <span className="statut">hors chantier</span>}
                    </td>
                    <td className="num ref">
                      {p.du_le ? new Date(p.du_le).toLocaleDateString('fr-FR') : '—'}
                      {enRetard && <div><span className="jeton" data-r="retard">en retard</span></div>}
                    </td>
                    <td className="num">{eur(Number(p.montant))}</td>
                    <td>
                      <input type="date" value={p.paye_le ?? ''}
                             onChange={(e) => void enregistrerPaiementEquipe({
                               id: p.id, paye_le: e.target.value || null,
                             }).then(recharger).catch((x) => onErreur((x as Error).message))} />
                      {programme && (
                        <div><span className="jeton" data-r="sous_traitant">programmé</span></div>
                      )}
                    </td>
                    <td className="sans-impression">
                      <Menu actions={[
                        { libelle: 'Modifier', faire: () => setEdition(p) },
                        { libelle: 'Supprimer', danger: true, faire: () => {
                            if (window.confirm(`Supprimer « ${p.libelle} » ?`)) {
                              void supprimerPaiementEquipe(p.id).then(recharger);
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

      {edition && (
        <Modale titre={edition.id ? 'Modifier le règlement' : 'Nouveau règlement'}
                onFermer={() => setEdition(null)}>
          <FormulairePaiement key={edition.id ?? 'neuf'} paiement={edition}
                              membres={membres} soustraitants={soustraitants}
                              chantiers={chantiers} onErreur={onErreur}
                              onEnregistre={() => { setEdition(null); void recharger(); }} />
        </Modale>
      )}
    </>
  );
}

function FormulairePaiement({
  paiement, membres, soustraitants, chantiers, onEnregistre, onErreur,
}: {
  paiement: Partial<PaiementEquipe>;
  membres: Membre[];
  soustraitants: Tiers[];
  chantiers: ChantierAvecTiers[];
  onEnregistre: () => void;
  onErreur: (m: string) => void;
}) {
  const [p, setP] = useState<Partial<PaiementEquipe>>(paiement);
  const set = (k: keyof PaiementEquipe, v: unknown) => setP((x) => ({ ...x, [k]: v }));

  // Un seul bénéficiaire, imposé par la base : le choix passe donc par une
  // liste unique plutôt que par deux champs dont l'un devrait rester vide.
  const beneficiaire = p.membre_id ? `m:${p.membre_id}` : p.tiers_id ? `t:${p.tiers_id}` : '';
  function choisir(v: string) {
    const [genre, id] = v.split(':');
    setP((x) => ({
      ...x,
      membre_id: genre === 'm' ? id : null,
      tiers_id: genre === 't' ? id : null,
      type: genre === 't' && (x.type === 'salaire' || !x.type) ? 'facture' : x.type,
    }));
  }

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
      <div>
        <label>Bénéficiaire</label>
        <select value={beneficiaire} onChange={(e) => choisir(e.target.value)}>
          <option value="">—</option>
          <optgroup label="Salariés">
            {membres.map((m) => <option key={m.id} value={`m:${m.id}`}>{m.nom}</option>)}
          </optgroup>
          <optgroup label="Sous-traitants">
            {soustraitants.map((t) => <option key={t.id} value={`t:${t.id}`}>{t.nom}</option>)}
          </optgroup>
        </select>
      </div>
      <div>
        <label>Nature</label>
        <select value={p.type ?? 'salaire'} onChange={(e) => set('type', e.target.value)}>
          {Object.entries(TYPES_PAIEMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <label>Libellé</label>
        <input value={p.libelle ?? ''} placeholder="Salaire de septembre, facture ST-2026-14…"
               onChange={(e) => set('libelle', e.target.value)} />
      </div>
      <div>
        <label>Montant</label>
        <input type="number" step="0.01" className="num" value={p.montant ?? ''}
               onChange={(e) => set('montant', Number(e.target.value))} />
      </div>
      <div>
        <label>Période concernée</label>
        <input type="month" value={p.periode ?? ''}
               onChange={(e) => set('periode', e.target.value || null)} />
      </div>
      <div>
        <label>Dû le</label>
        <input type="date" value={p.du_le ?? ''} onChange={(e) => set('du_le', e.target.value || null)} />
      </div>
      <div>
        <label>Payé le</label>
        <input type="date" value={p.paye_le ?? ''}
               onChange={(e) => set('paye_le', e.target.value || null)} />
        {p.paye_le && p.paye_le > new Date().toISOString().slice(0, 10) && (
          <p className="statut">
            Cette date est à venir : la ligne sera comptée comme un virement programmé,
            pas comme un règlement effectué. Elle restera dans le reste à payer jusque-là.
          </p>
        )}
      </div>
      <div>
        <label>Moyen</label>
        <select value={p.moyen ?? ''} onChange={(e) => set('moyen', e.target.value || null)}>
          <option value="">—</option>
          {MOYENS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div>
        <label>Chantier</label>
        <select value={p.chantier_id ?? ''}
                onChange={(e) => set('chantier_id', e.target.value || null)}>
          <option value="">Hors chantier</option>
          {chantiers.map((c) => <option key={c.id} value={c.id}>{c.numero} — {c.libelle}</option>)}
        </select>
        <p className="statut">
          Rattaché à un chantier, le règlement relève de son coût réel. Sinon il pèse
          sur les frais généraux, et Rentabilité le déduit à ce titre.
        </p>
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <label>Notes</label>
        <textarea rows={2} value={p.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <button className="action" onClick={() => {
          if (!p.membre_id && !p.tiers_id) return onErreur('Choisissez un bénéficiaire.');
          if (!p.libelle?.trim()) return onErreur('Le libellé est obligatoire.');
          if (!p.montant) return onErreur('Le montant est obligatoire.');
          void enregistrerPaiementEquipe(p).then(onEnregistre)
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


// --- Rémunérations ----------------------------------------------------------

/**
 * L'historique des rémunérations d'un salarié.
 *
 * Une augmentation ajoute une ligne datée, elle n'écrase pas la précédente.
 * C'est ce qui permet à un prévisionnel de janvier d'utiliser le salaire de
 * janvier, et non celui d'aujourd'hui.
 */
function Remunerations({ membre, liste, coefficient, onErreur, onChange }: {
  membre: Membre;
  liste: Remuneration[];
  coefficient: number;
  onErreur: (m: string) => void;
  onChange: () => void;
}) {
  const [r, setR] = useState<Partial<Remuneration>>({
    depuis_le: new Date().toISOString().slice(0, 10), heures_hebdo: 35,
  });
  const set = (k: keyof Remuneration, v: unknown) => setR((x) => ({ ...x, [k]: v }));
  const triees = [...liste].sort((a, b) => b.depuis_le.localeCompare(a.depuis_le));
  const courante = triees.find((x) => x.depuis_le <= new Date().toISOString().slice(0, 10));

  async function ajouter() {
    if (!r.brut_mensuel) return onErreur('Le brut mensuel est obligatoire.');
    if (!r.depuis_le) return onErreur('Indiquez la date de prise d’effet.');
    try {
      await enregistrerRemuneration({ ...r, membre_id: membre.id });
      setR({ depuis_le: new Date().toISOString().slice(0, 10), heures_hebdo: 35 });
      onChange();
    } catch (e) { onErreur((e as Error).message); }
  }

  return (
    <>
      <p className="statut" style={{ marginBottom: 12 }}>
        Ces montants ne servent qu’au prévisionnel : ce que l’équipe coûte chaque mois,
        avant de parler de marge. Batinium ne produit ni bulletin ni déclaration, et ne
        remplace pas le comptable. Le coût employeur saisi ici l’emporte sur l’estimation ;
        laissé vide, il est calculé en appliquant le coefficient de{' '}
        <strong>×{coefficient}</strong> défini dans les réglages de l’entreprise.
      </p>

      {triees.length === 0 ? (
        <div className="vide">Aucune rémunération enregistrée.</div>
      ) : (
        <table style={{ marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Depuis le</th>
              <th className="num" style={{ width: 120 }}>Brut mensuel</th>
              <th className="num" style={{ width: 110 }}>Taux horaire</th>
              <th className="num" style={{ width: 150 }}>Coût employeur</th>
              <th>Notes</th>
              <th style={{ width: 40 }} className="sans-impression" />
            </tr>
          </thead>
          <tbody>
            {triees.map((x) => {
              const c = coutEmployeur(x, coefficient);
              return (
                <tr key={x.id} style={x.id === courante?.id
                  ? { background: 'var(--bleu-pale)' } : { opacity: 0.7 }}>
                  <td className="num ref">
                    {new Date(x.depuis_le).toLocaleDateString('fr-FR')}
                    {x.id === courante?.id && <div className="statut">en vigueur</div>}
                    {x.depuis_le > new Date().toISOString().slice(0, 10) && (
                      <div className="statut">à venir</div>
                    )}
                  </td>
                  <td className="num">{eur(Number(x.brut_mensuel))}</td>
                  <td className="num">
                    {eur(tauxHoraire(x))}
                    <div className="statut">{Number(x.heures_hebdo)} h / sem.</div>
                  </td>
                  <td className="num">
                    {eur(c.montant)}
                    <div className="statut">{c.estime ? `estimé ×${coefficient}` : 'saisi'}</div>
                  </td>
                  <td className="fiche">{x.notes ?? ''}</td>
                  <td className="sans-impression">
                    <button className="action discret" style={{ padding: '2px 8px' }}
                            title="Supprimer cette ligne"
                            onClick={() => {
                              if (window.confirm('Supprimer cette rémunération ?')) {
                                void supprimerRemuneration(x.id).then(onChange)
                                  .catch((e) => onErreur((e as Error).message));
                              }
                            }}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3 style={{ marginBottom: 8 }}>
        {triees.length === 0 ? 'Première rémunération' : 'Nouveau montant'}
      </h3>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div>
          <label>À partir du</label>
          <input type="date" value={r.depuis_le ?? ''}
                 onChange={(e) => set('depuis_le', e.target.value)} />
          <p className="statut">
            Date de l’augmentation, pas celle de la saisie. L’ancienne ligne reste.
          </p>
        </div>
        <div>
          <label>Brut mensuel</label>
          <input type="number" step="0.01" className="num" value={r.brut_mensuel ?? ''}
                 onChange={(e) => set('brut_mensuel', Number(e.target.value))} />
        </div>
        <div>
          <label>Heures par semaine</label>
          <input type="number" step="0.5" className="num" value={r.heures_hebdo ?? 35}
                 onChange={(e) => set('heures_hebdo', Number(e.target.value))} />
        </div>
        <div>
          <label>Taux horaire brut</label>
          <input type="number" step="0.01" className="num" value={r.taux_horaire_brut ?? ''}
                 placeholder={r.brut_mensuel
                   ? String(Math.round((Number(r.brut_mensuel) /
                       ((Number(r.heures_hebdo) || 35) * 52 / 12)) * 100) / 100)
                   : ''}
                 onChange={(e) => set('taux_horaire_brut',
                   e.target.value ? Number(e.target.value) : null)} />
          <p className="statut">
            Laissé vide, il se déduit du brut. Il sert aux heures supplémentaires.
          </p>
        </div>
        <div>
          <label>Coût employeur réel</label>
          <input type="number" step="0.01" className="num" value={r.cout_employeur_mensuel ?? ''}
                 placeholder={r.brut_mensuel
                   ? String(Math.round(Number(r.brut_mensuel) * coefficient * 100) / 100)
                   : ''}
                 onChange={(e) => set('cout_employeur_mensuel',
                   e.target.value ? Number(e.target.value) : null)} />
          <p className="statut">
            Le chiffre du comptable, s’il vous l’a donné. Sinon laissez vide : l’estimation
            s’affichera, et sera marquée comme telle.
          </p>
        </div>
        <div>
          <label>Notes</label>
          <input value={r.notes ?? ''} placeholder="Passage au coefficient 210"
                 onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div style={{ gridColumn: 'span 3' }}>
          <button className="action" onClick={() => void ajouter()}>Enregistrer</button>
        </div>
      </div>
    </>
  );
}
