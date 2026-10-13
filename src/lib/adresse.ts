/**
 * Auto-complétion d'adresses par la Géoplateforme de l'IGN.
 * Gratuite, sans clé, dix requêtes par seconde et par adresse IP.
 *
 * Elle remplace api-adresse.data.gouv.fr, décommissionnée en janvier 2026.
 */

const COMPLETION = 'https://data.geopf.fr/geocodage/completion/';

export interface Suggestion {
  texte: string;        // ligne complète, telle qu'affichée
  voie: string;
  codePostal: string;
  ville: string;
  longitude?: number;
  latitude?: number;
}

interface BrutIgn {
  fulltext?: string;
  street?: string;
  zipcode?: string;
  city?: string;
  x?: number;
  y?: number;
}

/**
 * Suggère des adresses à partir d'un début de saisie.
 * Retourne une liste vide plutôt qu'une erreur : une auto-complétion qui
 * tombe en panne ne doit jamais empêcher de taper une adresse à la main.
 */
export async function suggerer(texte: string, maximum = 8): Promise<Suggestion[]> {
  const q = texte.trim();
  if (q.length < 3) return [];
  try {
    const url = `${COMPLETION}?text=${encodeURIComponent(q)}` +
                `&type=StreetAddress&maximumResponses=${maximum}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const data = (await r.json()) as { results?: BrutIgn[] };
    return (data.results ?? []).map((x) => ({
      texte: x.fulltext ?? [x.street, x.zipcode, x.city].filter(Boolean).join(' '),
      voie: x.street ?? '',
      codePostal: x.zipcode ?? '',
      ville: x.city ?? '',
      longitude: x.x,
      latitude: x.y,
    }));
  } catch {
    return [];
  }
}

/** Petit anti-rebond : on n'interroge pas l'IGN à chaque frappe. */
export function antiRebond<A extends unknown[]>(
  fn: (...a: A) => void, delai = 250,
): (...a: A) => void {
  let minuteur: number | undefined;
  return (...a: A) => {
    window.clearTimeout(minuteur);
    minuteur = window.setTimeout(() => fn(...a), delai);
  };
}

const RECHERCHE = 'https://data.geopf.fr/geocodage/search';

interface BrutRecherche {
  features?: { geometry?: { coordinates?: [number, number] }; properties?: { score?: number } }[];
}

/**
 * Les coordonnées d'une adresse complète, ou `null`.
 *
 * Un score sous 0,6 veut dire que l'IGN a deviné : une rue homonyme, une
 * commune voisine. Mieux vaut pas de position qu'une position fausse, qui
 * ferait dire « à 12 km du chantier » à un technicien arrivé à l'heure.
 */
export async function geocoder(texte: string): Promise<{ latitude: number; longitude: number } | null> {
  const q = texte.trim();
  if (q.length < 5) return null;
  try {
    const r = await fetch(`${RECHERCHE}?q=${encodeURIComponent(q)}&limit=1`);
    if (!r.ok) return null;
    const f = ((await r.json()) as BrutRecherche).features?.[0];
    const c = f?.geometry?.coordinates;
    if (!c || (f?.properties?.score ?? 0) < 0.6) return null;
    return { longitude: c[0], latitude: c[1] };
  } catch {
    return null;
  }
}
