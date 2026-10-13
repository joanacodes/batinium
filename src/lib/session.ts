import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Membre } from './types';

/**
 * Le membre courant : son entreprise et son rôle.
 * Tout passe par là, parce que chaque écriture doit porter entreprise_id
 * et parce que le rôle décide de ce qui s'affiche.
 */

let membreCourant: Membre | null = null;

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
  membreCourant = (data as Membre) ?? null;
  return membreCourant;
}

export function oublierMembre(): void {
  membreCourant = null;
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
