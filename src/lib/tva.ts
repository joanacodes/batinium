import type {
  Critere,
  DevisLigne,
  Famille,
  JustificationTva,
  Produit,
  TypePrestation,
  UsageLocal,
} from './types';

/**
 * LES RÈGLES SONT DES DONNÉES.
 * Le 18 juillet 2026 a fait basculer les PAC air/air de 20 % à 5,5 % en pleine
 * saison. Ici on ajoute une entrée dans le tableau, on ne réécrit rien.
 *
 * On ne supprime jamais une règle : on la clôture avec `au`. Il faut pouvoir
 * rejustifier un devis d'il y a deux ans.
 *
 * Le moteur ne retourne jamais un taux seul. Il retourne le POURQUOI.
 */

/** Matériel de climatisation : « gros équipement » au sens de l'art. 30-00 A ann. IV CGI.
 *  Reste à 20 % même en logement ancien, sauf éligibilité au 5,5 %. */
const GROS_EQUIPEMENT: Famille[] = [
  'groupe_eau', 'mono_split', 'multi_split', 'gainable',
  'console', 'cassette', 'accessoire', 'fourniture',
];

export interface ContexteFiscal {
  usageLocal: UsageLocal;
  anneeAchevement: number | null;
  dateEmission: Date;
  typePrestation: TypePrestation;
  /** Le devis comporte-t-il au moins un air/air éligible ? La pose suit l'équipement. */
  airAirEligible: boolean;
  nombreUnitesInterieures: number;
}

type Entree = Pick<DevisLigne, 'nature' | 'designation'> & { produit?: Produit | null };

const ok = (satisfait: boolean, constate: string) => ({ satisfait, constate });

// --- Critères ---------------------------------------------------------------

const habitation = {
  code: 'HABITATION',
  libelle: 'Local à usage d’habitation',
  attendu: 'habitation ou mixte',
  test: (_l: Entree, c: ContexteFiscal) =>
    ok(c.usageLocal !== 'professionnel', c.usageLocal),
};

const plusDeDeuxAns = {
  code: 'DEUX_ANS',
  libelle: 'Logement achevé depuis plus de deux ans',
  attendu: 'achèvement > 2 ans',
  test: (_l: Entree, c: ContexteFiscal) => {
    if (c.anneeAchevement == null) return ok(false, 'année d’achèvement inconnue');
    const age = c.dateEmission.getFullYear() - c.anneeAchevement;
    return ok(age > 2, `${age} ans (achevé en ${c.anneeAchevement})`);
  },
};

const travauxInstallation = {
  code: 'INSTALLATION',
  libelle: 'Prestation d’installation',
  attendu: 'installation ou mise en service',
  test: (_l: Entree, c: ContexteFiscal) =>
    ok(['installation', 'mise_en_service'].includes(c.typePrestation), c.typePrestation),
};

const travauxImmobiliers = {
  code: 'TRAVAUX',
  libelle: 'Travaux d’amélioration, d’aménagement ou d’entretien',
  attendu: 'installation, entretien ou dépannage',
  test: (_l: Entree, c: ContexteFiscal) => ok(true, c.typePrestation),
};

const mainOeuvre = {
  code: 'MAIN_OEUVRE',
  libelle: 'Ligne de main-d’œuvre ou de déplacement',
  attendu: 'nature pose ou déplacement',
  test: (l: Entree) => ok(l.nature !== 'fourniture', l.nature),
};

const fourniture = {
  code: 'FOURNITURE',
  libelle: 'Ligne de fourniture',
  attendu: 'nature fourniture',
  test: (l: Entree) => ok(l.nature === 'fourniture', l.nature),
};

const grosEquipement = {
  code: 'GROS_EQUIPEMENT',
  libelle: 'Matériel de climatisation (gros équipement)',
  attendu: 'famille matériel de climatisation',
  test: (l: Entree) => {
    const f = l.produit?.famille;
    return ok(f != null && GROS_EQUIPEMENT.includes(f), f ?? 'sans produit');
  },
};

const pasGrosEquipement = {
  code: 'HORS_GROS_EQUIPEMENT',
  libelle: 'Fourniture hors matériel de climatisation',
  attendu: 'plomberie, électricité ou assimilé',
  test: (l: Entree) => {
    const f = l.produit?.famille;
    return ok(f != null && !GROS_EQUIPEMENT.includes(f), f ?? 'sans produit');
  },
};

/** Le cœur du 5,5 % : arrêté du 13 juillet 2026. */
const airAirEligibleLigne = {
  code: 'AIR_AIR_ELIGIBLE',
  libelle: 'PAC air/air fixe, réversible, connectée, ≤ 12 kW, classe conforme',
  attendu: 'fixe + réversible + connectée + ≤ 12 kW + A++ (mono) ou A+ (multi)',
  test: (l: Entree, c: ContexteFiscal) => {
    const p = l.produit;
    if (!p) return ok(false, 'ligne libre, sans produit rattaché');
    const familles: Famille[] = ['mono_split', 'multi_split', 'gainable', 'console', 'cassette'];
    if (!familles.includes(p.famille)) return ok(false, `famille ${p.famille}`);

    const manques: string[] = [];
    if (p.fixe !== true) manques.push('non fixe');
    if (p.reversible !== true) manques.push('non réversible');
    if (p.connecte !== true) manques.push('non connecté');
    if (p.puissance_kw == null) manques.push('puissance inconnue');
    else if (p.puissance_kw > 12) manques.push(`${p.puissance_kw} kW > 12 kW`);

    const multi = c.nombreUnitesInterieures > 1 || p.famille === 'multi_split';
    const requise = multi ? 'A+' : 'A++';
    const rang = (cl: string | null) => ['A', 'A+', 'A++', 'A+++'].indexOf(cl ?? '');
    if (rang(p.classe_froid) < rang(requise)) {
      manques.push(
        `classe ${p.classe_froid ?? 'inconnue'} < ${requise} (${multi ? 'multi' : 'mono'}-split)`,
      );
    }

    return manques.length === 0
      ? ok(true, `${p.puissance_kw} kW, ${p.classe_froid}, ${p.fluide ?? 'fluide n.c.'}, connecté`)
      : ok(false, manques.join(' ; '));
  },
};

/** Pour la pose : le taux suit l'équipement principal du devis. */
const poseSuitAirAir = {
  code: 'POSE_SUIT_EQUIPEMENT',
  libelle: 'Le devis porte un équipement air/air éligible',
  attendu: 'au moins une fourniture éligible au 5,5 %',
  test: (_l: Entree, c: ContexteFiscal) =>
    ok(c.airAirEligible, c.airAirEligible ? 'oui' : 'aucun équipement éligible'),
};

// --- Le catalogue de règles. L'ordre vaut priorité. -------------------------

interface Regle {
  code: string;
  libelle: string;
  taux: number;
  baseLegale: string;
  du: string;
  au?: string;
  mention: string;
  reserve?: string;
  criteres: { code: string; libelle: string; attendu: string;
    test: (l: Entree, c: ContexteFiscal) => { satisfait: boolean; constate: string } }[];
}

export const REGLES: Regle[] = [
  {
    code: 'AIR_AIR_5_5',
    libelle: 'PAC air/air réversible — matériel',
    taux: 5.5,
    baseLegale: 'Art. 278-0 bis A CGI ; arrêté du 13 juillet 2026',
    du: '2026-07-18',
    mention:
      'TVA à 5,5 % — travaux d’amélioration de la qualité énergétique (art. 278-0 bis A du CGI). ' +
      'Le client atteste que le logement est achevé depuis plus de deux ans.',
    reserve:
      'Périmètre à confirmer avec l’expert-comptable : les sources divergent sur l’application ' +
      'du 5,5 % à la main-d’œuvre.',
    criteres: [habitation, plusDeDeuxAns, travauxInstallation, fourniture, airAirEligibleLigne],
  },
  {
    code: 'AIR_AIR_POSE_5_5',
    libelle: 'PAC air/air réversible — pose associée',
    taux: 5.5,
    baseLegale: 'Art. 278-0 bis A CGI ; arrêté du 13 juillet 2026',
    du: '2026-07-18',
    mention:
      'TVA à 5,5 % — travaux d’amélioration de la qualité énergétique (art. 278-0 bis A du CGI). ' +
      'Le client atteste que le logement est achevé depuis plus de deux ans.',
    reserve:
      'Périmètre à confirmer avec l’expert-comptable : les sources divergent sur l’application ' +
      'du 5,5 % à la main-d’œuvre.',
    criteres: [habitation, plusDeDeuxAns, travauxInstallation, mainOeuvre, poseSuitAirAir],
  },
  {
    code: 'MAIN_OEUVRE_10',
    libelle: 'Main-d’œuvre en logement de plus de deux ans',
    taux: 10,
    baseLegale: 'Art. 279-0 bis CGI',
    du: '2014-01-01',
    mention:
      'TVA à 10 % — travaux d’amélioration, de transformation, d’aménagement ou d’entretien ' +
      '(art. 279-0 bis du CGI). Locaux achevés depuis plus de deux ans à la date de début des travaux.',
    criteres: [habitation, plusDeDeuxAns, travauxImmobiliers, mainOeuvre],
  },
  {
    code: 'GROS_EQUIPEMENT_20',
    libelle: 'Matériel de climatisation — gros équipement',
    taux: 20,
    baseLegale: 'Art. 30-00 A annexe IV CGI',
    du: '2014-01-01',
    mention: '',
    reserve:
      'Le classement des fournitures froid et accessoires en gros équipement est retenu par ' +
      'prudence. À faire trancher : certaines pourraient relever du taux de 10 %.',
    criteres: [fourniture, grosEquipement],
  },
  {
    code: 'FOURNITURE_10',
    libelle: 'Fourniture hors gros équipement, logement de plus de deux ans',
    taux: 10,
    baseLegale: 'Art. 279-0 bis CGI',
    du: '2014-01-01',
    mention:
      'TVA à 10 % — travaux d’amélioration, de transformation, d’aménagement ou d’entretien ' +
      '(art. 279-0 bis du CGI). Locaux achevés depuis plus de deux ans à la date de début des travaux.',
    criteres: [habitation, plusDeDeuxAns, travauxImmobiliers, fourniture, pasGrosEquipement],
  },
  {
    // Filet. Aucun critère, matche toujours. Doit rester en dernier.
    code: 'NORMAL_20',
    libelle: 'Taux normal',
    taux: 20,
    baseLegale: 'Art. 278 CGI',
    du: '2014-01-01',
    mention: '',
    criteres: [],
  },
];

// --- Évaluation -------------------------------------------------------------

function active(r: Regle, d: Date): boolean {
  const jour = d.toISOString().slice(0, 10);
  return jour >= r.du && (!r.au || jour <= r.au);
}

export function determinerTva(ligne: Entree, ctx: ContexteFiscal): JustificationTva {
  for (const regle of REGLES) {
    if (!active(regle, ctx.dateEmission)) continue;

    const criteres: Critere[] = regle.criteres.map((c) => {
      const r = c.test(ligne, ctx);
      return { code: c.code, libelle: c.libelle, attendu: c.attendu, ...r };
    });

    if (criteres.every((c) => c.satisfait)) {
      return {
        regle: regle.code,
        libelle: regle.libelle,
        baseLegale: regle.baseLegale,
        taux: regle.taux,
        criteres,
        mention: regle.mention,
        reserve: regle.reserve ?? null,
      };
    }
  }
  throw new Error('Aucune règle applicable. La règle filet NORMAL_20 a-t-elle été retirée ?');
}

/** Pourquoi cette ligne n’atteint-elle pas le taux réduit ? Affiché dans l’éditeur. */
export function pourquoiPas(ligne: Entree, ctx: ContexteFiscal, code: string): string[] {
  const regle = REGLES.find((r) => r.code === code);
  if (!regle) return [`Règle inconnue : ${code}`];
  if (!active(regle, ctx.dateEmission)) {
    return [`Règle non applicable au ${ctx.dateEmission.toISOString().slice(0, 10)}`];
  }
  return regle.criteres
    .map((c) => ({ c, r: c.test(ligne, ctx) }))
    .filter((x) => !x.r.satisfait)
    .map((x) => `${x.c.libelle} — attendu : ${x.c.attendu} ; constaté : ${x.r.constate}`);
}

/** Un devis porte-t-il un air/air éligible ? Détermine le taux des lignes de pose. */
export function detecterAirAirEligible(
  lignes: Entree[],
  ctx: Omit<ContexteFiscal, 'airAirEligible'>,
): boolean {
  const complet: ContexteFiscal = { ...ctx, airAirEligible: false };
  return lignes.some(
    (l) => l.nature === 'fourniture' && airAirEligibleLigne.test(l, complet).satisfait,
  );
}
