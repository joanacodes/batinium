import { demanderIAJson } from './ia';
import {
  ajouterLignes, ajouterLot, creerDevis, ligneDepuisProduit, listerProduits,
} from './db';
import type { Produit } from './types';

/**
 * Dicter un chantier, obtenir un brouillon de devis chiffré.
 *
 * Le point qui fait la différence : le catalogue part avec la dictée. Sans
 * lui, le modèle rend une liste de mots qu'il faut ensuite reprendre ligne à
 * ligne pour y coller des prix — c'est-à-dire tout le travail. Avec lui, il
 * reconnaît « un mono-split de deux virgule cinq » comme la référence MS-25,
 * et le brouillon arrive avec son prix, son unité et son taux de TVA.
 *
 * Ce qui reste inviolable : le devis créé est un **brouillon**. Il n'est ni
 * envoyé, ni signé, ni facturé, et tout y est modifiable. L'IA fabrique
 * quelque chose d'inerte tant qu'une personne n'agit pas dessus — c'est la
 * limite qui permet de lui laisser la main.
 */

export interface LigneDictee {
  reference?: string | null;
  designation: string;
  description?: string | null;
  quantite: number;
  unite: string;
}

export interface PropositionDevis {
  titre: string;
  notes?: string | null;
  lignes: LigneDictee[];
}

export interface ResultatDictee {
  devisId: string;
  proposition: PropositionDevis;
  /** Combien de lignes ont trouvé leur référence au catalogue. */
  reconnues: number;
}

/**
 * Le catalogue, en une ligne par référence.
 *
 * Format volontairement pauvre — RÉFÉRENCE | désignation | unité | prix — pour
 * en faire tenir beaucoup sans exploser le coût. Quatre cents références
 * suffisent largement à un installateur, et au-delà on paierait pour envoyer
 * des articles que personne ne dicte jamais.
 */
function catalogueCompact(produits: Produit[]): string {
  return produits
    .slice(0, 400)
    .map((p) => `${p.reference} | ${p.designation} | ${p.unite} | ${p.prix_vente_ht} €`)
    .join('\n');
}

/** Demande au modèle de découper une dictée, catalogue à l'appui. */
export async function lireDictee(dicte: string): Promise<PropositionDevis> {
  const produits = await listerProduits().catch(() => []);
  const contenu = produits.length
    ? `DICTÉE\n${dicte}\n\nCATALOGUE DE L'ENTREPRISE\n${catalogueCompact(produits)}`
    : `DICTÉE\n${dicte}\n\n(Le catalogue est vide : aucune référence à reconnaître.)`;
  return demanderIAJson<PropositionDevis>('devis', contenu);
}

/**
 * Crée le brouillon à partir d'une proposition.
 *
 * Une ligne reconnue passe par `ligneDepuisProduit` : elle hérite du prix de
 * vente, du prix d'achat, de la nature et de l'unité du catalogue, exactement
 * comme si on l'avait ajoutée à la main depuis le sélecteur. Une ligne non
 * reconnue reste à zéro plutôt que de recevoir un prix inventé — un zéro se
 * voit, un prix faux ne se voit pas.
 */
export async function creerBrouillonDicte(
  proposition: PropositionDevis,
  dicte: string,
  cible: { tiers_id?: string | null; site_id?: string | null; demande_id?: string | null } = {},
): Promise<ResultatDictee> {
  const produits = await listerProduits().catch(() => []);
  const parReference = new Map(produits.map((p) => [p.reference.toUpperCase(), p]));

  const notes = [
    `Dicté le ${new Date().toLocaleDateString('fr-FR')} :`,
    dicte.trim(),
    proposition.notes ? `\nÀ retenir : ${proposition.notes}` : null,
  ].filter(Boolean).join('\n');

  const devis = await creerDevis({
    tiers_id: cible.tiers_id ?? null,
    site_id: cible.site_id ?? null,
    demande_id: cible.demande_id ?? null,
    titre: proposition.titre || 'Devis dicté',
    notes_internes: notes,
  });

  const lot = await ajouterLot(devis.id, proposition.titre || 'Prestations', null, 0);

  let reconnues = 0;
  const lignes = proposition.lignes.map((l, i) => {
    const produit = l.reference ? parReference.get(l.reference.trim().toUpperCase()) : undefined;
    if (produit) {
      reconnues++;
      return {
        ...ligneDepuisProduit(produit, devis.id, lot.id, i, l.quantite || 1),
        // La désignation dictée l'emporte quand elle précise l'emplacement :
        // « mono-split séjour » vaut mieux que « Mono-split 2,5 kW » seul.
        description: l.description ?? produit.description,
      };
    }
    return {
      devis_id: devis.id, lot_id: lot.id, position: i,
      designation: l.designation,
      description: l.description ?? null,
      nature: 'fourniture' as const,
      unite: l.unite || 'U',
      quantite: l.quantite || 1,
      prix_unitaire_ht: 0,
      remise_pct: 0,
      taux_tva: 20,
      taux_force: false,
    };
  });

  if (lignes.length) await ajouterLignes(lignes);
  return { devisId: devis.id, proposition, reconnues };
}

/** Le chemin complet : dicter, lire, créer. */
export async function dicterDevis(
  dicte: string,
  cible: { tiers_id?: string | null; site_id?: string | null; demande_id?: string | null } = {},
): Promise<ResultatDictee> {
  return creerBrouillonDicte(await lireDictee(dicte), dicte, cible);
}
