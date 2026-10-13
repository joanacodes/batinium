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
