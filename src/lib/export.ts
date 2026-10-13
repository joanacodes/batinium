import { supabase } from './supabase';
import { entrepriseId } from './session';

/**
 * L'export des données.
 *
 * Deux usages qui n'ont rien à voir, et un seul mécanisme.
 *
 * Le premier est une assurance : pouvoir tout sortir de Batinium, à tout
 * moment, sans demander la permission à personne. Une application de gestion
 * dont on ne peut pas extraire ses données est un piège, quelle que soit la
 * qualité du reste.
 *
 * Le second est le droit à la portabilité de l'article 20 du RGPD, qui exige
 * un format structuré et lisible par machine. Le JSON en est un.
 *
 * Tout passe par les requêtes ordinaires : la RLS filtre, donc l'export d'un
 * technicien ne contiendrait que ce qu'il a le droit de lire. C'est voulu.
 */

/** Les tables sorties, dans l'ordre où on les relit. */
export const TABLES: { nom: string; libelle: string }[] = [
  { nom: 'parametres', libelle: 'Réglages de l’entreprise' },
  { nom: 'membre', libelle: 'Équipe' },
  { nom: 'tiers', libelle: 'Clients, prospects, fournisseurs et sous-traitants' },
  { nom: 'site', libelle: 'Sites d’intervention' },
  { nom: 'demande', libelle: 'Demandes entrantes' },
  { nom: 'fil', libelle: 'Fil d’activité' },
  { nom: 'produit', libelle: 'Catalogue' },
  { nom: 'variante', libelle: 'Déclinaisons' },
  { nom: 'devis', libelle: 'Devis' },
  { nom: 'devis_lot', libelle: 'Lots de devis' },
  { nom: 'devis_ligne', libelle: 'Lignes de devis' },
  { nom: 'facture', libelle: 'Factures' },
  { nom: 'facture_ligne', libelle: 'Lignes de facture' },
  { nom: 'encaissement', libelle: 'Échéances d’encaissement' },
  { nom: 'chantier', libelle: 'Chantiers' },
  { nom: 'approvisionnement', libelle: 'Matériel à commander' },
  { nom: 'intervention', libelle: 'Interventions' },
  { nom: 'equipement', libelle: 'Matériel posé' },
  { nom: 'pointage', libelle: 'Heures pointées' },
  { nom: 'achat', libelle: 'Factures fournisseurs' },
  { nom: 'achat_ligne', libelle: 'Lignes de facture fournisseur' },
  { nom: 'depense', libelle: 'Dépenses' },
  { nom: 'charge_fixe', libelle: 'Charges fixes' },
  { nom: 'paiement_equipe', libelle: 'Paie et règlements' },
  { nom: 'remuneration', libelle: 'Rémunérations' },
  { nom: 'document', libelle: 'Pièces jointes (références, pas les fichiers)' },
  { nom: 'tache', libelle: 'Tâches' },
  { nom: 'prealable', libelle: 'Préalables de chantier' },
  { nom: 'gabarit', libelle: 'Gabarits de devis' },
  { nom: 'format_produit', libelle: 'Formats de produits' },
  { nom: 'effacement', libelle: 'Registre des effacements' },
];

export interface ResultatTable {
  nom: string;
  lignes: unknown[];
  erreur?: string;
}

/**
 * Lit une table entière, par tranches.
 *
 * PostgREST plafonne une réponse à mille lignes : sans pagination, un export
 * paraîtrait complet en étant tronqué — le pire des deux mondes, parce que
 * personne ne s'en apercevrait avant d'en avoir besoin.
 */
async function tout(nom: string): Promise<unknown[]> {
  const lignes: unknown[] = [];
  const taille = 1000;
  for (let debut = 0; ; debut += taille) {
    const { data, error } = await supabase.from(nom).select('*')
      .range(debut, debut + taille - 1);
    if (error) throw new Error(error.message);
    lignes.push(...(data ?? []));
    if (!data || data.length < taille) break;
  }
  return lignes;
}

export async function exporterTout(
  onProgres?: (nom: string, index: number, total: number) => void,
): Promise<ResultatTable[]> {
  const sortie: ResultatTable[] = [];
  for (const [i, t] of TABLES.entries()) {
    onProgres?.(t.libelle, i + 1, TABLES.length);
    try {
      sortie.push({ nom: t.nom, lignes: await tout(t.nom) });
    } catch (e) {
      // Une table refusée par la RLS n'arrête pas l'export : elle est
      // signalée, et le reste sort. Un technicien obtient ses données, pas
      // un message d'échec.
      sortie.push({ nom: t.nom, lignes: [], erreur: (e as Error).message });
    }
  }
  return sortie;
}

/** Déclenche un téléchargement sans passer par un serveur. */
export function telecharger(nom: string, contenu: string, type: string): void {
  const lien = document.createElement('a');
  const url = URL.createObjectURL(new Blob([contenu], { type: `${type};charset=utf-8` }));
  lien.href = url;
  lien.download = nom;
  lien.click();
  // Sans révocation, chaque export garde son contenu en mémoire jusqu'au
  // rechargement de la page. Sur un export de plusieurs mégaoctets, ça se sent.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Convertit en CSV, séparateur point-virgule.
 *
 * C'est celui qu'Excel français attend : avec une virgule, il colle tout dans
 * une seule colonne et l'utilisateur croit que l'export est cassé. Le BOM en
 * tête sert la même cause — sans lui, les accents deviennent des Ã©.
 */
export function versCsv(lignes: unknown[]): string {
  if (lignes.length === 0) return '';
  const colonnes = [...new Set(lignes.flatMap((l) => Object.keys(l as object)))];
  const echapper = (v: unknown): string => {
    if (v == null) return '';
    const texte = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[";\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
  };
  return '\uFEFF' + [
    colonnes.join(';'),
    ...lignes.map((l) => colonnes
      .map((c) => echapper((l as Record<string, unknown>)[c])).join(';')),
  ].join('\r\n');
}

/** Le nom du fichier : daté, pour que deux exports ne se confondent pas. */
export function nomFichier(suffixe: string, extension: string): string {
  const d = new Date();
  const jour = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `batinium-${suffixe}-${jour}.${extension}`;
}

/**
 * Le manifeste des fichiers joints.
 *
 * Les photos et les attestations ne peuvent pas entrer dans un JSON : ce sont
 * des mégaoctets de binaire, et le navigateur ne sait pas fabriquer une
 * archive sans dépendance. On produit donc la liste, avec un lien signé
 * valable trois semaines par fichier — de quoi les récupérer un par un, ou en
 * lot avec n'importe quel outil de téléchargement.
 *
 * Trois semaines et non dix minutes comme ailleurs : un export se prépare, se
 * transmet à un comptable, se traite quand il a le temps. Un lien mort à
 * l'arrivée rendrait le manifeste inutile.
 */
export async function manifesteFichiers(): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.from('document')
    .select('id, nom, chemin, type_mime, taille_octets, chantier_id, membre_id, tiers_id, created_at')
    .not('chemin', 'is', null).limit(5000);
  if (error) throw new Error(error.message);

  const chemins = (data ?? []).map((d) => d.chemin as string);
  const liens = new Map<string, string>();
  // Par tranches de cent : une demande de mille liens signés d'un coup se fait
  // refuser, et l'échec ne dirait pas pourquoi.
  for (let i = 0; i < chemins.length; i += 100) {
    const { data: signes } = await supabase.storage.from('documents')
      .createSignedUrls(chemins.slice(i, i + 100), 1814400);
    for (const x of signes ?? []) {
      if (x.path && x.signedUrl) liens.set(x.path, x.signedUrl);
    }
  }

  return (data ?? []).map((d) => ({
    nom: d.nom,
    chemin: d.chemin,
    type: d.type_mime,
    taille_octets: d.taille_octets,
    rattachement: d.chantier_id ? 'chantier' : d.membre_id ? 'salarié'
      : d.tiers_id ? 'tiers' : 'entreprise',
    depose_le: d.created_at,
    lien_valable_3_semaines: liens.get(d.chemin as string) ?? '',
  }));
}

export function metaExport(tables: ResultatTable[]): Record<string, unknown> {
  return {
    application: 'Batinium',
    entreprise_id: entrepriseId(),
    exporte_le: new Date().toISOString(),
    format: 'JSON, une clé par table',
    avertissement:
      'Les fichiers joints (photos, attestations) ne sont pas dans cet export : '
      + 'seules leurs références le sont. Ils se récupèrent depuis le stockage Supabase.',
    tables: tables.map((t) => ({ nom: t.nom, lignes: t.lignes.length, erreur: t.erreur ?? null })),
  };
}
