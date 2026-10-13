import { useEffect, useState } from 'react';

/**
 * Routeur sur le hash, en trente lignes. Pas de dépendance à installer,
 * pas de configuration de serveur pour le rafraîchissement de page.
 *
 * Routes : #/devis, #/devis/:id, #/demandes, #/clients, #/catalogue, #/parametres
 */

export interface Route {
  section: string;
  id: string | null;
}

function lire(): Route {
  const brut = window.location.hash.replace(/^#\/?/, '');
  const [section = 'devis', id] = brut.split('/');
  return { section: section || 'devis', id: id ?? null };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(lire);
  useEffect(() => {
    const maj = () => setRoute(lire());
    window.addEventListener('hashchange', maj);
    return () => window.removeEventListener('hashchange', maj);
  }, []);
  return route;
}

export function aller(chemin: string): void {
  window.location.hash = chemin.startsWith('/') ? `#${chemin}` : `#/${chemin}`;
}
