/**
 * Recherche d'entreprises par l'annuaire public.
 * Gratuite, sans clé. Sert à remplir une fiche sous-traitant à partir
 * d'un nom ou d'un SIRET, sans ressaisie.
 */

const API = 'https://recherche-entreprises.api.gouv.fr/search';

export interface Entreprise {
  nom: string;
  siren: string;
  siret: string;
  adresse: string;
  codePostal: string;
  ville: string;
  activite: string;
  categorie: string;
  dateCreation?: string;
  effectif?: string;
  cessee: boolean;
}

interface Siege {
  siret?: string;
  numero_voie?: string;
  type_voie?: string;
  libelle_voie?: string;
  adresse?: string;
  code_postal?: string;
  libelle_commune?: string;
}

interface Brut {
  nom_complet?: string;
  nom_raison_sociale?: string;
  siren?: string;
  siege?: Siege;
  activite_principale?: string;
  libelle_activite_principale?: string;
  categorie_entreprise?: string;
  date_creation?: string;
  tranche_effectif_salarie?: string;
  etat_administratif?: string;
}

/** Nettoie l'adresse du siège, qui arrive parfois avec le code postal collé. */
function adresseCourte(s: Siege | undefined): string {
  if (!s) return '';
  const construite = [s.numero_voie, s.type_voie, s.libelle_voie]
    .filter(Boolean).join(' ').trim();
  if (construite) return construite;
  if (!s.adresse) return '';
  // On retire ce qui est déjà porté par le code postal et la commune
  return s.adresse
    .replace(s.code_postal ?? '', '')
    .replace(s.libelle_commune ?? '', '')
    .trim();
}

export async function chercherEntreprise(texte: string, maximum = 8): Promise<Entreprise[]> {
  const q = texte.trim();
  if (q.length < 3) return [];
  try {
    const r = await fetch(`${API}?q=${encodeURIComponent(q)}&per_page=${maximum}`);
    if (!r.ok) return [];
    const data = (await r.json()) as { results?: Brut[] };
    return (data.results ?? []).map((x) => ({
      nom: x.nom_complet ?? x.nom_raison_sociale ?? '',
      siren: x.siren ?? '',
      siret: x.siege?.siret ?? '',
      adresse: adresseCourte(x.siege),
      codePostal: x.siege?.code_postal ?? '',
      ville: x.siege?.libelle_commune ?? '',
      activite: x.libelle_activite_principale ?? x.activite_principale ?? '',
      categorie: x.categorie_entreprise ?? '',
      dateCreation: x.date_creation,
      effectif: x.tranche_effectif_salarie,
      cessee: x.etat_administratif === 'C',
    }));
  } catch {
    return [];
  }
}

/** Met un SIRET en forme lisible : 512 447 908 00021. */
export function formaterSiret(siret: string): string {
  const n = siret.replace(/\D/g, '');
  if (n.length !== 14) return siret;
  return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 9)} ${n.slice(9)}`;
}
