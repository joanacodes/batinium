import { supabase } from './supabase';
import { entrepriseId } from './session';
import type { ContratEntretien, Intervention } from './types';

/**
 * Les contrats d'entretien (SQL 37).
 *
 * L'échéance avance seule, en base, quand la visite rattachée au contrat est
 * terminée : l'écran n'a jamais à la recalculer, et personne ne peut oublier
 * de le faire.
 */

function message(m: string): Error {
  return new Error(/contrat_entretien|contrat_id|schema cache|does not exist/i.test(m)
    ? 'Les contrats d’entretien demandent le SQL 37 : exécutez-le dans Supabase.' : m);
}

export async function listerContrats(tiersId?: string): Promise<ContratEntretien[]> {
  let q = supabase.from('contrat_entretien').select('*').order('prochaine_echeance');
  if (tiersId) q = q.eq('tiers_id', tiersId);
  const { data, error } = await q;
  if (error) throw message(error.message);
  return (data ?? []) as ContratEntretien[];
}

export async function enregistrerContrat(c: Partial<ContratEntretien>): Promise<ContratEntretien> {
  const { data, error } = c.id
    ? await supabase.from('contrat_entretien').update(c).eq('id', c.id).select().single()
    : await supabase.from('contrat_entretien')
        .insert({ entreprise_id: entrepriseId(), ...c }).select().single();
  if (error) throw message(error.message);
  return data as ContratEntretien;
}

/** Les visites de contrat encore à faire, pour savoir lesquelles sont déjà calées. */
export async function visitesPrevues(): Promise<Intervention[]> {
  const { data, error } = await supabase.from('intervention').select('*')
    .not('contrat_id', 'is', null).in('statut', ['planifiee', 'en_cours', 'reportee']);
  if (error) throw message(error.message);
  return (data ?? []) as Intervention[];
}

/**
 * Cale la visite d'un contrat : une intervention d'entretien, rattachée au
 * chantier d'origine pour que le technicien en ait l'adresse et les machines.
 */
export async function planifierVisite(
  c: ContratEntretien, date: string, membreId: string | null,
): Promise<Intervention> {
  const { data, error } = await supabase.from('intervention').insert({
    entreprise_id: c.entreprise_id, chantier_id: c.chantier_id, tiers_id: c.tiers_id,
    type: 'entretien', contrat_id: c.id, date_prevue: date, membre_id: membreId,
  }).select().single();
  if (error) throw message(error.message);
  return data as Intervention;
}

export type ContratAvecClient = ContratEntretien & { tiers: { nom: string } | null };

/** Les contrats actifs, avec le nom du client, pour la cloche. */
export async function contratsActifs(): Promise<ContratAvecClient[]> {
  const { data, error } = await supabase.from('contrat_entretien').select('*, tiers(nom)')
    .eq('statut', 'actif').order('prochaine_echeance');
  if (error) throw message(error.message);
  return (data ?? []) as ContratAvecClient[];
}

/** « Dans 12 jours », « en retard de 3 jours » : la date seule ne dit pas l'urgence. */
export function echeanceLisible(iso: string): string {
  const jours = Math.round((new Date(iso).getTime()
    - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000);
  if (jours === 0) return 'aujourd’hui';
  if (jours > 0) return jours === 1 ? 'demain' : `dans ${jours} jours`;
  return `en retard de ${-jours} jour${jours < -1 ? 's' : ''}`;
}
