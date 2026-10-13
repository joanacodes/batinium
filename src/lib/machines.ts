import { supabase } from './supabase';
import { entrepriseId, membre } from './session';
import type { Chantier, Equipement, Produit } from './types';

/**
 * Le registre des machines.
 *
 * La fiche Cerfa des fluides, le carnet de mise en service et l'entretien
 * partent tous d'une machine identifiée. Ce module en tient le registre :
 * création depuis le devis signé, vérification sur place par la plaque,
 * calculs réglementaires.
 *
 * Il vit à part de `db.ts` pour une raison de livraison, pas d'architecture :
 * la phase 1 a été écrite sans la version courante de `db.ts` sous les yeux,
 * et l'ajouter à un fichier qu'on ne voit pas, c'était risquer d'en écraser
 * un mois de travail. Rien n'empêche de l'y fusionner ensuite.
 */

// --- Types ------------------------------------------------------------------

/** Une machine, avec ce que le SQL 32 a ajouté à `equipement`. */
export interface Machine extends Equipement {
  puissance_kw: number | null;
  hermetique: boolean;
  prp: number | null;
  piece: string | null;
  verifie_le: string | null;
  verifie_par: string | null;
  garantie_pieces_fin: string | null;
  detection_permanente: boolean;
  devis_ligne_id: string | null;
  rang: number;
  /** Colonne générée : charge_kg × prp ÷ 1000. */
  tonnage_co2: number | null;
}

export type MachineAvecChantier = Machine & {
  chantier: Pick<Chantier, 'id' | 'numero' | 'libelle' | 'tiers_id'> | null;
};

export interface FluideFrigorigene {
  code: string;
  libelle: string;
  prp: number;
  denomination_adr: string | null;
  actif: boolean;
}

export type FrequenceControle = 'non_soumis' | '24_mois' | '12_mois' | '6_mois' | '3_mois';

export const LIBELLES_FREQUENCE: Record<FrequenceControle, string> = {
  non_soumis: 'Non soumis',
  '24_mois': 'Tous les 24 mois',
  '12_mois': 'Tous les 12 mois',
  '6_mois': 'Tous les 6 mois',
  '3_mois': 'Tous les 3 mois',
};

/** Les familles du catalogue qui sont des machines, et non des fournitures. */
export const FAMILLES_MACHINE = [
  'mono_split', 'multi_split', 'gainable', 'console', 'cassette', 'groupe_eau',
] as const;

// --- Outils -----------------------------------------------------------------

function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/**
 * « R-32 », « r32 », « R32 » : trois façons d'écrire le même fluide dans un
 * catalogue. Sans normalisation, la recherche du PRP échouerait en silence et
 * le tonnage resterait vide.
 */
export function codeFluide(brut: string | null | undefined): string | null {
  if (!brut) return null;
  const code = brut.toUpperCase().replace(/[\s-]/g, '');
  return code || null;
}

// --- Calculs réglementaires --------------------------------------------------
//
// Les mêmes que les fonctions SQL `tonnage_co2` et `frequence_controle` du
// script 32. Ils sont refaits ici pour un affichage immédiat pendant la
// saisie ; la base reste la référence, c'est elle que lit la fiche signée.

export function tonnage(chargeKg: number | null, prp: number | null): number | null {
  if (chargeKg == null || prp == null) return null;
  return Math.round(Number(chargeKg) * prp) / 1000;
}

export function frequence(
  tonnageCo2: number | null, hermetique: boolean, detection: boolean,
): FrequenceControle | null {
  if (tonnageCo2 == null) return null;
  if (tonnageCo2 < (hermetique ? 10 : 5)) return 'non_soumis';
  let mois = tonnageCo2 < 50 ? 12 : tonnageCo2 < 500 ? 6 : 3;
  if (detection) mois *= 2;
  return `${mois}_mois` as FrequenceControle;
}

/** En mois, pour calculer une échéance. Nul si la machine n'est pas soumise. */
export function moisFrequence(f: FrequenceControle | null): number | null {
  if (!f || f === 'non_soumis') return null;
  return Number(f.split('_')[0]);
}

/**
 * La date du prochain entretien.
 *
 * Décret n° 2020-912 du 28 juillet 2020 : tous les deux ans pour une pompe à
 * chaleur de 4 à 70 kW. En dessous, rien n'est imposé ; on propose un an, ce
 * que recommande le carnet de Pilotech. Sans date de mise en service, pas de
 * date : une échéance inventée serait pire qu'une case vide.
 */
export function prochainEntretien(m: Pick<Machine, 'mise_en_service_le' | 'puissance_kw'>):
  string | null {
  if (!m.mise_en_service_le) return null;
  const d = new Date(m.mise_en_service_le);
  const kw = m.puissance_kw == null ? null : Number(m.puissance_kw);
  d.setFullYear(d.getFullYear() + (kw != null && kw >= 4 && kw <= 70 ? 2 : 1));
  return d.toISOString().slice(0, 10);
}

/** L'entretien est-il une obligation, ou seulement un conseil ? */
export function entretienObligatoire(m: Pick<Machine, 'puissance_kw'>): boolean {
  const kw = m.puissance_kw == null ? null : Number(m.puissance_kw);
  return kw != null && kw >= 4 && kw <= 70;
}

// --- Lecture ------------------------------------------------------------------

export async function listerFluides(): Promise<FluideFrigorigene[]> {
  return ok(await supabase.from('fluide_frigorigene').select('*').order('code'));
}

/**
 * Les machines d'un chantier, ou toutes celles d'un client.
 *
 * Pour un client, on passe par ses chantiers et ses sites : une machine
 * reprise en entretien n'a parfois qu'un site, pas de chantier.
 */
export async function listerMachines(
  filtre: { chantierId?: string; tiersId?: string; ids?: string[] },
): Promise<MachineAvecChantier[]> {
  let q = supabase.from('equipement')
    .select('*, chantier:chantier_id(id, numero, libelle, tiers_id), site:site_id(tiers_id)')
    .order('rang');
  if (filtre.chantierId) q = q.eq('chantier_id', filtre.chantierId);
  if (filtre.ids) q = q.in('id', filtre.ids);
  const lignes = ok(await q) as (MachineAvecChantier & { site: { tiers_id: string } | null })[];
  if (!filtre.tiersId) return lignes;
  return lignes.filter((m) =>
    m.chantier?.tiers_id === filtre.tiersId || m.site?.tiers_id === filtre.tiersId);
}

export async function chargerMachine(id: string): Promise<MachineAvecChantier> {
  return ok(await supabase.from('equipement')
    .select('*, chantier:chantier_id(id, numero, libelle, tiers_id)').eq('id', id).single());
}

/** Les machines dont la plaque a été photographiée. */
export async function machinesAvecPlaque(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const docs = ok<{ equipement_id: string }[]>(await supabase.from('document')
    .select('equipement_id').eq('type', 'plaque_signaletique').in('equipement_id', ids));
  return new Set(docs.map((d) => d.equipement_id));
}

/**
 * Les produits d'un chantier dont une ligne d'achat a été rapprochée.
 *
 * Sert à l'indicateur « facture ≠ devis ». Un technicien n'a pas accès aux
 * achats : la base lui rend une liste vide, et l'écran ne doit alors rien
 * conclure — d'où le `null`, distinct d'un ensemble vide.
 */
export async function produitsFactures(chantierId: string): Promise<Set<string> | null> {
  const { data, error } = await supabase.from('achat_ligne')
    .select('produit_id').eq('chantier_id', chantierId)
    .not('approvisionnement_id', 'is', null);
  if (error) return null;
  return new Set((data ?? []).map((l) => l.produit_id).filter(Boolean) as string[]);
}

// --- Création depuis le devis -------------------------------------------------

/**
 * Une machine par unité vendue, à la signature du devis.
 *
 * Une ligne de quantité 2 donne deux machines : chacune aura son numéro de
 * série, sa fiche Cerfa, son entretien. Le numéro de série reste vide — il se
 * relève sur la plaque, qui fait foi. La charge aussi : le catalogue ne la
 * porte pas, et une charge recopiée d'une fiche commerciale n'est pas celle
 * de l'appareil posé.
 *
 * Idempotente : rejouée, elle ne recrée pas une machine dont la ligne et le
 * rang existent déjà. La base l'impose aussi par un index unique.
 */
export async function machinesDepuisDevis(devisId: string, chantierId: string): Promise<number> {
  const chantier = ok<Pick<Chantier, 'id' | 'site_id'>>(await supabase.from('chantier')
    .select('id, site_id').eq('id', chantierId).single());

  // Le client Supabase type une jointure comme un tableau ; c'est une relation
  // à un seul produit, d'où la conversion.
  const lignes = ok(await supabase.from('devis_ligne')
    .select('id, quantite, designation, emplacement, produit:produit_id(id, famille, designation, fluide, puissance_kw)')
    .eq('devis_id', devisId).order('position')) as unknown as {
      id: string; quantite: number; designation: string; emplacement: string | null;
      produit: Pick<Produit, 'id' | 'famille' | 'designation' | 'fluide' | 'puissance_kw'> | null;
    }[];

  const existantes = ok<{ devis_ligne_id: string; rang: number }[]>(await supabase
    .from('equipement').select('devis_ligne_id, rang')
    .eq('chantier_id', chantierId).not('devis_ligne_id', 'is', null));
  const deja = new Set(existantes.map((e) => `${e.devis_ligne_id}:${e.rang}`));

  const prp = new Map((await listerFluides().catch(() => [])).map((f) => [f.code, f.prp]));

  const aCreer: Partial<Machine>[] = [];
  for (const l of lignes) {
    const p = l.produit;
    if (!p || !(FAMILLES_MACHINE as readonly string[]).includes(p.famille)) continue;
    // Une quantité de 2,0 vaut deux machines ; une quantité fractionnaire sur
    // une machine est une erreur de saisie, on en crée au moins une.
    const unites = Math.max(1, Math.round(Number(l.quantite)));
    const fluide = codeFluide(p.fluide);
    for (let rang = 1; rang <= unites; rang++) {
      if (deja.has(`${l.id}:${rang}`)) continue;
      aCreer.push({
        entreprise_id: entrepriseId(),
        chantier_id: chantierId,
        site_id: chantier.site_id,
        produit_id: p.id,
        devis_ligne_id: l.id,
        rang,
        // Le catalogue n'a pas de colonne marque : la désignation entière va
        // dans le modèle, et la plaque la corrigera.
        marque: null,
        modele: p.designation,
        fluide,
        prp: fluide ? prp.get(fluide) ?? null : null,
        puissance_kw: p.puissance_kw,
        piece: l.emplacement,
        numero_serie: null,
        statut: 'actif',
      });
    }
  }

  if (aCreer.length) ok(await supabase.from('equipement').insert(aCreer).select('id'));
  return aCreer.length;
}

// --- Vérification sur place ---------------------------------------------------

export type SaisieMachine = Partial<Pick<Machine,
  'numero_serie' | 'marque' | 'modele' | 'fluide' | 'charge_kg' | 'hermetique' | 'piece'
  | 'puissance_kw' | 'detection_permanente' | 'emplacement' | 'mise_en_service_le'>>;

/**
 * Enregistre ce qu'on a lu sur la plaque.
 *
 * La vérification n'est posée que si la machine est réellement identifiable :
 * un numéro de série ET une photo de la plaque. Sinon on enregistre quand
 * même — une saisie partielle vaut mieux que rien — mais le jeton « vérifiée »
 * mentirait, et c'est lui que la fiche Cerfa exige.
 */
export async function verifierMachine(id: string, saisie: SaisieMachine): Promise<{
  verifiee: boolean;
}> {
  const fluide = codeFluide(saisie.fluide);
  const prp = fluide
    ? (await listerFluides().catch(() => [])).find((f) => f.code === fluide)?.prp ?? null
    : null;
  const plaque = (await machinesAvecPlaque([id])).has(id);
  const verifiee = Boolean(saisie.numero_serie?.trim()) && plaque;

  ok(await supabase.from('equipement').update({
    ...saisie,
    numero_serie: saisie.numero_serie?.trim() || null,
    fluide,
    prp,
    ...(verifiee ? { verifie_le: new Date().toISOString(), verifie_par: membre().id } : {}),
  }).eq('id', id).select('id'));

  return { verifiee };
}

/**
 * Une machine hors devis : un appareil existant repris en entretien, ou posé
 * sur un chantier sans devis détaillé.
 */
export async function ajouterMachine(
  cible: { chantierId?: string | null; siteId?: string | null }, saisie: SaisieMachine,
): Promise<Machine> {
  const fluide = codeFluide(saisie.fluide);
  const prp = fluide
    ? (await listerFluides().catch(() => [])).find((f) => f.code === fluide)?.prp ?? null
    : null;
  return ok(await supabase.from('equipement').insert({
    entreprise_id: entrepriseId(),
    chantier_id: cible.chantierId ?? null,
    site_id: cible.siteId ?? null,
    ...saisie,
    fluide,
    prp,
    statut: 'actif',
  }).select().single());
}

/** Pose la mise en service et ce qui en découle : garantie et prochain entretien. */
export async function mettreEnService(id: string, date = aujourdhui()): Promise<void> {
  const m = await chargerMachine(id);
  const fin = new Date(date);
  fin.setFullYear(fin.getFullYear() + 2);
  ok(await supabase.from('equipement').update({
    mise_en_service_le: date,
    garantie_pieces_fin: m.garantie_pieces_fin ?? fin.toISOString().slice(0, 10),
    prochain_entretien_le: m.prochain_entretien_le
      ?? prochainEntretien({ mise_en_service_le: date, puissance_kw: m.puissance_kw }),
  }).eq('id', id).select('id'));
}

/**
 * La machine correspond-elle à une facture fournisseur rapprochée ?
 *
 * Vrai si une ligne d'achat rapprochée porte le même produit sur le même
 * chantier. Faux sinon. Nul quand on ne peut pas savoir : machine sans produit
 * du catalogue, ou utilisateur sans accès aux achats. Ce n'est pas bloquant ;
 * c'est la plaque qui fait foi, la facture ne fait que confirmer.
 */
export async function coherenceAchat(equipementId: string): Promise<boolean | null> {
  const m = await chargerMachine(equipementId);
  if (!m.produit_id || !m.chantier_id) return null;
  const factures = await produitsFactures(m.chantier_id);
  return factures === null ? null : factures.has(m.produit_id);
}
