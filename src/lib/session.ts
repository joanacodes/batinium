import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Membre, Role } from './types';

/**
 * Le membre courant : son entreprise et son rôle.
 * Tout passe par là, parce que chaque écriture doit porter entreprise_id
 * et parce que le rôle décide de ce qui s'affiche.
 */

let membreCourant: Membre | null = null;
// Le rôle de la ligne `membre`, avant tout aperçu. `membreCourant.role` porte,
// lui, le rôle effectif : c'est celui que lisent tous les écrans.
let roleReelCourant: Role | null = null;

export function membre(): Membre {
  if (!membreCourant) throw new Error('Session non initialisée.');
  return membreCourant;
}

export function entrepriseId(): string {
  return membre().entreprise_id;
}

export function voitLesPrix(): boolean {
  const r = membreCourant?.role;
  return r === 'direction' || r === 'chef_chantier';
}

/**
 * La direction, et elle seule.
 *
 * Plus étroit que voitLesPrix(), qui laisse passer un chef de chantier. Sert
 * à ce qui relève de l'employeur et non du chantier : la paie, les salaires.
 * Un écran qu'on ne peut pas utiliser ne doit pas s'afficher — une porte
 * peinte sur un mur ne fait que promettre une erreur.
 */
export function estDirection(): boolean {
  return membreCourant?.role === 'direction';
}

export async function chargerMembre(userId: string): Promise<Membre | null> {
  const { data, error } = await supabase
    .from('membre')
    .select('*')
    .eq('user_id', userId)
    .eq('actif', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const m = (data as Membre) ?? null;
  roleReelCourant = m?.role ?? null;
  // Même règle que mon_role() en base (SQL 38) : l'aperçu ne vaut que pour la
  // direction. L'écran et la RLS lisent ainsi le même rôle — sinon on verrait
  // les menus d'un technicien avec les données de la direction.
  membreCourant = m && m.role === 'direction' && m.apercu_role
    ? { ...m, role: m.apercu_role }
    : m;
  return membreCourant;
}

export function oublierMembre(): void {
  membreCourant = null;
  roleReelCourant = null;
}

/**
 * Combien de jours avant une échéance d'entretien prévenir ce membre (SQL 37).
 * Trente par défaut : le temps de caler une tournée sans y penser trop tôt.
 */
export function preavisEntretien(): number {
  return membreCourant?.preavis_entretien_jours ?? 30;
}

/** Règle son propre préavis. Par la base : `membre` n'est modifiable que par la direction. */
export async function reglerPreavisEntretien(jours: number): Promise<void> {
  const { error } = await supabase.rpc('regler_preavis_entretien', { p_jours: jours });
  if (error) {
    throw new Error(/function .* does not exist|Could not find the function/i.test(error.message)
      ? 'Le préavis d’entretien demande le SQL 37 : exécutez-le dans Supabase.'
      : error.message);
  }
  if (membreCourant) membreCourant = { ...membreCourant, preavis_entretien_jours: jours };
}

/** Le rôle réel, hors démonstration : seul lui ouvre le sélecteur de vue. */
export function roleReel(): Role | null {
  return roleReelCourant;
}

/** Vrai quand la direction regarde Batinium avec les droits d'un autre rôle. */
export function enDemonstration(): boolean {
  return roleReelCourant === 'direction' && !!membreCourant && membreCourant.role !== 'direction';
}

/**
 * Change la vue de démonstration, puis recharge la page.
 *
 * Recharger plutôt que rerendre : chaque écran a chargé ses données avec les
 * droits d'avant, la cloche aussi. Un rechargement complet est la seule façon
 * sûre de ne rien garder de la vue précédente — et c'est un outil de mise au
 * point, pas un geste quotidien.
 */
export async function basculerVue(role: Role): Promise<void> {
  await changerDemonstration(role === 'direction' ? null : role);
  window.location.hash = '#/bord';
  window.location.reload();
}

/**
 * Entre en démonstration, ou en sort avec `null`.
 *
 * Par la base et non par l'écran : c'est mon_role() qui change, donc la RLS
 * avec lui. Il faut ensuite recharger le membre — c'est à l'appelant de le
 * faire, parce que c'est lui qui tient l'état de l'application.
 */
export async function changerDemonstration(role: Exclude<Role, 'direction'> | null): Promise<void> {
  const { error } = role
    ? await supabase.rpc('entrer_apercu', { p_role: role })
    : await supabase.rpc('quitter_apercu');
  if (error) {
    throw new Error(/function .* does not exist|Could not find the function/i.test(error.message)
      ? 'Le mode démonstration demande le SQL 38 : exécutez-le dans Supabase.'
      : error.message);
  }
}

/**
 * Jeton Google, nécessaire pour lire la boîte Gmail.
 * Supabase ne le conserve pas au rechargement de page, on le garde nous-mêmes
 * le temps de l'onglet. Il expire au bout d'une heure : il faudra alors
 * se reconnecter avec Google.
 */
const CLE_JETON = 'batinium.google';

export function memoriserJetonGoogle(jeton: string | null | undefined): void {
  if (jeton) window.sessionStorage.setItem(CLE_JETON, jeton);
}

export function jetonGoogle(): string | null {
  return window.sessionStorage.getItem(CLE_JETON);
}

export function oublierJetonGoogle(): void {
  window.sessionStorage.removeItem(CLE_JETON);
}

/** Petit utilitaire de chargement, pour éviter de répéter le même useEffect. */
export function useChargement<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
): { valeur: T | null; erreur: string | null; recharger: () => void } {
  const [valeur, setValeur] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [tic, setTic] = useState(0);

  useEffect(() => {
    let vivant = true;
    fn()
      .then((v) => vivant && setValeur(v))
      .catch((e) => vivant && setErreur((e as Error).message));
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tic]);

  return { valeur, erreur, recharger: () => setTic((t) => t + 1) };
}
