import { supabase } from './supabase';
import { entrepriseId, membre } from './session';
import type { Intervention, Membre, Parametres } from './types';
import { frequence, tonnage, type FrequenceControle, type Machine } from './machines';

/**
 * La fiche d'intervention fluides — Cerfa 15497*04.
 *
 * Une fiche par machine et par intervention sur le fluide. Elle se remplit en
 * brouillon, se signe par le technicien — elle reçoit alors son numéro et se
 * fige —, puis par le client. Une fiche signée ne se corrige pas : on en
 * établit une rectificative, et les deux restent.
 *
 * Ce que ce module ne fait pas, la base le fait : l'attribution du numéro, la
 * copie figée des rubriques 1 à 3, les autocontrôles bloquants et
 * l'immuabilité vivent dans le SQL 33. L'écran ne doit pas être la seule
 * barrière, et il ne l'est pas.
 */

// --- Types ------------------------------------------------------------------

export type StatutFiche = 'brouillon' | 'signee_operateur' | 'signee' | 'rectifiee';

export type NatureFluide =
  | 'assemblage' | 'mise_en_service' | 'modification' | 'maintenance'
  | 'controle_periodique' | 'controle_non_periodique' | 'demantelement' | 'autre';

/** Les intitulés exacts de la rubrique 4 du Cerfa, dans son ordre. */
export const NATURES: { cle: NatureFluide; libelle: string }[] = [
  { cle: 'assemblage',              libelle: 'Assemblage de l’équipement' },
  { cle: 'mise_en_service',         libelle: 'Mise en service de l’équipement' },
  { cle: 'modification',            libelle: 'Modification de l’équipement' },
  { cle: 'maintenance',             libelle: 'Maintenance de l’équipement' },
  { cle: 'controle_periodique',     libelle: 'Contrôle d’étanchéité périodique' },
  { cle: 'controle_non_periodique', libelle: 'Contrôle d’étanchéité non périodique' },
  { cle: 'demantelement',           libelle: 'Démantèlement' },
  { cle: 'autre',                   libelle: 'Autre' },
];

export const LIBELLES_STATUT_FICHE: Record<StatutFiche, string> = {
  brouillon: 'Brouillon',
  signee_operateur: 'En attente du client',
  signee: 'Signée',
  rectifiee: 'Rectifiée',
};

export interface Fuite {
  localisation: string;
  reparation_faite: boolean;
  reparation_a_faire: boolean;
}

/** Rubrique 1, figée à la signature. */
export interface OperateurFige {
  raison_sociale?: string | null;
  adresse?: string | null;
  siret?: string | null;
  telephone?: string | null;
  portable?: string | null;
  attestation_capacite?: string | null;
  attestation_capacite_organisme?: string | null;
  attestation_capacite_categorie?: string | null;
  attestation_capacite_expire_le?: string | null;
  technicien?: {
    nom?: string | null;
    aptitude_fluides_num?: string | null;
    aptitude_fluides_expire_le?: string | null;
  };
}

/** Rubrique 2, figée à la signature. */
export interface DetenteurFige {
  nom?: string | null;
  siret?: string | null;
  telephone?: string | null;
  adresse?: string | null;
}

/** Rubrique 3, figée à la signature. */
export interface EquipementFige {
  marque?: string | null;
  modele?: string | null;
  numero_serie?: string | null;
  piece?: string | null;
  fluide?: string | null;
  prp?: number | null;
  charge_kg?: number | null;
  tonnage_co2?: number | null;
  hermetique?: boolean | null;
  puissance_kw?: number | null;
}

export interface FicheFluide {
  id: string;
  entreprise_id: string;
  numero: string | null;
  statut: StatutFiche;
  rectifie_id: string | null;
  equipement_id: string;
  intervention_id: string | null;
  chantier_id: string | null;
  tiers_id: string | null;
  site_id: string | null;
  technicien_id: string | null;
  operateur: OperateurFige;
  detenteur: DetenteurFige;
  equipement: EquipementFige;
  nature: NatureFluide[];
  nature_autre: string | null;
  detecteur_identification: string | null;
  detecteur_controle_le: string | null;
  detection_permanente: boolean | null;
  frequence_applicable: FrequenceControle | null;
  fuites_constatees: boolean | null;
  fuites: Fuite[];
  charge_vierge: number;
  charge_recyclee: number;
  charge_regeneree: number;
  recup_traitement: number;
  recup_reutilisation: number;
  /** Colonnes générées : A = B + C + D, E = F + G. */
  charge_totale: number;
  recup_totale: number;
  contenants: string | null;
  denomination_adr: string | null;
  destination: string | null;
  bsff: string | null;
  observations: string | null;
  signature_operateur_le: string | null;
  signature_operateur_nom: string | null;
  signature_detenteur_le: string | null;
  signature_detenteur_nom: string | null;
  date_intervention: string;
  created_at: string;
  updated_at: string;
}

/** Ce qu'une liste de fiches montre, sans recharger toute la fiche. */
export type FicheResumee = Pick<FicheFluide,
  'id' | 'numero' | 'statut' | 'equipement_id' | 'intervention_id' | 'chantier_id'
  | 'date_intervention' | 'nature' | 'equipement' | 'technicien_id' | 'rectifie_id'
  | 'signature_operateur_le' | 'created_at'>;

// --- Outils -----------------------------------------------------------------

function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** Les types d'intervention qui touchent au fluide, et la nature cochée d'office. */
export const NATURE_PAR_INTERVENTION: Partial<Record<Intervention['type'], NatureFluide[]>> = {
  mise_en_service: ['mise_en_service'],
  entretien: ['maintenance'],
  sav: ['maintenance'],
  controle_etancheite: ['controle_periodique'],
};

export const interventionSurFluide = (i: Pick<Intervention, 'type'>) =>
  i.type in NATURE_PAR_INTERVENTION;

// --- Lecture ------------------------------------------------------------------

const COLONNES_RESUME =
  'id, numero, statut, equipement_id, intervention_id, chantier_id, date_intervention, '
  + 'nature, equipement, technicien_id, rectifie_id, signature_operateur_le, created_at';

export async function listerFichesFluide(
  filtre: { chantierId?: string; equipementId?: string; interventionId?: string },
): Promise<FicheResumee[]> {
  let q = supabase.from('fiche_fluide').select(COLONNES_RESUME)
    .order('date_intervention', { ascending: false }).order('created_at', { ascending: false });
  if (filtre.chantierId) q = q.eq('chantier_id', filtre.chantierId);
  if (filtre.equipementId) q = q.eq('equipement_id', filtre.equipementId);
  if (filtre.interventionId) q = q.eq('intervention_id', filtre.interventionId);
  return ok(await q) as unknown as FicheResumee[];
}

export async function chargerFicheFluide(id: string): Promise<FicheFluide> {
  return ok(await supabase.from('fiche_fluide').select('*').eq('id', id).single());
}

/** La fiche qui en rectifie une autre, s'il y en a une. */
export async function rectificationDe(id: string): Promise<FicheResumee | null> {
  const r = ok(await supabase.from('fiche_fluide').select(COLONNES_RESUME)
    .eq('rectifie_id', id).limit(1)) as unknown as FicheResumee[];
  return r[0] ?? null;
}

// --- Création -----------------------------------------------------------------

/**
 * Crée une fiche en brouillon pour une machine.
 *
 * Le préremplissage des rubriques 1 à 3 est fait par la base
 * (`instantane_fiche_fluide`), pas ici : c'est la même fonction qui les figera
 * à la signature, et deux copies du même calcul finissent toujours par
 * diverger. Ici, on ne pose que ce que l'intervention apprend : la nature,
 * la date, et les quantités déjà notées.
 */
export async function creerFicheFluide(
  equipementId: string, intervention?: Pick<Intervention,
    'id' | 'type' | 'membre_id' | 'date_prevue' | 'charge_kg' | 'recuperee_kg'> | null,
): Promise<string> {
  const fiche = ok<{ id: string }>(await supabase.from('fiche_fluide').insert({
    entreprise_id: entrepriseId(),
    equipement_id: equipementId,
    intervention_id: intervention?.id ?? null,
    // Le technicien affecté à l'intervention, sinon celui qui crée la fiche.
    technicien_id: intervention?.membre_id ?? membre().id,
    nature: intervention ? (NATURE_PAR_INTERVENTION[intervention.type] ?? []) : [],
    date_intervention: intervention?.date_prevue ?? new Date().toISOString().slice(0, 10),
    charge_vierge: Number(intervention?.charge_kg ?? 0) || 0,
    recup_traitement: Number(intervention?.recuperee_kg ?? 0) || 0,
  }).select('id').single());
  await rafraichirFiche(fiche.id);
  return fiche.id;
}

/**
 * Une fiche par machine du chantier, pour une intervention.
 *
 * Une intervention sur trois machines donne trois fiches, identiques sauf la
 * machine. Celles qui existent déjà pour cette intervention ne sont pas
 * recréées : on rend leurs identifiants avec les nouvelles.
 */
export async function creerFichesPourIntervention(
  intervention: Pick<Intervention,
    'id' | 'type' | 'chantier_id' | 'membre_id' | 'date_prevue' | 'charge_kg' | 'recuperee_kg'>,
): Promise<{ creees: string[]; existantes: string[] }> {
  if (!intervention.chantier_id) {
    throw new Error('Cette intervention n’est rattachée à aucun chantier : ses machines sont inconnues.');
  }
  const machines = ok<{ id: string }[]>(await supabase.from('equipement')
    .select('id').eq('chantier_id', intervention.chantier_id).eq('statut', 'actif').order('rang'));
  if (machines.length === 0) {
    throw new Error('Aucune machine sur ce chantier. Ajoutez-les d’abord dans la section Machines.');
  }
  const deja = await listerFichesFluide({ interventionId: intervention.id });
  const parMachine = new Map(deja.filter((f) => f.statut !== 'rectifiee')
    .map((f) => [f.equipement_id, f.id]));

  const creees: string[] = [];
  for (const m of machines) {
    if (parMachine.has(m.id)) continue;
    creees.push(await creerFicheFluide(m.id, intervention));
  }
  return { creees, existantes: [...parMachine.values()] };
}

// --- Modification et signature ------------------------------------------------

/** Recalcule les rubriques 1 à 3 depuis la base. Sans effet sur une fiche signée. */
export async function rafraichirFiche(id: string): Promise<void> {
  ok(await supabase.rpc('instantane_fiche_fluide', { p_id: id }));
}

export async function majFicheFluide(id: string, patch: Partial<FicheFluide>): Promise<void> {
  // Les colonnes calculées ou posées par la base ne repartent jamais d'ici.
  const {
    charge_totale: _a, recup_totale: _e, numero: _n, statut: _s,
    operateur: _o, detenteur: _d, equipement: _q, ...modifiable
  } = patch;
  ok(await supabase.from('fiche_fluide').update(modifiable).eq('id', id).select('id'));
}

/** Ce qui manque encore, selon la base. Vide quand la signature est possible. */
export async function manquesFiche(id: string, pour: 'operateur' | 'detenteur'): Promise<string[]> {
  return ok(await supabase.rpc('manques_fiche_fluide', { p_id: id, p_pour: pour })) ?? [];
}

/**
 * Signe la fiche. Pour le technicien, rend le numéro attribué ; la fiche est
 * alors figée. L'image de signature doit avoir été déposée avant : la base
 * vérifie qu'elle existe.
 */
export async function signerFicheFluide(
  id: string, qui: 'operateur' | 'detenteur', nom?: string,
): Promise<string> {
  return ok(await supabase.rpc('signer_fiche_fluide', {
    p_id: id, p_qui: qui, p_nom: nom ?? null,
  }));
}

/** Crée la fiche rectificative et rend son identifiant. */
export async function rectifierFicheFluide(id: string): Promise<string> {
  return ok(await supabase.rpc('rectifier_fiche_fluide', { p_id: id }));
}

// --- Les autocontrôles, pour l'écran -------------------------------------------
//
// La même liste que `manques_fiche_fluide` en base, dans les mêmes termes.
// L'écran les calcule lui-même pour répondre à chaque frappe sans aller-retour ;
// la base les revérifie à la signature, et c'est elle qui a le dernier mot.

export interface Autocontrole {
  libelle: string;
  ok: boolean;
  /** Absent quand le contrôle ne s'applique pas à cette fiche. */
  sansObjet?: boolean;
}

export function autocontrolesFiche(
  f: Pick<FicheFluide, 'nature' | 'charge_vierge' | 'charge_recyclee' | 'charge_regeneree'
    | 'recup_traitement' | 'recup_reutilisation' | 'contenants' | 'destination' | 'bsff'
    | 'detecteur_identification' | 'detecteur_controle_le' | 'fuites_constatees'
    | 'date_intervention' | 'detection_permanente'>,
  machine: Pick<Machine, 'numero_serie' | 'charge_kg' | 'prp' | 'hermetique'
    | 'detection_permanente'> | null,
  plaquePhotographiee: boolean,
  technicien: Pick<Membre, 'aptitude_fluides_num' | 'aptitude_fluides_expire_le'> | null,
  parametres: Pick<Parametres, 'attestation_capacite' | 'attestation_capacite_expire_le'> | null,
  signatures: { operateur: boolean; detenteur: boolean },
): { controles: Autocontrole[]; pretPourSignature: boolean } {
  const date = f.date_intervention;
  const valide = (num: string | null | undefined, fin: string | null | undefined) =>
    Boolean(num?.trim()) && (!fin || fin >= date);

  const charge = Number(f.charge_vierge) + Number(f.charge_recyclee) + Number(f.charge_regeneree);
  const recup = Number(f.recup_traitement) + Number(f.recup_reutilisation);

  const freq = machine
    ? frequence(tonnage(machine.charge_kg, machine.prp), machine.hermetique,
                f.detection_permanente ?? machine.detection_permanente)
    : null;
  const controleExige = f.nature.includes('controle_periodique')
    || f.nature.includes('controle_non_periodique')
    || (freq != null && freq !== 'non_soumis');

  const controles: Autocontrole[] = [
    { libelle: 'Machine vérifiée : photo de la plaque et numéro de série',
      ok: Boolean(machine?.numero_serie?.trim()) && plaquePhotographiee },
    { libelle: 'Technicien titulaire d’une attestation d’aptitude valide',
      ok: valide(technicien?.aptitude_fluides_num, technicien?.aptitude_fluides_expire_le) },
    { libelle: 'Entreprise titulaire d’une attestation de capacité valide',
      ok: valide(parametres?.attestation_capacite, parametres?.attestation_capacite_expire_le) },
    { libelle: 'Nature de l’intervention cochée', ok: f.nature.length > 0 },
    { libelle: 'Fluide manipulé : contenant identifié, destination et BSFF si récupéré',
      ok: (charge === 0 || Boolean(f.contenants?.trim()))
        && (recup === 0 || (Boolean(f.destination?.trim()) && Boolean(f.bsff?.trim()))),
      sansObjet: charge === 0 && recup === 0 },
    { libelle: 'Contrôle d’étanchéité : détecteur, date de son contrôle, fuites constatées',
      ok: !controleExige || (Boolean(f.detecteur_identification?.trim())
        && Boolean(f.detecteur_controle_le) && f.fuites_constatees != null),
      sansObjet: !controleExige },
    { libelle: 'Signature du technicien', ok: signatures.operateur },
  ];

  // La signature du technicien est le dernier geste : on peut la poser dès
  // que les six premiers sont au vert.
  const pretPourSignature = controles.slice(0, 6).every((c) => c.ok);
  return { controles, pretPourSignature };
}
