import { useCallback, useEffect, useMemo, useState } from 'react';
import { aller } from '../lib/router';
import { calculerDevis, eur, type DevisCalcule } from '../lib/calcul';
import {
  chargerTousLesDevis, coutJournalier, coutMensuel, coutsMainOeuvre, coutsReels, heuresLisibles,
  listerChantiers, listerChargesFixes,
  listerDemandes, listerDepenses, listerEncaissements, listerPaiementsEquipe, listerProduits,
  pointerEncaissement,
  type ChantierAvecTiers, type DepenseDetaillee, type DevisAvecTiers,
  type EncaissementDetaille,
} from '../lib/db';
import type {
  ChargeFixe, CoutMainOeuvre, CoutReel, Devis, PaiementEquipe, Produit,
} from '../lib/types';
import Squelette from '../components/Squelette';

interface Ligne {
  devis: DevisAvecTiers;
  calcul: DevisCalcule;
  chantier?: ChantierAvecTiers;
}

// --- Périodes ---------------------------------------------------------------

type Cadre =
  | 'mois' | 'mois_dernier' | 'trimestre' | 'trimestre_dernier'
  | 'annee' | 'annee_derniere' | 'douze' | 'tout' | 'perso';

const CADRES: Record<Cadre, string> = {
  mois: 'Mois en cours',
  mois_dernier: 'Mois dernier',
  trimestre: 'Trimestre en cours',
  trimestre_dernier: 'Trimestre dernier',
  annee: 'Année en cours',
  annee_derniere: 'Année dernière',
  douze: '12 derniers mois',
  tout: 'Depuis le début',
  perso: 'Période personnalisée',
};

/** Format local, jamais toISOString : à Paris, minuit bascule la veille en UTC. */
const jour = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Les bornes de la période, incluses toutes les deux.
 *
 * Le trimestre en cours et le trimestre dernier ne sont pas là par symétrie :
 * c'est la maille de la déclaration de TVA, donc celle sur laquelle le
 * comptable pose ses questions.
 */
function bornes(cadre: Cadre, debutPerso: string, finPerso: string):
  { debut: string | null; fin: string | null } {
  const n = new Date();
  const a = n.getFullYear();
  const m = n.getMonth();
  const t = Math.floor(m / 3) * 3;

  switch (cadre) {
    case 'mois':              return { debut: jour(new Date(a, m, 1)),      fin: jour(new Date(a, m + 1, 0)) };
    case 'mois_dernier':      return { debut: jour(new Date(a, m - 1, 1)),  fin: jour(new Date(a, m, 0)) };
    case 'trimestre':         return { debut: jour(new Date(a, t, 1)),      fin: jour(new Date(a, t + 3, 0)) };
    case 'trimestre_dernier': return { debut: jour(new Date(a, t - 3, 1)),  fin: jour(new Date(a, t, 0)) };
    case 'annee':             return { debut: jour(new Date(a, 0, 1)),      fin: jour(new Date(a, 11, 31)) };
    case 'annee_derniere':    return { debut: jour(new Date(a - 1, 0, 1)),  fin: jour(new Date(a - 1, 11, 31)) };
    case 'douze':             return { debut: jour(new Date(a, m - 11, 1)), fin: jour(new Date(a, m + 1, 0)) };
    case 'perso':             return { debut: debutPerso || null, fin: finPerso || null };
    default:                  return { debut: null, fin: null };
  }
}

/**
 * La date qui range un devis dans une période.
 *
 * Un devis signé compte à sa signature : c'est l'engagement, la date que
 * retient le comptable. Un devis encore en attente compte à son émission,
 * faute d'autre chose. Choisir la seule date d'émission pour tout aurait fait
 * remonter dans le mois de mars une affaire chiffrée en mars et signée en juin.
 */
const dateDevis = (d: Devis) =>
  (d.statut === 'signe' ? d.signe_le ?? d.date_emission : d.date_emission);

/**
 * Rentabilité. Ce qui est mesurable aujourd'hui l'est ; ce qui ne l'est pas
 * est annoncé comme tel plutôt que deviné.
 */
export default function PageAnalytique() {
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [encaissements, setEncaissements] = useState<EncaissementDetaille[]>([]);
  const [demandes, setDemandes] = useState<{ recu_le: string; statut: string }[]>([]);
  const [chargesFixes, setChargesFixes] = useState<ChargeFixe[]>([]);
  const [depenses, setDepenses] = useState<DepenseDetaillee[]>([]);
  const [paiements, setPaiements] = useState<PaiementEquipe[]>([]);
  const [mainOeuvre, setMainOeuvre] = useState<Map<string, CoutMainOeuvre>>(new Map());
  const [reels, setReels] = useState<Map<string, CoutReel>>(new Map());
  const [avecCharges, setAvecCharges] = useState(true);
  const [avecPaie, setAvecPaie] = useState(false);
  const [cadre, setCadre] = useState<Cadre>('annee');
  const [debutPerso, setDebutPerso] = useState('');
  const [finPerso, setFinPerso] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const [actualise, setActualise] = useState(false);
  const [derniere, setDerniere] = useState<Date | null>(null);

  const recharger = useCallback(async () => {
    try {
      // Tout arrive en parallèle, et les devis en un seul lot.
      setActualise(true);
      const [groupes, produits, chantiers, enc, dem, cf, dep, pay, mo, cr] = await Promise.all([
        chargerTousLesDevis(), listerProduits(true), listerChantiers(),
        listerEncaissements().catch(() => []), listerDemandes(),
        listerChargesFixes().catch(() => []), listerDepenses().catch(() => []),
        listerPaiementsEquipe().catch(() => []),
        coutsMainOeuvre().catch(() => new Map()),
        coutsReels().catch(() => new Map()),
      ]);
      setChargesFixes(cf);
      setDepenses(dep);
      setPaiements(pay);
      setMainOeuvre(mo);
      setReels(cr);
      const carte = new Map<string, Produit>(produits.map((p) => [p.id, p]));
      setLignes(groupes.map((g) => ({
        devis: g.devis,
        calcul: calculerDevis(g.devis, g.lots, g.lignes, carte, g.site),
        chantier: chantiers.find((c) => c.devis_id === g.devis.id),
      })));
      setEncaissements(enc);
      setDemandes(dem.map((d) => ({ recu_le: d.recu_le, statut: d.statut })));
    } catch (e) { setErreur((e as Error).message); }
    setCharge(true);
    setActualise(false);
    setDerniere(new Date());
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  const { debut, fin } = useMemo(
    () => bornes(cadre, debutPerso, finPerso), [cadre, debutPerso, finPerso]);

  const dansPeriode = useCallback((d: string | null | undefined): boolean => {
    if (!debut && !fin) return true;
    if (!d) return false;
    const j = d.slice(0, 10);
    return (!debut || j >= debut) && (!fin || j <= fin);
  }, [debut, fin]);

  /**
   * Une charge fixe proratisée sur la période, au jour près.
   *
   * Comparer une marge de trimestre à un loyer mensuel n'aurait aucun sens :
   * la charge est ramenée au jour, puis multipliée par les jours de la période
   * où elle courait vraiment. Une décennale souscrite en mars ne pèse pas sur
   * janvier.
   */
  const chargeSurPeriode = useCallback((c: ChargeFixe): number => {
    const mensuel = coutMensuel(c.montant_ht, c.periodicite, c.mois_personnalises);
    if (!debut || !fin) return mensuel;
    const t = (s: string) => new Date(`${s}T00:00:00`).getTime();
    const d0 = Math.max(t(debut), c.debut_le ? t(c.debut_le) : t(debut));
    const f0 = Math.min(t(fin), c.fin_le ? t(c.fin_le) : t(fin));
    const jours = Math.floor((f0 - d0) / 86400000) + 1;
    return jours > 0 ? coutJournalier(c) * jours : 0;
  }, [debut, fin]);

  if (!charge) {
    return (
      <>
        <div className="entete"><h1>Rentabilité</h1></div>
        <Squelette chiffres={4} lignes={7} colonnes={7} />
      </>
    );
  }

  const retenues = lignes.filter((l) => dansPeriode(dateDevis(l.devis)));
  const signes    = retenues.filter((l) => l.devis.statut === 'signe');
  const enAttente = retenues.filter((l) => ['envoye', 'relance'].includes(l.devis.statut));

  const somme = (l: Ligne[], f: (x: Ligne) => number | null) =>
    l.reduce((s, x) => s + (f(x) ?? 0), 0);

  const caSigneHt   = somme(signes,    (l) => l.calcul.totalHt);
  const margeSignee = somme(signes,    (l) => l.calcul.margeHt);
  const caAttenteHt = somme(enAttente, (l) => l.calcul.totalHt);
  const tauxMarge   = caSigneHt > 0 ? (margeSignee / caSigneHt) * 100 : 0;

  // Ce que l'entreprise paie en dehors des chantiers, sur la période retenue.
  const chargePeriode = chargesFixes.reduce((s, c) => s + chargeSurPeriode(c), 0);
  const chargeMensuelle = chargesFixes.reduce(
    (s, c) => s + coutMensuel(c.montant_ht, c.periodicite, c.mois_personnalises), 0);
  const chargeJournaliere = chargeMensuelle / 21;

  // Les dépenses déjà rattachées à un chantier sont dans son coût :
  // on ne compte ici que les frais généraux, pour ne pas les compter deux fois.
  const depensesPeriode = depenses.filter((d) => dansPeriode(d.date_achat));
  const fraisGeneraux = depensesPeriode
    .filter((d) => !d.chantier_id)
    .reduce((s, d) => s + Number(d.montant_ht), 0);

  // La sous-traitance est lue ici, et nulle part ailleurs : elle a été retirée
  // des catégories de dépense pour qu'un même règlement n'ait qu'une saisie.
  const paiementsPeriode = paiements.filter((p) => dansPeriode(p.paye_le ?? p.du_le));
  const sousTraitance = paiementsPeriode
    .filter((p) => p.tiers_id && !p.chantier_id)
    .reduce((s, p) => s + Number(p.montant), 0);
  const sousTraitanceChantier = paiementsPeriode
    .filter((p) => p.tiers_id && p.chantier_id)
    .reduce((s, p) => s + Number(p.montant), 0);
  const paie = paiementsPeriode
    .filter((p) => p.membre_id)
    .reduce((s, p) => s + Number(p.montant), 0);

  const margeNette = margeSignee - chargePeriode - fraisGeneraux - sousTraitance
    - (avecPaie ? paie : 0);

  const aujourdhui = jour(new Date());
  const encPeriode = encaissements.filter((e) => dansPeriode(e.recu_le ?? e.du_le));
  // Une date d'encaissement dans le futur ne fait pas entrer l'argent : tant
  // qu'elle n'est pas arrivée, la somme est attendue, pas reçue.
  const estRecu = (e: EncaissementDetaille) => !!e.recu_le && e.recu_le <= aujourdhui;
  const recu    = encPeriode.filter(estRecu);
  const impayes = encPeriode.filter((e) => !estRecu(e) && e.du_le && e.du_le < aujourdhui
                                            && !e.recu_le);
  const aVenir  = encPeriode.filter((e) => !estRecu(e)
                                            && (!!e.recu_le || !e.du_le || e.du_le >= aujourdhui));
  const total = (l: EncaissementDetaille[]) => l.reduce((s, e) => s + Number(e.montant_ttc), 0);

  const demandesPeriode = demandes.filter((d) => dansPeriode(d.recu_le) && d.statut !== 'spam');
  const conversion = {
    demandes: demandesPeriode.length,
    devises: retenues.length,
    signes: signes.length,
  };

  const intitulePeriode = cadre === 'tout'
    ? 'depuis le début'
    : debut && fin
      ? `du ${new Date(`${debut}T00:00:00`).toLocaleDateString('fr-FR')} au ${new Date(`${fin}T00:00:00`).toLocaleDateString('fr-FR')}`
      : 'période incomplète';

  return (
    <>
      <div className="entete">
        <h1>Rentabilité</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {derniere && (
            <span className="statut">
              à jour à {derniere.toLocaleTimeString('fr-FR',
                { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button className="action discret" disabled={actualise}
                  onClick={() => void recharger()}>
            {actualise ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="panneau" style={{ display: 'block' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ width: 210 }}>
            <label>Période</label>
            <select value={cadre} onChange={(e) => setCadre(e.target.value as Cadre)}>
              {Object.entries(CADRES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {cadre === 'perso' && (
            <>
              <div style={{ width: 160 }}>
                <label>Du</label>
                <input type="date" value={debutPerso}
                       onChange={(e) => setDebutPerso(e.target.value)} />
              </div>
              <div style={{ width: 160 }}>
                <label>Au</label>
                <input type="date" value={finPerso}
                       onChange={(e) => setFinPerso(e.target.value)} />
              </div>
            </>
          )}
          <span className="statut" style={{ flex: 1, minWidth: 240, paddingBottom: 7 }}>
            {conversion.devises} devis retenus, {intitulePeriode}. Un devis signé
            compte à sa date de signature, un devis en attente à sa date d’émission.
          </span>
          <button className="action discret" onClick={() => aller('/depenses')}>
            Gérer les dépenses
          </button>
        </div>

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12,
                      borderTop: '1px solid var(--filet)', paddingTop: 10 }}>
          <label style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center',
                          color: 'var(--encre)' }}>
            <input type="checkbox" checked={avecCharges} style={{ width: 'auto' }}
                   onChange={(e) => setAvecCharges(e.target.checked)} />
            Déduire les charges fixes, les frais généraux et la sous-traitance
          </label>
          <label style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center',
                          color: 'var(--encre)' }}>
            <input type="checkbox" checked={avecPaie} style={{ width: 'auto' }}
                   disabled={!avecCharges}
                   onChange={(e) => setAvecPaie(e.target.checked)} />
            Déduire aussi la paie des salariés
          </label>
          <span className="statut" style={{ flex: 1, minWidth: 260 }}>
            {chargesFixes.length === 0
              ? 'Aucune charge fixe enregistrée : la marge affichée reste une marge brute.'
              : `${eur(chargeMensuelle)} par mois de charges fixes, soit ${eur(chargeJournaliere)} par jour ouvré.`}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12, marginBottom: 20,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Chiffre libelle="Signé, hors taxes" valeur={eur(caSigneHt)}
                 note={`${signes.length} devis`} />
        <Chiffre libelle={avecCharges ? 'Marge brute prévue' : 'Marge prévue'}
                 valeur={eur(margeSignee)}
                 note={`${tauxMarge.toFixed(1)} % du chiffre`} />
        {avecCharges && (
          <Chiffre libelle="Après charges et dépenses" valeur={eur(margeNette)}
                   alerte={margeNette < 0}
                   note={margeNette < 0
                     ? 'Les charges dépassent la marge dégagée'
                     : `${((margeNette / (caSigneHt || 1)) * 100).toFixed(1)} % du chiffre`} />
        )}
        <Chiffre libelle="Devis en attente" valeur={eur(caAttenteHt)}
                 note={`${enAttente.length} devis`} />
        <Chiffre libelle="Impayés" valeur={eur(total(impayes))} alerte={impayes.length > 0}
                 note={`${impayes.length} échéance${impayes.length > 1 ? 's' : ''} dépassée${impayes.length > 1 ? 's' : ''}`} />
      </div>

      <h2 style={{ marginBottom: 8 }}>Du premier appel à la signature</h2>
      <div className="panneau" style={{ display: 'block' }}>
        <Entonnoir libelle="Demandes reçues" valeur={conversion.demandes} base={conversion.demandes} />
        <Entonnoir libelle="Devis établis" valeur={conversion.devises} base={conversion.demandes} />
        <Entonnoir libelle="Devis signés" valeur={conversion.signes} base={conversion.demandes} />
        <p className="statut" style={{ marginTop: 10 }}>
          L’écart entre la première et la deuxième ligne est le plus coûteux : une demande
          non chiffrée part chez un concurrent sans qu’on le sache.
        </p>
      </div>

      <h2 style={{ margin: '22px 0 8px' }}>Marge par affaire</h2>
      {retenues.length === 0 ? (
        <div className="vide">Aucun devis sur cette période.</div>
      ) : (
        <div className="tableau-defilant">
          <table>
            <thead>
              <tr>
                <th>Devis</th><th>Client</th><th>Chantier</th>
                <th className="num">Total HT</th>
                <th className="num">Déboursé</th>
                <th className="num">Marge prévue</th>
                <th className="num" style={{ width: 150 }}>Coût réel</th>
                <th style={{ width: 120 }}>Taux</th>
              </tr>
            </thead>
            <tbody>
              {retenues.map((l) => {
                const taux = l.calcul.margePct ?? 0;
                return (
                  <tr key={l.devis.id} className="cliquable"
                      onClick={() => aller(`/devis/${l.devis.id}`)}>
                    <td>{l.devis.numero}<div className="statut">{l.devis.statut}</div></td>
                    <td>{l.devis.tiers?.nom ?? '—'}</td>
                    <td className="ref">{l.chantier?.numero ?? '—'}</td>
                    <td className="num">{eur(l.calcul.totalHt)}</td>
                    <td className="num">
                      {l.calcul.deboursSecHt != null ? eur(l.calcul.deboursSecHt) : '—'}
                    </td>
                    <td className="num">
                      {l.calcul.margeHt != null ? eur(l.calcul.margeHt) : '—'}
                    </td>
                    <td className="num">
                      {(() => {
                        // Le seul chiffre constaté de ce tableau : matériel
                        // facturé et heures pointées. Comparé au déboursé
                        // prévu juste à gauche, il dit ce que le chantier a
                        // vraiment coûté par rapport à ce qu'on avait chiffré.
                        const r = l.chantier ? reels.get(l.chantier.id) : undefined;
                        const mo = l.chantier ? mainOeuvre.get(l.chantier.id) : undefined;
                        if (!r || Number(r.total) === 0) {
                          return mo
                            ? <>{eur(Number(mo.cout))}
                                <div className="statut">
                                  {heuresLisibles(Number(mo.heures))}, matériel non saisi
                                </div></>
                            : <span className="statut">—</span>;
                        }
                        const prevu = l.calcul.deboursSecHt;
                        const derive = prevu != null && prevu > 0
                          ? ((Number(r.total) - prevu) / prevu) * 100 : null;
                        return (
                          <>
                            {eur(Number(r.total))}
                            <div className="statut">
                              {eur(Number(r.materiel))} matériel ·{' '}
                              {heuresLisibles(Number(r.heures))}
                            </div>
                            {derive != null && (
                              <div className="statut" style={{
                                color: derive > 5 ? 'var(--alerte)'
                                  : derive < -5 ? 'var(--vert)' : undefined,
                              }}>
                                {derive > 0 ? '+' : ''}{derive.toFixed(0)} % du prévu
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td>
                      {l.calcul.margePct != null && (
                        <>
                          <div className="jauge" data-alerte={taux < 20 ? 'oui' : 'non'}>
                            <i style={{ width: `${Math.min(100, Math.max(0, taux))}%` }} />
                          </div>
                          <span className="statut num">{taux.toFixed(1)} %</span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="statut" style={{ marginTop: 6 }}>
        {retenues.length} affaire{retenues.length > 1 ? 's' : ''} — le tableau défile
        sur lui-même pour garder les encaissements et les charges à portée d’écran.
      </p>

      <h2 style={{ margin: '22px 0 8px' }}>Encaissements</h2>
      {encPeriode.length === 0 ? (
        <div className="vide">
          Aucune échéance sur cette période. Elles se créent depuis un devis signé,
          à partir de son échéancier.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 12, marginBottom: 12,
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Chiffre libelle="Encaissé" valeur={eur(total(recu))} />
            <Chiffre libelle="En retard" valeur={eur(total(impayes))} alerte={impayes.length > 0} />
            <Chiffre libelle="À venir" valeur={eur(total(aVenir))} />
          </div>
          <div className="tableau-defilant">
            <table>
              <thead>
                <tr>
                  <th>Échéance</th><th>Client</th><th>Devis</th>
                  <th style={{ width: 120 }}>Due le</th>
                  <th className="num" style={{ width: 120 }}>Montant TTC</th>
                  <th style={{ width: 150 }}>Reçu le</th>
                </tr>
              </thead>
              <tbody>
                {encPeriode.map((e) => {
                  const attendu = !!e.recu_le && e.recu_le > aujourdhui;
                  const retard = !e.recu_le && e.du_le && e.du_le < aujourdhui;
                  return (
                    <tr key={e.id} style={retard ? { background: '#fdf3f2' } : undefined}>
                      <td>
                        {e.libelle}
                        {e.pourcentage != null && <span className="statut"> · {e.pourcentage} %</span>}
                      </td>
                      <td>{e.tiers?.nom ?? '—'}</td>
                      <td className="ref">{e.devis?.numero ?? '—'}</td>
                      <td className="num ref">
                        {e.du_le ? new Date(e.du_le).toLocaleDateString('fr-FR') : '—'}
                        {retard && <div><span className="jeton" data-r="retard">en retard</span></div>}
                      </td>
                      <td className="num">{eur(Number(e.montant_ttc))}</td>
                      <td>
                        <input type="date" value={e.recu_le ?? ''}
                               onChange={(ev) => void pointerEncaissement(e.id, ev.target.value || null)
                                 .then(recharger).catch((x) => setErreur((x as Error).message))} />
                        {attendu && (
                          <div><span className="jeton">attendu, pas encore reçu</span></div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {avecCharges && (
        <>
          <h2 style={{ margin: '22px 0 8px' }}>Ce qui pèse hors chantiers</h2>
          <table>
            <tbody>
              <tr>
                <td>
                  {debut && fin ? 'Charges fixes sur la période' : 'Charges fixes, ramenées au mois'}
                  {debut && fin && (
                    <div className="statut">
                      Proratisées au jour : une charge souscrite en cours de période
                      ne pèse que sur les jours où elle courait.
                    </div>
                  )}
                </td>
                <td className="num">− {eur(chargePeriode)}</td>
              </tr>
              <tr>
                <td>
                  Dépenses en frais généraux
                  <div className="statut">
                    Les dépenses rattachées à un chantier sont déjà dans son coût,
                    elles ne sont pas recomptées ici.
                  </div>
                </td>
                <td className="num">− {eur(fraisGeneraux)}</td>
              </tr>
              <tr>
                <td>
                  Sous-traitance réglée, hors chantier
                  <div className="statut">
                    Lue dans les paiements de l’équipe, seul endroit où elle se saisit
                    désormais.
                    {sousTraitanceChantier > 0 && ` ${eur(sousTraitanceChantier)} de plus sont rattachés à un chantier et relèvent de son coût.`}
                  </div>
                </td>
                <td className="num">− {eur(sousTraitance)}</td>
              </tr>
              <tr style={avecPaie ? undefined : { color: 'var(--encre-pale)' }}>
                <td>
                  Paie des salariés
                  <div className="statut">
                    {avecPaie
                      ? 'Déduite. Vérifiez qu’elle n’est pas déjà saisie en charge fixe, sans quoi elle compte deux fois.'
                      : 'Affichée mais non déduite : beaucoup d’entreprises la saisissent déjà en charge fixe. Cochez la case plus haut pour la déduire.'}
                  </div>
                </td>
                <td className="num">{avecPaie ? '− ' : ''}{eur(paie)}</td>
              </tr>
              <tr style={{ fontWeight: 600 }}>
                <td>Marge après charges</td>
                <td className="num" style={{ color: margeNette < 0 ? 'var(--alerte)' : undefined }}>
                  {eur(margeNette)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="statut" style={{ marginTop: 8 }}>
            Autrement dit, il faut dégager au moins {eur(chargeJournaliere)} de marge par
            jour ouvré pour que l’entreprise couvre ses frais fixes, avant de gagner
            quoi que ce soit.
          </p>
        </>
      )}

      <div className="panneau" style={{ display: 'block', marginTop: 22,
                                        borderLeft: '3px solid var(--bleu)' }}>
        <h3 style={{ marginBottom: 6 }}>Ce que ces chiffres ne disent pas encore</h3>
        <p className="statut">
          La marge par affaire reste <strong>prévisionnelle</strong> : elle compare le prix de
          vente au prix d’achat inscrit au catalogue. Les charges fixes, les frais généraux
          et la sous-traitance en sont déduits, et la colonne « Main-d’œuvre » donne
          maintenant les heures réellement pointées, valorisées au taux en vigueur le jour
          travaillé. Elle n’est pas encore retranchée de la marge : le déboursé catalogue
          contient déjà une part de pose, et soustraire les deux compterait deux fois le
          même travail. Il manque, pour boucler, les factures fournisseurs rapprochées
          ligne à ligne — le module achats. Avec elles, la marge d’un chantier deviendra
          un chiffre constaté et non plus une prévision.
        </p>
      </div>
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

function Entonnoir({ libelle, valeur, base }:
  { libelle: string; valeur: number; base: number }) {
  const pct = base > 0 ? (valeur / base) * 100 : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{libelle}</span>
        <span className="num">{valeur}<span className="statut"> · {pct.toFixed(0)} %</span></span>
      </div>
      <div className="jauge"><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
