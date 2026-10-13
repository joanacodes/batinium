import type {
  Devis, DevisLigne, DevisLot, Facture, FactureLigne, JustificationTva, Produit,
} from './types';
import { detecterAirAirEligible, determinerTva, type ContexteFiscal } from './tva';

/** Arrondi comptable au centime. Aucun flottant brut ne doit atteindre l’écran. */
export const c2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const eur = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

export interface LigneCalculee extends DevisLigne {
  numero: string;          // 1.6.4
  totalHt: number;
  montantTva: number;
  margeHt: number | null;  // interne, ne sort jamais sur le PDF client
  /** Ce que le moteur AURAIT appliqué. Renseigné même quand le taux est forcé,
   *  pour que l'éditeur puisse afficher l'écart et sa justification. */
  justificationAuto: JustificationTva;
}

export interface LotCalcule {
  lot: DevisLot;
  numero: string;          // 1 ou 1.6
  enfants: LotCalcule[];
  lignes: LigneCalculee[];
  totalHt: number;
}

export interface DevisCalcule {
  arbre: LotCalcule[];
  lignes: LigneCalculee[];
  sousTotalHt: number;
  remise: number;
  totalHt: number;
  ventilation: { taux: number; baseHt: number; montantTva: number }[];
  totalTva: number;
  totalTtc: number;
  mentions: string[];
  reserves: string[];
  /** Interne uniquement. */
  deboursSecHt: number | null;
  margeHt: number | null;
  margePct: number | null;
  echeances: { libelle: string; pourcentage: number; montant: number }[];
}

/**
 * Ordre des opérations, il compte :
 *   1. total de chaque ligne
 *   2. majoration de marge, absorbée par une ligne désignée
 *   3. sous-total
 *   4. remise globale, ventilée proportionnellement entre les taux
 *   5. TVA calculée sur les bases agrégées, jamais ligne à ligne
 */
export function calculerDevis(
  devis: Devis,
  lots: DevisLot[],
  lignes: DevisLigne[],
  produits: Map<string, Produit>,
  site: { usage_local: ContexteFiscal['usageLocal']; annee_achevement: number | null } | null,
): DevisCalcule {
  const avecProduit = lignes.map((l) => ({
    ...l,
    produit: l.produit_id ? produits.get(l.produit_id) ?? null : null,
  }));

  const base = {
    usageLocal: site?.usage_local ?? 'habitation',
    anneeAchevement: site?.annee_achevement ?? null,
    dateEmission: new Date(devis.date_emission),
    typePrestation: devis.type_prestation,
    nombreUnitesInterieures: avecProduit
      .filter((l) => l.produit && ['mono_split', 'multi_split', 'gainable', 'console', 'cassette']
        .includes(l.produit.famille))
      .reduce((s, l) => s + Number(l.quantite), 0),
  };

  const ctx: ContexteFiscal = {
    ...base,
    airAirEligible: detecterAirAirEligible(avecProduit, base),
  };

  // 1. Lignes
  const calculees: LigneCalculee[] = avecProduit.map((l) => {
    const brut = Number(l.quantite) * Number(l.prix_unitaire_ht);
    const totalHt = c2(brut * (1 - Number(l.remise_pct) / 100));
    const auto = determinerTva(l, ctx);
    const justification = l.taux_force ? l.justification_tva ?? auto : auto;
    const taux = l.taux_force ? Number(l.taux_tva) : auto.taux;
    const achat = l.prix_achat_ht != null ? Number(l.prix_achat_ht) * Number(l.quantite) : null;

    return {
      ...l,
      numero: '',
      taux_tva: taux,
      justification_tva: justification,
      totalHt,
      montantTva: c2((totalHt * taux) / 100),
      margeHt: achat != null ? c2(totalHt - achat) : null,
      justificationAuto: auto,
    };
  });

  // 2. Marge, absorbée par une ligne (la manutention, en général)
  if (devis.marge_mode !== 'aucune' && Number(devis.marge_valeur) > 0) {
    const sousTotal = calculees.reduce((s, l) => s + l.totalHt, 0);
    const majoration =
      devis.marge_mode === 'pourcentage'
        ? c2((sousTotal * Number(devis.marge_valeur)) / 100)
        : c2(Number(devis.marge_valeur));

    const cible =
      calculees.find((l) => l.id === devis.marge_cible_ligne) ??
      [...calculees].reverse().find((l) => l.nature !== 'fourniture') ??
      calculees[calculees.length - 1];

    if (cible) {
      cible.totalHt = c2(cible.totalHt + majoration);
      cible.prix_unitaire_ht = c2(cible.totalHt / (Number(cible.quantite) || 1));
      cible.montantTva = c2((cible.totalHt * cible.taux_tva) / 100);
      if (cible.margeHt != null) cible.margeHt = c2(cible.margeHt + majoration);
    }
  }

  // 3. Sous-total et 4. remise ventilée
  const sousTotalHt = c2(calculees.reduce((s, l) => s + l.totalHt, 0));
  const remise = c2(Number(devis.remise_montant) || 0);
  const totalHt = c2(sousTotalHt - remise);
  const ratio = sousTotalHt > 0 ? totalHt / sousTotalHt : 1;

  // 5. TVA sur bases agrégées
  const bases = new Map<number, number>();
  for (const l of calculees) {
    bases.set(l.taux_tva, c2((bases.get(l.taux_tva) ?? 0) + l.totalHt * ratio));
  }
  const ventilation = [...bases.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([taux, baseHt]) => ({ taux, baseHt, montantTva: c2((baseHt * taux) / 100) }));

  const totalTva = c2(ventilation.reduce((s, v) => s + v.montantTva, 0));
  const totalTtc = c2(totalHt + totalTva);

  // Mentions et réserves, dédupliquées
  const mentions = new Set<string>();
  const reserves = new Set<string>();
  for (const l of calculees) {
    if (l.justification_tva?.mention) mentions.add(l.justification_tva.mention);
    if (l.justification_tva?.reserve) reserves.add(l.justification_tva.reserve);
  }

  // Marge interne
  const avecAchat = calculees.filter((l) => l.margeHt != null);
  const deboursSecHt = avecAchat.length
    ? c2(avecAchat.reduce((s, l) => s + (l.totalHt - l.margeHt!), 0))
    : null;
  const margeHt = avecAchat.length ? c2(avecAchat.reduce((s, l) => s + l.margeHt!, 0)) : null;

  const arbre = construireArbre(lots, calculees);

  const echeances = (devis.echeancier ?? []).map((e) => ({
    ...e,
    montant: c2((totalTtc * e.pourcentage) / 100),
  }));

  return {
    arbre,
    lignes: calculees,
    sousTotalHt,
    remise,
    totalHt,
    ventilation,
    totalTva,
    totalTtc,
    mentions: [...mentions],
    reserves: [...reserves],
    deboursSecHt,
    margeHt,
    margePct: margeHt != null && totalHt > 0 ? c2((margeHt / totalHt) * 100) : null,
    echeances,
  };
}

/** Construit l’arbre lot > sous-lot > ligne et numérote 1, 1.6, 1.6.4. */
function construireArbre(lots: DevisLot[], lignes: LigneCalculee[]): LotCalcule[] {
  const parPère = new Map<string | null, DevisLot[]>();
  for (const l of lots) {
    const k = l.parent_id;
    if (!parPère.has(k)) parPère.set(k, []);
    parPère.get(k)!.push(l);
  }
  for (const v of parPère.values()) v.sort((a, b) => a.position - b.position);

  const construire = (parent: string | null, prefixe: string): LotCalcule[] =>
    (parPère.get(parent) ?? []).map((lot, i) => {
      const numero = prefixe ? `${prefixe}.${i + 1}` : `${i + 1}`;
      const enfants = construire(lot.id, numero);
      const propres = lignes
        .filter((l) => l.lot_id === lot.id)
        .sort((a, b) => a.position - b.position)
        .map((l, j) => {
          l.numero = `${numero}.${j + 1}`;
          return l;
        });
      const totalHt = c2(
        propres.reduce((s, l) => s + l.totalHt, 0) + enfants.reduce((s, e) => s + e.totalHt, 0),
      );
      return { lot, numero, enfants, lignes: propres, totalHt };
    });

  return construire(null, '');
}


// --- Facture ----------------------------------------------------------------

export interface LigneFactureCalculee {
  ligne: FactureLigne;
  totalHt: number;
}

export interface FactureCalculee {
  lignes: LigneFactureCalculee[];
  sousTotalHt: number;
  remise: number;
  totalHt: number;
  ventilation: { taux: number; baseHt: number; montantTva: number }[];
  totalTva: number;
  totalTtc: number;
  acompteDeduit: number;
  netAPayer: number;
}

/**
 * Le total d'une facture.
 *
 * Même ordre d'opérations que pour un devis, et pour la même raison : la
 * remise globale se ventile proportionnellement entre les taux avant que la
 * TVA ne soit calculée sur les bases agrégées. Calculer la TVA ligne à ligne
 * puis additionner donne un écart de quelques centimes, et un écart de
 * quelques centimes sur une déclaration se remarque.
 *
 * L'acompte déjà facturé se déduit du net à payer, pas de la base taxable :
 * sa TVA a été collectée sur la facture d'acompte.
 */
export function calculerFacture(facture: Facture, lignes: FactureLigne[]): FactureCalculee {
  const calculees = [...lignes]
    .sort((a, b) => a.position - b.position)
    .map((ligne) => ({
      ligne,
      totalHt: c2(Number(ligne.quantite) * Number(ligne.prix_unitaire_ht)
        * (1 - Number(ligne.remise_pct) / 100)),
    }));

  const sousTotalHt = c2(calculees.reduce((s, l) => s + l.totalHt, 0));
  const remise = c2(Math.min(Number(facture.remise_montant) || 0, sousTotalHt));
  const totalHt = c2(sousTotalHt - remise);
  const facteur = sousTotalHt > 0 ? totalHt / sousTotalHt : 1;

  const bases = new Map<number, number>();
  for (const l of calculees) {
    const taux = Number(l.ligne.taux_tva);
    bases.set(taux, (bases.get(taux) ?? 0) + l.totalHt * facteur);
  }

  const ventilation = [...bases.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([taux, base]) => ({
      taux,
      baseHt: c2(base),
      montantTva: c2(c2(base) * taux / 100),
    }));

  const totalTva = c2(ventilation.reduce((s, v) => s + v.montantTva, 0));
  const totalTtc = c2(totalHt + totalTva);
  const acompteDeduit = c2(Number(facture.acompte_deduit) || 0);

  return {
    lignes: calculees,
    sousTotalHt, remise, totalHt,
    ventilation, totalTva, totalTtc,
    acompteDeduit,
    netAPayer: c2(totalTtc - acompteDeduit),
  };
}
