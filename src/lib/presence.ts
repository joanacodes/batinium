import { supabase } from './supabase';
import { geocoder } from './adresse';
import type { Presence, SansPosition, Site } from './types';

/**
 * Arrivées et départs sur chantier (SQL 35).
 *
 * La position est relevée une fois, au moment du geste, jamais en continu :
 * c'est ce que la CNIL admet pour prouver une intervention, et c'est tout ce
 * dont Fabrice a besoin — savoir si l'arrivée a été notée sur place. Les
 * heures viennent du serveur : celles du téléphone se règlent à la main.
 */

export interface Position { latitude: number; longitude: number; precision_m: number }
export type Releve = { position: Position } | { sans: SansPosition };

/**
 * La position du téléphone, une fois.
 *
 * Dix secondes au plus : au-delà, l'arrivée se note sans position plutôt que
 * de laisser quelqu'un attendre sur le trottoir. Une position vieille d'une
 * minute est acceptée — le temps de garer le fourgon.
 */
export function relevePosition(delaiMs = 10000): Promise<Releve> {
  return new Promise((resoudre) => {
    if (!('geolocation' in navigator)) return resoudre({ sans: 'non_supportee' });
    navigator.geolocation.getCurrentPosition(
      (p) => resoudre({ position: {
        latitude: p.coords.latitude, longitude: p.coords.longitude,
        precision_m: Math.round(p.coords.accuracy),
      } }),
      (e) => resoudre({ sans: e.code === e.PERMISSION_DENIED ? 'refusee'
        : e.code === e.TIMEOUT ? 'delai' : 'indisponible' }),
      { enableHighAccuracy: true, timeout: delaiMs, maximumAge: 60000 },
    );
  });
}

const parametresReleve = (r: Releve) => ('position' in r
  ? { p_latitude: r.position.latitude, p_longitude: r.position.longitude,
      p_precision_m: r.position.precision_m, p_sans_position: null }
  : { p_latitude: null, p_longitude: null, p_precision_m: null, p_sans_position: r.sans });

/**
 * Le SQL 35 n'a pas tourné : on le dit, au lieu d'un « function not found ».
 * Reconnaît aussi le message déjà reformulé, pour que l'écran puisse retomber
 * sur l'ancien « Je commence » quelle que soit l'étape où l'erreur est lue.
 */
export function sql35Absent(message: string): boolean {
  return /SQL 35|noter_arrivee|noter_depart|relation "?presence"? does not exist|Could not find the function|schema cache/i
    .test(message);
}

function erreur(message: string): Error {
  return new Error(sql35Absent(message)
    ? 'L’heure d’arrivée demande le SQL 35 : exécutez-le dans Supabase.'
    : message);
}

export async function noterArrivee(
  cible: { interventionId?: string | null; chantierId?: string | null }, releve: Releve,
): Promise<Presence> {
  const { data, error } = await supabase.rpc('noter_arrivee', {
    p_intervention: cible.interventionId ?? null,
    p_chantier: cible.chantierId ?? null,
    ...parametresReleve(releve),
  });
  if (error) throw erreur(error.message);
  return data as Presence;
}

export async function noterDepart(presenceId: string, releve: Releve, terminer: boolean): Promise<Presence> {
  const { data, error } = await supabase.rpc('noter_depart', {
    p_presence: presenceId, ...parametresReleve(releve), p_terminer: terminer,
  });
  if (error) throw erreur(error.message);
  return data as Presence;
}

export type PresenceLue = Presence & {
  membre: { nom: string } | null;
  chantier: { numero: string; libelle: string } | null;
};

/** Les présences depuis un jour donné. La RLS ne rend que les siennes à un poseur. */
export async function listerPresences(filtre: {
  depuis?: string; membreId?: string; chantierId?: string; limite?: number;
} = {}): Promise<PresenceLue[]> {
  let q = supabase.from('presence')
    .select('*, membre(nom), chantier(numero, libelle)')
    .order('arrive_le', { ascending: false })
    .limit(filtre.limite ?? 200);
  if (filtre.depuis) q = q.gte('arrive_le', filtre.depuis);
  if (filtre.membreId) q = q.eq('membre_id', filtre.membreId);
  if (filtre.chantierId) q = q.eq('chantier_id', filtre.chantierId);
  const { data, error } = await q;
  if (error) throw erreur(error.message);
  return (data ?? []) as PresenceLue[];
}

/** Minuit à l'heure du téléphone, en ISO : le début de « aujourd'hui » pour la base. */
export function debutDuJour(d = new Date()): string {
  const j = new Date(d);
  j.setHours(0, 0, 0, 0);
  return j.toISOString();
}

/**
 * Les coordonnées du site, cherchées une fois puis gardées.
 *
 * Sans elles, la base ne peut pas dire si une arrivée a été notée sur place.
 * Un échec n'empêche rien : l'arrivée part sans distance, et l'écran le dit.
 */
export async function localiserSite(site: Site | undefined | null): Promise<void> {
  if (!site || site.latitude != null || !site.adresse) return;
  const c = await geocoder([site.adresse, site.code_postal, site.ville].filter(Boolean).join(' '));
  if (!c) return;
  await supabase.from('site').update(c).eq('id', site.id);
  site.latitude = c.latitude;
  site.longitude = c.longitude;
}

const RAISON: Record<SansPosition, string> = {
  refusee: 'position refusée par le téléphone',
  indisponible: 'position indisponible',
  delai: 'position trop longue à obtenir',
  non_supportee: 'appareil sans localisation',
};

/**
 * Où était la personne, dit en clair.
 *
 * « Sur place » jusqu'à 150 m : en ville, un GPS de téléphone se trompe
 * volontiers de cent mètres, et le fourgon est rarement garé devant la porte.
 * Quand l'imprécision annoncée dépasse la distance, on ne conclut rien.
 */
export function ecartLisible(distance: number | null, sans: SansPosition | null,
                             precision: number | null, aPosition: boolean): string {
  if (distance != null) {
    if (distance <= 150) return `sur place (${distance} m)`;
    if (precision != null && precision >= distance) return `position imprécise (± ${precision} m)`;
    return distance < 1000
      ? `à ${distance} m du chantier`
      : `à ${(distance / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km du chantier`;
  }
  if (sans) return RAISON[sans];
  return aPosition ? 'position relevée, adresse du chantier non localisée' : 'sans position';
}

export const heure = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Le lien vers la position relevée, pour la direction. */
export const lienCarte = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
