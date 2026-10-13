import { supabase } from './supabase';
import { calculerDevis } from './calcul';
import { entrepriseId, membre } from './session';
import type {
  Chantier, Demande, Devis, DevisLigne, DevisLot, Document, Entreprise,
  Equipement,
  ChargeFixe, Depense, Doublon, Encaissement, Famille, Fil, FormatProduit, Gabarit,
  Intervention, Membre, Nature, PaiementEquipe, Parametres, Periodicite, Produit,
  Achat, AchatLigne, Approvisionnement, CoutMainOeuvre, CoutReel, EcartAchat, Facture,
  FactureLigne, Pointage, Prealable,
  PrealableChantier, Rattachement, Remuneration, Role, Site, Tache, Tiers, TypeDocument,
  TypeFacture, Variante,
} from './types';

/**
 * Toute la lecture et l'écriture Supabase passe par ce fichier.
 * Les écrans n'appellent jamais supabase.from() directement : le jour où on
 * ajoute un backend, on ne touche qu'ici.
 *
 * `ent()` injecte entreprise_id sur chaque insertion. La RLS le vérifie de
 * toute façon côté serveur, mais autant ne pas s'en remettre qu'à elle.
 */

function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const ent = () => ({ entreprise_id: entrepriseId() });

// --- Inscription et rattachement --------------------------------------------
// Ces fonctions s'appellent AVANT d'être membre d'une entreprise :
// elles passent par des RPC, jamais par une table protégée.

/** Le tout premier compte crée son entreprise et devient direction. */
export async function creerEntreprise(nom: string, nomMembre: string): Promise<string> {
  return ok(await supabase.rpc('creer_entreprise', { p_nom: nom, p_nom_membre: nomMembre }));
}

/** Les suivants demandent à rejoindre, avec le code donné par la direction. */
export async function demanderRattachement(nom: string, code: string): Promise<string> {
  return ok(await supabase.rpc('demander_rattachement', { p_nom: nom, p_code: code }));
}

export async function monRattachement(): Promise<{ statut: string; entreprise: string } | null> {
  const r = ok<{ statut: string; entreprise: string }[]>(await supabase.rpc('mon_rattachement'));
  return r?.[0] ?? null;
}

// --- Membres ----------------------------------------------------------------

export async function listerMembres(): Promise<Membre[]> {
  return ok(await supabase.from('membre').select('*').order('nom'));
}

export async function majMembre(id: string, patch: Partial<Membre>): Promise<void> {
  ok(await supabase.from('membre').update(patch).eq('id', id).select());
}

export async function chargerEntreprise(): Promise<Entreprise> {
  return ok(await supabase.from('entreprise').select('*').eq('id', entrepriseId()).single());
}

export async function listerRattachements(): Promise<Rattachement[]> {
  return ok(await supabase.from('rattachement').select('*')
    .eq('statut', 'en_attente').order('created_at'));
}

export async function approuverRattachement(id: string, role: Role): Promise<void> {
  ok(await supabase.rpc('approuver_rattachement', { p_id: id, p_role: role }));
}

export async function refuserRattachement(id: string): Promise<void> {
  ok(await supabase.rpc('refuser_rattachement', { p_id: id }));
}

// --- Paramètres -------------------------------------------------------------

export async function chargerParametres(): Promise<Parametres> {
  return ok(await supabase.from('parametres').select('*').eq('entreprise_id', entrepriseId()).single());
}

export async function enregistrerParametres(p: Partial<Parametres>): Promise<Parametres> {
  const { entreprise_id: _e, ...patch } = p;
  return ok(
    await supabase.from('parametres')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('entreprise_id', entrepriseId()).select().single(),
  );
}

// --- Catalogue --------------------------------------------------------------

/**
 * Le catalogue publié. Les brouillons en sont exclus quoi qu'il arrive : ils
 * n'ont pas été relus, ils n'ont donc rien à faire dans un devis. Pour les
 * voir, il faut le demander explicitement par listerBrouillons().
 */
export async function listerProduits(inclureInactifs = false): Promise<Produit[]> {
  let q = supabase.from('produit').select('*')
    .eq('brouillon', false)
    .order('famille').order('reference');
  if (!inclureInactifs) q = q.eq('actif', true);
  return ok(await q);
}

export async function enregistrerProduit(p: Partial<Produit>): Promise<Produit> {
  if (p.id) return ok(await supabase.from('produit').update(p).eq('id', p.id).select().single());
  return ok(await supabase.from('produit').insert({ ...ent(), ...p }).select().single());
}

export async function archiverProduit(id: string): Promise<void> {
  ok(await supabase.from('produit').update({ actif: false }).eq('id', id).select());
}

export async function listerGabarits(): Promise<Gabarit[]> {
  return ok(await supabase.from('gabarit').select('*').eq('actif', true).order('position'));
}

// --- Clients et sites -------------------------------------------------------

export async function listerTiers(categorie?: Tiers['categorie']): Promise<Tiers[]> {
  let q = supabase.from('tiers').select('*').order('nom');
  if (categorie) q = q.eq('categorie', categorie);
  return ok(await q);
}

export async function chargerTiers(id: string): Promise<Tiers> {
  return ok(await supabase.from('tiers').select('*').eq('id', id).single());
}

export async function enregistrerTiers(t: Partial<Tiers>): Promise<Tiers> {
  if (t.id) return ok(await supabase.from('tiers').update(t).eq('id', t.id).select().single());
  return ok(await supabase.from('tiers').insert({ ...ent(), ...t }).select().single());
}

export async function supprimerTiers(id: string): Promise<void> {
  ok(await supabase.from('tiers').delete().eq('id', id).select());
}

export async function listerSites(tiersId?: string): Promise<Site[]> {
  let q = supabase.from('site').select('*').order('created_at');
  if (tiersId) q = q.eq('tiers_id', tiersId);
  return ok(await q);
}

export async function enregistrerSite(s: Partial<Site>): Promise<Site> {
  if (s.id) return ok(await supabase.from('site').update(s).eq('id', s.id).select().single());
  return ok(await supabase.from('site').insert({ ...ent(), ...s }).select().single());
}

/** Retrouve un client par téléphone ou e-mail. Sert au rattachement automatique. */
export async function retrouverTiers(telephone?: string | null, email?: string | null): Promise<Tiers | null> {
  const filtres: string[] = [];
  if (telephone) filtres.push(`telephone.eq.${telephone.replace(/[^0-9+]/g, '')}`);
  if (email) filtres.push(`email.ilike.${email}`);
  if (!filtres.length) return null;
  const r = ok<Tiers[]>(await supabase.from('tiers').select('*').or(filtres.join(',')).limit(1));
  return r[0] ?? null;
}

// --- Demandes ---------------------------------------------------------------

export type DemandeAvecTiers = Demande & { tiers: Pick<Tiers, 'id' | 'nom'> | null };

export async function listerDemandes(): Promise<DemandeAvecTiers[]> {
  return ok(await supabase.from('demande').select('*, tiers(id, nom)').order('recu_le', { ascending: false }));
}

export async function enregistrerDemande(d: Partial<Demande>): Promise<Demande> {
  if (d.id) return ok(await supabase.from('demande').update(d).eq('id', d.id).select().single());
  return ok(await supabase.from('demande').insert({ ...ent(), ...d }).select().single());
}

export async function marquerRepondu(id: string, repondu: boolean): Promise<void> {
  ok(await supabase.from('demande')
    .update({ repondu, repondu_le: repondu ? new Date().toISOString() : null })
    .eq('id', id).select());
}

export async function supprimerDemande(id: string): Promise<void> {
  ok(await supabase.from('demande').delete().eq('id', id).select());
}

// --- Fil d'activité ---------------------------------------------------------

export async function listerFil(filtre: { tiersId?: string; chantierId?: string; aTraiter?: boolean } = {}): Promise<Fil[]> {
  let q = supabase.from('fil').select('*').order('occurred_at', { ascending: false }).limit(200);
  if (filtre.tiersId) q = q.eq('tiers_id', filtre.tiersId);
  if (filtre.chantierId) q = q.eq('chantier_id', filtre.chantierId);
  if (filtre.aTraiter) q = q.eq('a_traiter', true);
  return ok(await q);
}

export async function ajouterFil(f: Partial<Fil>): Promise<Fil> {
  return ok(await supabase.from('fil').insert({ ...ent(), ...f }).select().single());
}

export async function traiterFil(id: string): Promise<void> {
  ok(await supabase.from('fil')
    .update({ a_traiter: false, traite_le: new Date().toISOString() })
    .eq('id', id).select());
}

// --- Devis ------------------------------------------------------------------

export type DevisAvecTiers = Devis & { tiers: Pick<Tiers, 'id' | 'nom' | 'ville'> | null };

export async function listerDevis(): Promise<DevisAvecTiers[]> {
  return ok(await supabase.from('devis').select('*, tiers(id, nom, ville)').order('created_at', { ascending: false }));
}

export interface DevisComplet {
  devis: Devis;
  lots: DevisLot[];
  lignes: DevisLigne[];
  tiers: Tiers | null;
  site: Site | null;
}

export async function chargerDevis(id: string): Promise<DevisComplet> {
  const devis = ok<Devis>(await supabase.from('devis').select('*').eq('id', id).single());
  const [lots, lignes] = await Promise.all([
    ok<DevisLot[]>(await supabase.from('devis_lot').select('*').eq('devis_id', id).order('position')),
    ok<DevisLigne[]>(await supabase.from('devis_ligne').select('*').eq('devis_id', id).order('position')),
  ]);
  const tiers = devis.tiers_id ? await chargerTiers(devis.tiers_id) : null;
  const site = devis.site_id
    ? ok<Site>(await supabase.from('site').select('*').eq('id', devis.site_id).single())
    : null;
  return { devis, lots, lignes, tiers, site };
}

const ECHEANCIER_DEFAUT = [
  { libelle: 'Acompte à la signature', pourcentage: 50 },
  { libelle: 'Versement intermédiaire après passage des réseaux et livraison des machines', pourcentage: 30 },
  { libelle: 'Solde à réception de chantier', pourcentage: 20 },
];

export async function creerDevis(init: Partial<Devis>): Promise<Devis> {
  const numero = ok<string>(await supabase.rpc('prochain_numero', { p_type: 'devis' }));
  return ok(await supabase.from('devis')
    .insert({ ...ent(), numero, echeancier: ECHEANCIER_DEFAUT, ...init })
    .select().single());
}

export async function majDevis(id: string, patch: Partial<Devis>): Promise<Devis> {
  return ok(await supabase.from('devis')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id).select().single());
}

export async function supprimerDevis(id: string): Promise<void> {
  ok(await supabase.from('devis').delete().eq('id', id).select());
}

export async function dupliquerDevis(id: string): Promise<Devis> {
  const { devis, lots, lignes } = await chargerDevis(id);
  const { id: _i, numero: _n, updated_at: _u, entreprise_id: _e, ...reste } = devis;
  const copie = await creerDevis({
    ...reste,
    statut: 'brouillon',
    envoye_le: null, signe_le: null,
    retractation_fin_le: null, encaissement_autorise_le: null, relance_prochaine_le: null,
    date_emission: new Date().toISOString().slice(0, 10),
    titre: devis.titre ? `${devis.titre} (copie)` : null,
  });
  await copierArborescence(copie.id, lots, lignes, null, null);
  return copie;
}

/**
 * Marque le devis envoyé et calcule les délais légaux.
 * Un contrat hors établissement interdit tout encaissement pendant 7 jours :
 * la date est calculée ici et fait foi, ce n'est pas un simple rappel.
 */
export async function marquerSigne(id: string, mode: Devis['mode_conclusion']): Promise<Devis> {
  const maintenant = new Date();
  const plus = (n: number) => {
    const d = new Date(maintenant);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return majDevis(id, {
    statut: 'signe',
    signe_le: maintenant.toISOString(),
    mode_conclusion: mode,
    retractation_fin_le: mode === 'etablissement' ? null : plus(14),
    encaissement_autorise_le: mode === 'hors_etablissement' ? plus(7) : plus(0),
  });
}

// --- Lots et lignes ---------------------------------------------------------

export async function ajouterLot(devisId: string, titre: string, parentId: string | null, position: number): Promise<DevisLot> {
  return ok(await supabase.from('devis_lot')
    .insert({ ...ent(), devis_id: devisId, titre, parent_id: parentId, position })
    .select().single());
}

export async function majLot(id: string, patch: Partial<DevisLot>): Promise<void> {
  ok(await supabase.from('devis_lot').update(patch).eq('id', id).select());
}

export async function supprimerLot(id: string): Promise<void> {
  ok(await supabase.from('devis_lot').delete().eq('id', id).select());
}

/**
 * Duplication de zone : le bouton le plus rentable de l'application.
 * Sur les devis Pilotech, le lot 2 est une copie du lot 1 aux quantités près.
 */
export async function dupliquerZone(devisId: string, lotId: string, nouveauTitre?: string): Promise<DevisLot> {
  const { lots, lignes } = await chargerDevis(devisId);
  const racine = lots.find((l) => l.id === lotId);
  if (!racine) throw new Error('Zone introuvable.');

  const position = Math.max(0, ...lots.filter((l) => l.parent_id === racine.parent_id).map((l) => l.position)) + 1;
  const copie = await ajouterLot(devisId, nouveauTitre ?? `${racine.titre} (copie)`, racine.parent_id, position);
  await copierArborescence(devisId, lots, lignes, lotId, copie.id);
  return copie;
}

async function copierArborescence(
  devisCibleId: string, lots: DevisLot[], lignes: DevisLigne[],
  sourceRacine: string | null, cibleRacine: string | null,
): Promise<void> {
  const corresp = new Map<string | null, string | null>([[sourceRacine, cibleRacine]]);

  // Parcours en largeur : un parent est toujours créé avant ses enfants.
  let niveau = lots.filter((l) => l.parent_id === sourceRacine);
  const aCopier: DevisLot[] = [];
  while (niveau.length) {
    aCopier.push(...niveau);
    const ids = new Set(niveau.map((l) => l.id));
    niveau = lots.filter((l) => l.parent_id != null && ids.has(l.parent_id));
  }

  for (const lot of aCopier) {
    const parent = corresp.get(lot.parent_id) ?? null;
    const cree = await ajouterLot(devisCibleId, lot.titre, parent, lot.position);
    corresp.set(lot.id, cree.id);
  }

  const nouvelles = lignes.filter((l) => corresp.has(l.lot_id)).map((l) => ({
    ...ent(),
    devis_id: devisCibleId,
    lot_id: corresp.get(l.lot_id)!,
    position: l.position,
    produit_id: l.produit_id,
    designation: l.designation,
    description: l.description,
    nature: l.nature,
    unite: l.unite,
    quantite: l.quantite,
    prix_unitaire_ht: l.prix_unitaire_ht,
    remise_pct: l.remise_pct,
    prix_achat_ht: l.prix_achat_ht,
    taux_tva: l.taux_tva,
    taux_force: l.taux_force,
    justification_tva: l.justification_tva,
    consigne_pose: l.consigne_pose,
    emplacement: l.emplacement,
  }));

  if (nouvelles.length) ok(await supabase.from('devis_ligne').insert(nouvelles).select());
}

export async function ajouterLigne(l: Partial<DevisLigne>): Promise<DevisLigne> {
  return ok(await supabase.from('devis_ligne').insert({ ...ent(), ...l }).select().single());
}

export async function ajouterLignes(l: Partial<DevisLigne>[]): Promise<DevisLigne[]> {
  if (!l.length) return [];
  return ok(await supabase.from('devis_ligne').insert(l.map((x) => ({ ...ent(), ...x }))).select());
}

export async function majLigne(id: string, patch: Partial<DevisLigne>): Promise<void> {
  ok(await supabase.from('devis_ligne').update(patch).eq('id', id).select());
}

export async function supprimerLigne(id: string): Promise<void> {
  ok(await supabase.from('devis_ligne').delete().eq('id', id).select());
}

export function ligneDepuisProduit(
  produit: Produit, devisId: string, lotId: string, position: number, quantite = 1,
): Partial<DevisLigne> {
  return {
    devis_id: devisId, lot_id: lotId, position,
    produit_id: produit.id,
    designation: produit.designation,
    description: produit.description,
    nature: produit.nature,
    unite: produit.unite,
    quantite,
    prix_unitaire_ht: produit.prix_vente_ht,
    remise_pct: 0,
    prix_achat_ht: produit.prix_achat_ht,
    taux_tva: 20,
    taux_force: false,
  };
}

export async function appliquerGabarit(
  devisId: string, gabarit: Gabarit, titreZone: string, produits: Produit[], positionLot: number,
): Promise<DevisLot> {
  const parReference = new Map(produits.map((p) => [p.reference, p]));
  const racine = await ajouterLot(devisId, titreZone, null, positionLot);

  for (const [i, sousLot] of gabarit.sous_lots.entries()) {
    const lot = await ajouterLot(devisId, sousLot.titre, racine.id, i);
    const lignes = sousLot.lignes
      .map((l, j) => {
        const p = parReference.get(l.reference);
        return p ? ligneDepuisProduit(p, devisId, lot.id, j, l.quantite) : null;
      })
      .filter((l): l is Partial<DevisLigne> => l !== null);
    await ajouterLignes(lignes);
  }
  return racine;
}

// --- Factures ---------------------------------------------------------------

export const LIBELLES_FACTURE: Record<TypeFacture, string> = {
  acompte: 'Facture d’acompte', situation: 'Situation de travaux',
  solde: 'Facture de solde', facture: 'Facture', avoir: 'Avoir',
};

export type FactureAvecTiers = Facture & {
  tiers: Pick<Tiers, 'id' | 'nom' | 'ville'> | null;
  chantier: Pick<Chantier, 'id' | 'numero'> | null;
};

export async function listerFactures(): Promise<FactureAvecTiers[]> {
  return ok(await supabase.from('facture')
    .select('*, tiers(id, nom, ville), chantier(id, numero)')
    .order('date_emission', { ascending: false })
    .order('created_at', { ascending: false }));
}

export interface FactureComplete {
  facture: Facture;
  lignes: FactureLigne[];
  tiers: Tiers | null;
  site: Site | null;
}

export async function chargerFacture(id: string): Promise<FactureComplete> {
  const facture = ok<Facture>(await supabase.from('facture').select('*').eq('id', id).single());
  const [lignes, tiers, site] = await Promise.all([
    ok<FactureLigne[]>(await supabase.from('facture_ligne').select('*')
      .eq('facture_id', id).order('position')),
    facture.tiers_id ? chargerTiers(facture.tiers_id) : Promise.resolve(null),
    facture.site_id
      ? ok<Site>(await supabase.from('site').select('*').eq('id', facture.site_id).single())
      : Promise.resolve(null),
  ]);
  return { facture, lignes, tiers, site };
}

export async function enregistrerFacture(f: Partial<Facture>): Promise<Facture> {
  if (f.id) return ok(await supabase.from('facture').update(f).eq('id', f.id).select().single());
  return ok(await supabase.from('facture').insert({ ...ent(), ...f }).select().single());
}

export async function supprimerFacture(id: string): Promise<void> {
  ok(await supabase.from('facture').delete().eq('id', id).select('id'));
}

export async function ajouterLigneFacture(l: Partial<FactureLigne>): Promise<FactureLigne> {
  return ok(await supabase.from('facture_ligne').insert({ ...ent(), ...l }).select().single());
}

export async function majLigneFacture(id: string, patch: Partial<FactureLigne>): Promise<void> {
  ok(await supabase.from('facture_ligne').update(patch).eq('id', id).select('id'));
}

export async function supprimerLigneFacture(id: string): Promise<void> {
  ok(await supabase.from('facture_ligne').delete().eq('id', id).select('id'));
}

/**
 * Émet la facture : numéro et changement d'état, côté serveur, en une fois.
 *
 * Le numéro ne s'attribue qu'ici. Un brouillon qui prendrait un numéro puis
 * serait supprimé laisserait un trou dans la série — précisément ce qu'un
 * contrôle regarde. Après cet appel, la facture est figée : la base refuse
 * toute modification de son contenu, y compris depuis l'éditeur SQL.
 */
export async function emettreFacture(id: string): Promise<string> {
  return ok(await supabase.rpc('emettre_facture', { p_id: id }));
}

/**
 * Fabrique une facture depuis un devis signé.
 *
 * Trois formes. Un **acompte** reprend un pourcentage du devis, ventilé par
 * taux de TVA : un acompte forfaitaire à 20 % sur un devis mêlant 5,5 % et
 * 20 % donnerait une TVA fausse, alors on émet une ligne par taux. Un
 * **solde** reprend toutes les lignes et déduit ce qui a déjà été facturé en
 * acompte. Une **facture** simple reprend tout, sans déduction.
 */
export async function factureDepuisDevis(
  devisId: string,
  options: { type: TypeFacture; pourcentage?: number; acompteDeduit?: number },
): Promise<Facture> {
  const { devis, lignes } = await chargerDevis(devisId);
  const [chantiers, params] = await Promise.all([
    listerChantiers().catch(() => []),
    chargerParametres().catch(() => null),
  ]);
  const chantier = chantiers.find((c) => c.devis_id === devisId);
  const delai = Number(params?.delai_paiement_jours) || 30;

  const facture = await enregistrerFacture({
    type: options.type,
    devis_id: devis.id,
    chantier_id: chantier?.id ?? null,
    tiers_id: devis.tiers_id,
    site_id: devis.site_id,
    titre: devis.titre,
    date_emission: new Date().toISOString().slice(0, 10),
    // Le délai réglé dans Entreprise. Trente jours à défaut : c'est le délai
    // supplétif du code de commerce, soixante le maximum entre professionnels.
    echeance_le: new Date(Date.now() + delai * 86400000).toISOString().slice(0, 10),
    acompte_deduit: options.acompteDeduit ?? 0,
    notes_internes: `Établie depuis le devis ${devis.numero}.`,
  });

  if (options.type === 'acompte' || options.type === 'situation') {
    const part = (options.pourcentage ?? 30) / 100;
    // Une ligne par taux : l'acompte porte la même ventilation que le devis.
    const bases = new Map<number, number>();
    for (const l of lignes) {
      const ht = Number(l.quantite) * Number(l.prix_unitaire_ht)
        * (1 - Number(l.remise_pct) / 100);
      bases.set(Number(l.taux_tva), (bases.get(Number(l.taux_tva)) ?? 0) + ht);
    }
    const intitule = options.type === 'acompte' ? 'Acompte' : 'Situation';
    let position = 0;
    for (const [taux, base] of [...bases.entries()].sort((a, b) => a[0] - b[0])) {
      await ajouterLigneFacture({
        facture_id: facture.id,
        position: position++,
        designation: bases.size > 1
          ? `${intitule} de ${options.pourcentage ?? 30} % — part à ${taux} %`
          : `${intitule} de ${options.pourcentage ?? 30} % sur le devis ${devis.numero}`,
        unite: 'forfait',
        quantite: 1,
        prix_unitaire_ht: Math.round(base * part * 100) / 100,
        taux_tva: taux,
      });
    }
  } else {
    await Promise.all(lignes
      .sort((a, b) => a.position - b.position)
      .map((l, i) => ajouterLigneFacture({
        facture_id: facture.id,
        position: i,
        produit_id: l.produit_id,
        devis_ligne_id: l.id,
        designation: l.designation,
        description: l.description,
        unite: l.unite,
        quantite: l.quantite,
        prix_unitaire_ht: l.prix_unitaire_ht,
        remise_pct: l.remise_pct,
        taux_tva: l.taux_tva,
        justification_tva: l.justification_tva,
      })));
  }

  return chargerFacture(facture.id).then((f) => f.facture);
}

/**
 * L'avoir : la seule façon d'annuler une facture émise.
 *
 * Il reprend les lignes à l'identique et en inverse le signe. On ne raye pas
 * une facture, on écrit son contraire — et les deux documents restent.
 */
export async function creerAvoir(factureId: string, motif: string): Promise<Facture> {
  const { facture, lignes } = await chargerFacture(factureId);
  const avoir = await enregistrerFacture({
    type: 'avoir',
    facture_origine_id: facture.id,
    devis_id: facture.devis_id,
    chantier_id: facture.chantier_id,
    tiers_id: facture.tiers_id,
    site_id: facture.site_id,
    titre: `Avoir sur ${facture.numero ?? 'facture'}`,
    intro: motif,
    date_emission: new Date().toISOString().slice(0, 10),
    remise_montant: -Number(facture.remise_montant),
    acompte_deduit: -Number(facture.acompte_deduit),
    notes_internes: `Annule la facture ${facture.numero ?? ''}.`,
  });

  await Promise.all(lignes.map((l, i) => ajouterLigneFacture({
    facture_id: avoir.id,
    position: i,
    designation: l.designation,
    description: l.description,
    unite: l.unite,
    quantite: l.quantite,
    prix_unitaire_ht: -Number(l.prix_unitaire_ht),
    remise_pct: l.remise_pct,
    taux_tva: l.taux_tva,
  })));

  return avoir;
}

// --- Chantiers --------------------------------------------------------------

export type ChantierAvecTiers = Chantier & { tiers: Pick<Tiers, 'id' | 'nom'> | null };

/**
 * Les jeux de préalables proposés au démarrage, par métier.
 *
 * Ils vivent dans le code et non en base : c'est du contenu éditorial, pas
 * une donnée de l'entreprise. On les charge une fois, on les modifie ensuite
 * librement — après quoi ces listes ne servent plus à rien.
 */
export const JEUX_PREALABLES: Record<string, {
  libelle: string; lignes: { cle: string; libelle: string; aide?: string }[];
}> = {
  climatisation: {
    libelle: 'Climatisation et pompes à chaleur',
    lignes: [
      { cle: 'accord_copro', libelle: 'Accord de copropriété obtenu',
        aide: 'Une unité extérieure en façade ou sur balcon touche aux parties communes.' },
      { cle: 'declaration_prealable', libelle: 'Déclaration préalable accordée',
        aide: 'Obligatoire dès que l’aspect extérieur change. Un mois d’instruction.' },
      { cle: 'acompte_encaisse', libelle: 'Acompte encaissé' },
      { cle: 'materiel_commande', libelle: 'Matériel commandé' },
      { cle: 'materiel_livre', libelle: 'Matériel livré' },
      { cle: 'acces_confirme', libelle: 'Accès et stationnement confirmés',
        aide: 'Nacelle, échafaudage, autorisation de voirie : ça se demande à l’avance.' },
      { cle: 'alim_elec', libelle: 'Alimentation électrique vérifiée' },
    ],
  },
  plomberie: {
    libelle: 'Plomberie et chauffage',
    lignes: [
      { cle: 'acompte_encaisse', libelle: 'Acompte encaissé' },
      { cle: 'materiel_commande', libelle: 'Matériel commandé' },
      { cle: 'materiel_livre', libelle: 'Matériel livré' },
      { cle: 'coupure_eau', libelle: 'Coupure d’eau organisée avec le client' },
      { cle: 'evacuation', libelle: 'Évacuation et raccordement repérés' },
      { cle: 'acces_confirme', libelle: 'Accès et stationnement confirmés' },
    ],
  },
  electricite: {
    libelle: 'Électricité',
    lignes: [
      { cle: 'acompte_encaisse', libelle: 'Acompte encaissé' },
      { cle: 'materiel_commande', libelle: 'Matériel commandé' },
      { cle: 'consuel', libelle: 'Dossier Consuel préparé' },
      { cle: 'coupure_elec', libelle: 'Coupure de courant organisée' },
      { cle: 'tableau_repere', libelle: 'Tableau et arrivée repérés' },
      { cle: 'acces_confirme', libelle: 'Accès et stationnement confirmés' },
    ],
  },
  general: {
    libelle: 'Tous corps d’état',
    lignes: [
      { cle: 'acompte_encaisse', libelle: 'Acompte encaissé' },
      { cle: 'autorisations', libelle: 'Autorisations obtenues' },
      { cle: 'materiel_livre', libelle: 'Matériel livré' },
      { cle: 'acces_confirme', libelle: 'Accès et stationnement confirmés' },
      { cle: 'equipe_prevenue', libelle: 'Équipe prévenue et disponible' },
    ],
  },
};

export async function listerPrealables(): Promise<Prealable[]> {
  return ok(await supabase.from('prealable').select('*').eq('actif', true).order('position'));
}

export async function enregistrerPrealable(p: Partial<Prealable>): Promise<Prealable> {
  if (p.id) return ok(await supabase.from('prealable').update(p).eq('id', p.id).select().single());
  return ok(await supabase.from('prealable').insert({ ...ent(), ...p }).select().single());
}

export async function supprimerPrealable(id: string): Promise<void> {
  ok(await supabase.from('prealable').delete().eq('id', id).select('id'));
}

/**
 * Remplace la liste de l'entreprise par un jeu type.
 *
 * Les chantiers existants ne bougent pas : ils portent leur propre copie, ou
 * retomberont sur l'ancienne liste s'ils n'en ont pas. Changer d'avis sur
 * l'organisation ne doit pas réécrire l'histoire des chantiers en cours.
 */
export async function chargerJeuPrealables(jeu: string): Promise<void> {
  const modele = JEUX_PREALABLES[jeu];
  if (!modele) throw new Error('Jeu de préalables inconnu.');
  const existants = await listerPrealables();
  await Promise.all(existants.map((p) => supprimerPrealable(p.id)));
  ok(await supabase.from('prealable').insert(
    modele.lignes.map((l, i) => ({ ...ent(), ...l, aide: l.aide ?? null, position: i })),
  ).select('id'));
}

/** Une clé lisible, fabriquée depuis le libellé, quand on ajoute une ligne. */
export function clePrealable(libelle: string): string {
  return libelle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'prealable';
}

/**
 * Les préalables qui s'appliquent à un chantier.
 *
 * Sa propre copie si elle existe, sinon la liste de l'entreprise. Les
 * chantiers créés avant le SQL 16 n'ont pas de copie : ils retombent sur la
 * liste courante, ce qui reproduit le comportement d'avant.
 */
export function prealablesDu(
  chantier: { prealables: PrealableChantier[] | null }, entreprise: Prealable[],
): PrealableChantier[] {
  if (chantier.prealables?.length) return chantier.prealables;
  return entreprise.map((p) => ({ cle: p.cle, libelle: p.libelle, aide: p.aide }));
}

export async function listerChantiers(): Promise<ChantierAvecTiers[]> {
  return ok(await supabase.from('chantier').select('*, tiers(id, nom)').order('created_at', { ascending: false }));
}

export async function chargerChantier(id: string): Promise<ChantierAvecTiers> {
  return ok(await supabase.from('chantier').select('*, tiers(id, nom)').eq('id', id).single());
}

export async function creerChantier(init: Partial<Chantier>): Promise<Chantier> {
  const numero = ok<string>(await supabase.rpc('prochain_numero', { p_type: 'chantier' }));
  // Copie de la liste au moment de la création, pas une référence : modifier
  // l'organisation plus tard ne doit ni décocher ni rouvrir un chantier en cours.
  const liste = await listerPrealables().catch(() => []);
  return ok(await supabase.from('chantier').insert({
    ...ent(), numero,
    prealables: liste.map((p) => ({ cle: p.cle, libelle: p.libelle, aide: p.aide })),
    ...init,
  }).select().single());
}

export async function majChantier(id: string, patch: Partial<Chantier>): Promise<void> {
  ok(await supabase.from('chantier').update(patch).eq('id', id).select());
}

export async function supprimerChantier(id: string): Promise<void> {
  ok(await supabase.from('chantier').delete().eq('id', id).select());
}

/** Un devis signé devient un chantier, sans ressaisie. */
export async function chantierDepuisDevis(devisId: string): Promise<Chantier> {
  const { devis } = await chargerDevis(devisId);
  if (!devis.tiers_id) throw new Error('Ce devis n’a pas de client.');
  const chantier = await creerChantier({
    devis_id: devis.id,
    tiers_id: devis.tiers_id,
    site_id: devis.site_id,
    libelle: devis.titre ?? `Chantier ${devis.numero}`,
  });
  await ajouterFil({
    tiers_id: devis.tiers_id, chantier_id: chantier.id, devis_id: devis.id,
    type: 'systeme', sujet: `Chantier ${chantier.numero} ouvert depuis le devis ${devis.numero}`,
  });
  return chantier;
}

// --- Pointage des heures ----------------------------------------------------

export const TYPES_POINTAGE: Record<string, string> = {
  pose: 'Pose', deplacement: 'Déplacement', preparation: 'Préparation',
  sav: 'SAV', entretien: 'Entretien', attente: 'Attente', atelier: 'Atelier',
  autre: 'Autre',
};

export type PointageDetaille = Pointage & {
  membre: Pick<Membre, 'id' | 'nom'> | null;
  chantier: Pick<Chantier, 'id' | 'numero' | 'libelle'> | null;
};

/**
 * Les heures déclarées.
 *
 * La RLS fait le tri toute seule : un technicien ne reçoit que les siennes,
 * la direction et les chefs de chantier reçoivent tout. L'appelant n'a donc
 * pas à filtrer par rôle, et ne peut pas se tromper en le faisant.
 */
export async function listerPointages(
  filtre: { membreId?: string; chantierId?: string; depuis?: string; jusqu?: string } = {},
): Promise<PointageDetaille[]> {
  let q = supabase.from('pointage')
    .select('*, membre(id, nom), chantier(id, numero, libelle)')
    .order('jour', { ascending: false })
    .limit(2000);
  if (filtre.membreId) q = q.eq('membre_id', filtre.membreId);
  if (filtre.chantierId) q = q.eq('chantier_id', filtre.chantierId);
  if (filtre.depuis) q = q.gte('jour', filtre.depuis);
  if (filtre.jusqu) q = q.lte('jour', filtre.jusqu);
  return ok(await q);
}

export async function enregistrerPointage(p: Partial<Pointage>): Promise<Pointage> {
  if (p.id) return ok(await supabase.from('pointage').update(p).eq('id', p.id).select().single());
  return ok(await supabase.from('pointage')
    .insert({ ...ent(), membre_id: p.membre_id ?? membre().id, ...p }).select().single());
}

export async function supprimerPointage(id: string): Promise<void> {
  ok(await supabase.from('pointage').delete().eq('id', id).select('id'));
}

/** Fige des lignes. Réservé à la direction : la base refuse aux autres. */
export async function validerPointages(ids: string[], valide = true): Promise<void> {
  if (!ids.length) return;
  ok(await supabase.from('pointage')
    .update({ valide, valide_le: valide ? new Date().toISOString() : null })
    .in('id', ids).select('id'));
}

/**
 * Heures et coût réel par chantier.
 *
 * Le taux appliqué est celui du jour travaillé, pas celui d'aujourd'hui :
 * une augmentation en avril ne renchérit pas un chantier de février. C'est
 * pour ça que les rémunérations sont historisées.
 */
export async function coutsMainOeuvre(): Promise<Map<string, CoutMainOeuvre>> {
  const lignes = ok<CoutMainOeuvre[]>(
    await supabase.from('v_cout_main_oeuvre').select('*'),
  );
  return new Map(lignes.map((l) => [l.chantier_id, l]));
}

/** « 7,5 » se lit mal sur une feuille d'heures. « 7 h 30 » se lit tout seul. */
export function heuresLisibles(h: number): string {
  const total = Math.round(Number(h) * 60);
  const heures = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? `${heures} h` : `${heures} h ${String(minutes).padStart(2, '0')}`;
}

// --- Fiche de pose ----------------------------------------------------------

/**
 * Une ligne telle qu'un poseur la voit : quoi, combien, où, comment.
 * Aucun prix — la vue en base n'en expose aucun, ce n'est pas un choix
 * d'interface qu'on pourrait défaire par mégarde.
 */
export interface LignePose {
  id: string;
  devis_id: string;
  lot_id: string;
  position: number;
  designation: string;
  description: string | null;
  nature: Nature;
  unite: string;
  quantite: number;
  consigne_pose: string | null;
  emplacement: string | null;
  reference: string | null;
  zone: string | null;
  sous_lot: string | null;
  zone_position: number;
  lot_position: number;
}

export interface FichePose {
  chantier: ChantierAvecTiers;
  site: Site | null;
  tiers: Pick<Tiers, 'id' | 'nom' | 'telephone'> | null;
  lignes: LignePose[];
  /** Vrai quand le chantier n'a pas de devis : il n'y a alors rien à poser. */
  sansDevis: boolean;
}

/**
 * Tout ce dont un poseur a besoin sur place, et rien d'autre.
 *
 * Le chantier, le site avec ses contraintes d'accès, le client pour le
 * prévenir en arrivant, et le contenu du devis sans un chiffre en euros.
 */
export async function chargerFichePose(chantierId: string): Promise<FichePose> {
  const chantier = await chargerChantier(chantierId);

  const [site, tiers, lignes] = await Promise.all([
    chantier.site_id
      ? ok<Site>(await supabase.from('site').select('*').eq('id', chantier.site_id).single())
      : Promise.resolve(null),
    chantier.tiers_id
      ? ok<Pick<Tiers, 'id' | 'nom' | 'telephone'>>(
          await supabase.from('tiers').select('id, nom, telephone')
            .eq('id', chantier.tiers_id).single())
      : Promise.resolve(null),
    chantier.devis_id
      ? ok<LignePose[]>(await supabase.from('v_fiche_pose').select('*')
          .eq('devis_id', chantier.devis_id)
          .order('zone_position').order('lot_position').order('position'))
      : Promise.resolve([] as LignePose[]),
  ]);

  return { chantier, site, tiers, lignes, sansDevis: !chantier.devis_id };
}

// --- Approvisionnement ------------------------------------------------------

export async function listerApprovisionnement(chantierId: string): Promise<Approvisionnement[]> {
  return ok(await supabase.from('approvisionnement').select('*')
    .eq('chantier_id', chantierId).order('position'));
}

export async function enregistrerApprovisionnement(
  a: Partial<Approvisionnement>,
): Promise<Approvisionnement> {
  if (a.id) {
    return ok(await supabase.from('approvisionnement').update(a).eq('id', a.id).select().single());
  }
  return ok(await supabase.from('approvisionnement')
    .insert({ ...ent(), ...a }).select().single());
}

export async function supprimerApprovisionnement(id: string): Promise<void> {
  ok(await supabase.from('approvisionnement').delete().eq('id', id).select('id'));
}

// --- Effacement et conformité -----------------------------------------------

export interface Effacement {
  id: string;
  entreprise_id: string;
  tiers_id: string | null;
  nom_efface: string;
  motif: string | null;
  conserve: string | null;
  demande_le: string;
  traite_le: string;
  traite_par: string | null;
}

export async function listerEffacements(): Promise<Effacement[]> {
  return ok(await supabase.from('effacement').select('*')
    .order('traite_le', { ascending: false }));
}

/**
 * Efface les données personnelles d'un tiers en conservant l'écriture comptable.
 *
 * Irréversible, et réservé à la direction — la base le vérifie elle-même. Rend
 * le compte rendu de ce qui a été effacé et de ce qui a été gardé : on ne
 * demande à personne de croire sur parole qu'un effacement a eu lieu.
 */
export async function anonymiserTiers(tiersId: string, motif: string | null): Promise<string> {
  return ok(await supabase.rpc('anonymiser_tiers', { p_tiers: tiersId, p_motif: motif }));
}

/**
 * Ce que l'effacement va emporter, avant de cliquer.
 *
 * Un acte irréversible dont on découvre la portée une fois fait est un piège.
 * `liberation` est la date à partir de laquelle l'identité pourra vraiment
 * disparaître : dix ans après la clôture de l'exercice de la dernière facture.
 */
export async function porteeEffacement(tiersId: string): Promise<{
  factures: number; devis: number; liberation: string | null;
}> {
  const r = ok<{ factures: number; devis: number; liberation: string | null }[]>(
    await supabase.rpc('portee_effacement', { p_tiers: tiersId }));
  return r?.[0] ?? { factures: 0, devis: 0, liberation: null };
}

/** Efface le contenu des appels à l'IA de plus de N jours. La trace reste. */
export async function purgerJournalIA(jours = 30): Promise<number> {
  return ok(await supabase.rpc('purger_journal_ia', { p_jours: jours }));
}

// --- Achats -----------------------------------------------------------------

export const STATUTS_ACHAT: Record<Achat['statut'], string> = {
  a_rapprocher: 'À rapprocher', rapproche: 'Rapprochée',
  paye: 'Payée', litige: 'En litige',
};

export type AchatAvecLignes = Achat & { lignes: number; rattachees: number };

export async function listerAchats(): Promise<AchatAvecLignes[]> {
  const [achats, lignes] = await Promise.all([
    ok<Achat[]>(await supabase.from('achat').select('*')
      .order('date_facture', { ascending: false }).limit(1000)),
    ok<Pick<AchatLigne, 'achat_id' | 'chantier_id'>[]>(
      await supabase.from('achat_ligne').select('achat_id, chantier_id').limit(10000)),
  ]);
  return achats.map((a) => {
    const siennes = lignes.filter((l) => l.achat_id === a.id);
    return {
      ...a,
      lignes: siennes.length,
      rattachees: siennes.filter((l) => l.chantier_id).length,
    };
  });
}

/**
 * Le ticket de comptoir, en trois champs.
 *
 * Fabrice achète 40 € de goulottes en passant. S'il faut créer une facture
 * puis lui ajouter une ligne, il ne le fera pas, et le coût disparaîtra du
 * chantier — c'est la raison pour laquelle interdire les dépenses de matériel
 * ne suffisait pas : il fallait aussi que le geste reste aussi rapide.
 *
 * Ce qui sort est un achat ordinaire, à une ligne, rapprochable comme les
 * autres. Rien de spécial en base : une facture reste une facture.
 */
export async function saisieRapideAchat(x: {
  fournisseur: string;
  montant_ht: number;
  libelle: string;
  chantier_id?: string | null;
  date_facture?: string;
  numero?: string | null;
  taux_tva?: number;
  tva_recuperable?: boolean;
  membre_id?: string | null;
}): Promise<Achat> {
  const achat = await enregistrerAchat({
    fournisseur: x.fournisseur.trim(),
    numero: x.numero?.trim() || null,
    date_facture: x.date_facture ?? new Date().toISOString().slice(0, 10),
    montant_ht: x.montant_ht,
    tva_recuperable: x.tva_recuperable ?? true,
    membre_id: x.membre_id ?? null,
    statut: x.chantier_id ? 'rapproche' : 'a_rapprocher',
  });
  await ajouterLigneAchatSimple(achat.id, x);
  return achat;
}

async function ajouterLigneAchatSimple(achatId: string, x: {
  libelle: string; montant_ht: number; chantier_id?: string | null; taux_tva?: number;
}): Promise<void> {
  await enregistrerLigneAchat({
    achat_id: achatId,
    chantier_id: x.chantier_id ?? null,
    position: 0,
    designation: x.libelle.trim() || 'Achat',
    unite: 'lot',
    quantite: 1,
    prix_unitaire_ht: x.montant_ht,
    taux_tva: x.taux_tva ?? 20,
  });
}

export async function listerLignesAchat(achatId: string): Promise<AchatLigne[]> {
  return ok(await supabase.from('achat_ligne').select('*')
    .eq('achat_id', achatId).order('position'));
}

export async function enregistrerAchat(a: Partial<Achat>): Promise<Achat> {
  if (a.id) return ok(await supabase.from('achat').update(a).eq('id', a.id).select().single());
  return ok(await supabase.from('achat').insert({ ...ent(), ...a }).select().single());
}

export async function supprimerAchat(id: string): Promise<void> {
  ok(await supabase.from('achat').delete().eq('id', id).select('id'));
}

export async function enregistrerLigneAchat(l: Partial<AchatLigne>): Promise<AchatLigne> {
  if (l.id) {
    return ok(await supabase.from('achat_ligne').update(l).eq('id', l.id).select().single());
  }
  return ok(await supabase.from('achat_ligne').insert({ ...ent(), ...l }).select().single());
}

export async function supprimerLigneAchat(id: string): Promise<void> {
  ok(await supabase.from('achat_ligne').delete().eq('id', id).select('id'));
}

/**
 * Rapproche une ligne facturée d'une ligne prévue.
 *
 * Le rattachement au chantier suit automatiquement : c'est tout l'intérêt du
 * geste, et l'oublier laisserait un coût dans le vide. La date de livraison
 * est renseignée du même mouvement si elle ne l'était pas — une facture
 * arrive rarement avant la marchandise.
 */
export async function rapprocher(ligneId: string, approId: string | null): Promise<void> {
  if (!approId) {
    ok(await supabase.from('achat_ligne')
      .update({ approvisionnement_id: null }).eq('id', ligneId).select('id'));
    return;
  }
  const appro = ok<Approvisionnement>(
    await supabase.from('approvisionnement').select('*').eq('id', approId).single());

  ok(await supabase.from('achat_ligne').update({
    approvisionnement_id: approId,
    chantier_id: appro.chantier_id,
    produit_id: appro.produit_id,
  }).eq('id', ligneId).select('id'));

  if (!appro.livre_le) {
    await enregistrerApprovisionnement({
      id: approId, livre_le: new Date().toISOString().slice(0, 10),
    }).catch(() => undefined);
  }
}

/** Les lignes prévues d'un chantier, pour proposer un rapprochement. */
export async function approvisionnementsOuverts(): Promise<
  (Approvisionnement & { chantier: Pick<Chantier, 'id' | 'numero' | 'libelle'> | null })[]
> {
  return ok(await supabase.from('approvisionnement')
    .select('*, chantier(id, numero, libelle)')
    .order('position').limit(2000));
}

export async function coutsReels(): Promise<Map<string, CoutReel>> {
  const lignes = ok<CoutReel[]>(await supabase.from('v_cout_reel_chantier').select('*'));
  return new Map(lignes.map((l) => [l.chantier_id, l]));
}

/**
 * Aligne le prix d'achat du catalogue sur ce qui est réellement facturé.
 *
 * Le geste que l'écran des écarts appelle : constater une dérive sans pouvoir
 * la corriger sur place obligerait à retrouver la référence au catalogue, et
 * on ne le ferait pas. Les devis déjà établis ne bougent pas — ils portent
 * leur propre prix d'achat, figé à leur création.
 */
export async function alignerPrixCatalogue(produitId: string, prix: number): Promise<void> {
  ok(await supabase.from('produit')
    .update({ prix_achat_ht: prix }).eq('id', produitId).select('id'));
}

export async function ecartsAchat(): Promise<EcartAchat[]> {
  return ok(await supabase.from('v_ecart_achat').select('*')
    .order('ecart_pct', { ascending: false, nullsFirst: false }));
}

// --- La signature d'un devis ------------------------------------------------

export interface SuiteSignature {
  devis: Devis;
  chantier: Chantier;
  facture: Facture | null;
  approvisionnements: number;
  interventions: number;
  encaissements: number;
  avertissements: string[];
}

/**
 * Tout ce qu'entraîne la signature d'un devis, en une fois.
 *
 * Avant, signer ne faisait que changer un statut : il fallait ensuite ouvrir
 * le chantier à la main, retaper la liste du matériel, créer les
 * interventions, générer les échéances et fabriquer la facture d'acompte.
 * Cinq gestes, tous mécaniques, tous oubliables — et une information déjà
 * saisie qu'on ressaisit, ce que ce projet s'interdit partout ailleurs.
 *
 * Ce qui reste au gérant après cet appel : les dates et les personnes. C'est
 * exactement ce que la machine ne peut pas décider à sa place.
 *
 * Chaque étape est indépendante : si l'une échoue, les autres se font quand
 * même et l'échec est rapporté. Signer un devis ne doit pas être bloqué parce
 * qu'une facture d'acompte n'a pas pu se créer.
 */
export async function signerDevis(
  devisId: string,
  mode: Devis['mode_conclusion'],
  options: { acompte?: boolean; pourcentageAcompte?: number } = {},
): Promise<SuiteSignature> {
  const avertissements: string[] = [];
  const devis = await marquerSigne(devisId, mode);

  // 1. Le chantier, ou celui qui existe déjà si on resigne.
  const existants = await listerChantiers().catch(() => []);
  let chantier = existants.find((c) => c.devis_id === devisId) as Chantier | undefined;
  if (!chantier) chantier = await chantierDepuisDevis(devisId);

  const { lignes } = await chargerDevis(devisId);
  const produits = await listerProduits(true).catch(() => []);
  const parProduit = new Map(produits.map((p) => [p.id, p]));

  // 2. Le matériel à commander : les fournitures, pas la main-d'œuvre.
  //    Une ligne de pose n'a rien à faire dans une liste de livraison.
  let approvisionnements = 0;
  try {
    const dejaLa = await listerApprovisionnement(chantier.id);
    if (dejaLa.length === 0) {
      const aCreer = lignes
        .filter((l) => (l.produit_id ? parProduit.get(l.produit_id)?.nature : l.nature) === 'fourniture')
        .sort((a, b) => a.position - b.position)
        .map((l, i) => ({
          ...ent(),
          chantier_id: chantier!.id,
          produit_id: l.produit_id,
          devis_ligne_id: l.id,
          designation: l.designation,
          reference: l.produit_id ? parProduit.get(l.produit_id)?.reference ?? null : null,
          unite: l.unite,
          quantite: l.quantite,
          position: i,
        }));
      if (aCreer.length) {
        ok(await supabase.from('approvisionnement').insert(aCreer).select('id'));
        approvisionnements = aCreer.length;
      }
    }
  } catch (e) {
    avertissements.push(`Liste de matériel non créée : ${(e as Error).message}`);
  }

  // 3. Les interventions, sans date ni personne.
  //    Une seule par nature de travail plutôt qu'une par ligne : vingt
  //    interventions « pose » sur un calendrier ne se planifient pas, elles
  //    s'ignorent. Le gérant les datera et les affectera.
  let interventions = 0;
  try {
    const dejaLa = await listerInterventions(chantier.id);
    if (dejaLa.length === 0) {
      const natures = new Set(lignes.map((l) =>
        (l.produit_id ? parProduit.get(l.produit_id)?.nature : l.nature) ?? 'fourniture'));
      const aPlanifier: Intervention['type'][] = ['pose'];
      if (devis.type_prestation === 'entretien') aPlanifier[0] = 'entretien';
      if (devis.type_prestation === 'depannage') aPlanifier[0] = 'sav';
      if (natures.has('pose') || natures.has('fourniture')) {
        aPlanifier.push('mise_en_service');
      }
      for (const type of aPlanifier) {
        await enregistrerIntervention({
          chantier_id: chantier.id, tiers_id: devis.tiers_id, type, statut: 'planifiee',
        });
        interventions++;
      }
    }
  } catch (e) {
    avertissements.push(`Interventions non créées : ${(e as Error).message}`);
  }

  // 4. Les échéances d'encaissement, depuis l'échéancier du devis.
  let encaissements = 0;
  try {
    const site = devis.site_id
      ? ok<Site>(await supabase.from('site').select('*').eq('id', devis.site_id).single())
      : null;
    const calcul = calculerDevis(devis, (await chargerDevis(devisId)).lots, lignes,
      parProduit, site);
    const deja = (await listerEncaissements().catch(() => []))
      .filter((e) => e.devis_id === devisId);
    if (deja.length === 0) {
      encaissements = await genererEncaissements(devisId, calcul.totalTtc);
    }
  } catch (e) {
    avertissements.push(`Échéances non générées : ${(e as Error).message}`);
  }

  // 5. La facture d'acompte, si elle est demandée.
  let facture: Facture | null = null;
  if (options.acompte !== false) {
    try {
      const params = await chargerParametres().catch(() => null);
      facture = await factureDepuisDevis(devisId, {
        type: 'acompte',
        pourcentage: options.pourcentageAcompte ?? (Number(params?.acompte_defaut_pct) || 30),
      });
    } catch (e) {
      avertissements.push(`Facture d'acompte non créée : ${(e as Error).message}`);
    }
  }

  await ajouterFil({
    tiers_id: devis.tiers_id, devis_id: devisId, chantier_id: chantier.id,
    type: 'devis_signe',
    sujet: `Devis ${devis.numero} signé`,
    contenu: [
      `Chantier ${chantier.numero} ouvert.`,
      approvisionnements ? `${approvisionnements} référence(s) à commander.` : null,
      interventions ? `${interventions} intervention(s) à planifier.` : null,
      facture ? 'Facture d’acompte en brouillon.' : null,
      devis.encaissement_autorise_le
        ? `Encaissement autorisé à partir du ${devis.encaissement_autorise_le}.`
        : null,
    ].filter(Boolean).join(' '),
  }).catch(() => undefined);

  return { devis, chantier, facture, approvisionnements, interventions, encaissements, avertissements };
}

// --- Interventions et matériel ---------------------------------------------

export async function listerInterventions(chantierId?: string): Promise<Intervention[]> {
  let q = supabase.from('intervention').select('*').order('date_prevue', { ascending: true });
  if (chantierId) q = q.eq('chantier_id', chantierId);
  return ok(await q);
}

export async function enregistrerIntervention(i: Partial<Intervention>): Promise<Intervention> {
  if (i.id) return ok(await supabase.from('intervention').update(i).eq('id', i.id).select().single());
  return ok(await supabase.from('intervention').insert({ ...ent(), ...i }).select().single());
}

export async function supprimerIntervention(id: string): Promise<void> {
  ok(await supabase.from('intervention').delete().eq('id', id).select());
}

export async function listerEquipements(filtre: { siteId?: string; chantierId?: string } = {}): Promise<Equipement[]> {
  let q = supabase.from('equipement').select('*').order('created_at', { ascending: false });
  if (filtre.siteId) q = q.eq('site_id', filtre.siteId);
  if (filtre.chantierId) q = q.eq('chantier_id', filtre.chantierId);
  return ok(await q);
}

export async function enregistrerEquipement(e: Partial<Equipement>): Promise<Equipement> {
  if (e.id) return ok(await supabase.from('equipement').update(e).eq('id', e.id).select().single());
  return ok(await supabase.from('equipement').insert({ ...ent(), ...e }).select().single());
}

// --- Bibliothèque de documents ---------------------------------------------

/**
 * Le vocabulaire, avec ce que chaque pièce veut dire.
 *
 * `echeance: true` marque celles qui périment : la cloche les surveille, et
 * le formulaire réclame alors une date. `vigilance: true` marque celles que
 * la loi impose de réclamer à un sous-traitant — leur absence expose le
 * donneur d'ordre à la solidarité financière sur les cotisations et les
 * salaires impayés de son prestataire.
 */
export const LIBELLES_DOCUMENT: Record<
  TypeDocument, { libelle: string; echeance?: boolean; vigilance?: boolean }
> = {
  attestation_urssaf:           { libelle: 'Attestation de vigilance URSSAF', echeance: true, vigilance: true },
  kbis:                         { libelle: 'Extrait Kbis', echeance: true, vigilance: true },
  decennale:                    { libelle: 'Assurance décennale', echeance: true, vigilance: true },
  rc_pro:                       { libelle: 'Responsabilité civile professionnelle', echeance: true, vigilance: true },
  attestation_capacite_fluides: { libelle: 'Attestation de capacité fluides (entreprise)', echeance: true, vigilance: true },
  liste_salaries_etrangers:     { libelle: 'Liste des salariés étrangers', echeance: true, vigilance: true },
  rib:                          { libelle: 'RIB', vigilance: true },
  contrat:                      { libelle: 'Contrat de travail' },
  avenant:                      { libelle: 'Avenant' },
  bulletin:                     { libelle: 'Bulletin de paie' },
  permis:                       { libelle: 'Permis de conduire', echeance: true },
  visite_medicale:              { libelle: 'Visite médicale', echeance: true },
  diplome:                      { libelle: 'Diplôme ou titre' },
  attestation_aptitude_fluides: { libelle: 'Attestation d’aptitude fluides (personnelle)', echeance: true },
  facture:                      { libelle: 'Facture' },
  photo:                        { libelle: 'Photo' },
  autre:                        { libelle: 'Autre document' },
};

/** Où en est une pièce datée. Sert à la couleur autant qu'à la cloche. */
export function etatDocument(d: Pick<Document, 'expire_le'>, jours = 30):
  'sans_echeance' | 'perime' | 'bientot' | 'a_jour' {
  if (!d.expire_le) return 'sans_echeance';
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const seuil = new Date(Date.now() + jours * 86400000).toISOString().slice(0, 10);
  if (d.expire_le <= aujourdhui) return 'perime';
  return d.expire_le <= seuil ? 'bientot' : 'a_jour';
}

/** Toutes les pièces rattachées à un tiers, pour la liste des sous-traitants. */
export async function listerDocumentsTiers(): Promise<Document[]> {
  return ok(await supabase.from('document').select('*')
    .not('tiers_id', 'is', null).order('expire_le', { nullsFirst: false }).limit(1000));
}

/** Tout ce qui porte une échéance, pour la cloche. */
export async function listerDocumentsAEcheance(): Promise<Document[]> {
  return ok(await supabase.from('document').select('*')
    .not('expire_le', 'is', null).order('expire_le').limit(500));
}

/**
 * Crée ou modifie une pièce sans toucher au fichier.
 *
 * Une pièce peut exister sans fichier : on connaît souvent la date
 * d'expiration avant d'avoir reçu le papier, et une échéance surveillée vaut
 * mieux qu'un oubli. Le fichier se dépose après, sur la même ligne.
 */
export async function enregistrerDocument(d: Partial<Document>): Promise<Document> {
  if (d.id) {
    return ok(await supabase.from('document').update(d).eq('id', d.id).select().single());
  }
  return ok(await supabase.from('document')
    .insert({ ...ent(), depose_par: membre().id, ...d }).select().single());
}

/** Attache un fichier à une pièce déjà créée, ou le remplace. */
export async function attacherFichier(documentId: string, fichier: File): Promise<Document> {
  const extension = fichier.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const chemin = `${entrepriseId()}/piece/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('documents')
    .upload(chemin, fichier, { contentType: fichier.type || undefined });
  if (error) throw new Error(error.message);
  return ok(await supabase.from('document').update({
    chemin, nom: fichier.name, type_mime: fichier.type || null, taille_octets: fichier.size,
  }).eq('id', documentId).select().single());
}

// --- Tâches -----------------------------------------------------------------

export async function listerTaches(inclureFaites = false): Promise<Tache[]> {
  let q = supabase.from('tache').select('*').order('rang').order('created_at');
  if (!inclureFaites) q = q.eq('faite', false);
  return ok(await q);
}

export async function enregistrerTache(t: Partial<Tache>): Promise<Tache> {
  if (t.id) return ok(await supabase.from('tache').update(t).eq('id', t.id).select().single());
  // Une nouvelle tâche se pose en tête : c'est ce qu'on vient de décider.
  const premieres = ok<{ rang: number }[]>(
    await supabase.from('tache').select('rang').eq('faite', false).order('rang').limit(1),
  );
  const rang = (premieres[0]?.rang ?? 0) - 1;
  return ok(await supabase.from('tache').insert({ ...ent(), rang, ...t }).select().single());
}

export async function basculerTache(id: string, faite: boolean): Promise<void> {
  ok(await supabase.from('tache')
    .update({ faite, faite_le: faite ? new Date().toISOString() : null })
    .eq('id', id).select());
}

export async function supprimerTache(id: string): Promise<void> {
  ok(await supabase.from('tache').delete().eq('id', id).select());
}

/** Réécrit les rangs dans l'ordre reçu. Appelé après un déplacement. */
export async function reordonnerTaches(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, i) => supabase.from('tache').update({ rang: i }).eq('id', id)));
}

// --- Alertes masquées -------------------------------------------------------

export async function listerAlertesMasquees(): Promise<string[]> {
  const r = ok<{ cle: string }[]>(await supabase.from('alerte_masquee').select('cle'));
  return r.map((x) => x.cle);
}

export async function masquerAlerte(cle: string): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  ok(await supabase.from('alerte_masquee')
    .upsert({ ...ent(), user_id: data.user.id, cle }).select());
}

// --- Fusion de doublons -----------------------------------------------------

export async function listerDoublons(): Promise<Doublon[]> {
  return ok(await supabase.rpc('doublons_probables'));
}

/** Déplace tout ce qui pendait à `absorbe` vers `garde`, puis supprime `absorbe`. */
export async function fusionnerTiers(garde: string, absorbe: string): Promise<void> {
  ok(await supabase.rpc('fusionner_tiers', { p_garde: garde, p_absorbe: absorbe }));
}

export async function fusionnerDemandes(garde: string, absorbe: string): Promise<void> {
  ok(await supabase.rpc('fusionner_demandes', { p_garde: garde, p_absorbe: absorbe }));
}

// --- Photos de catalogue ----------------------------------------------------

/**
 * Dépose la photo d'une référence dans le seau `catalogue`, désormais privé.
 *
 * Le chemin est tiré au hasard et non calculé depuis l'identifiant du produit.
 * L'ancien, `<entreprise>/<produit>.jpg`, se devinait : qui connaissait les
 * deux identifiants lisait la photo, et pouvait remonter le catalogue en
 * essayant. Ça n'a plus d'importance maintenant que le seau est fermé, mais
 * un chemin devinable est une porte qu'on laisse fermée à clé plutôt que
 * simplement poussée.
 *
 * L'ancien fichier est retiré après coup : deux photos pour une référence, ce
 * sont des octets qu'on paie et que plus rien ne désigne.
 */
export async function televerserPhoto(produitId: string, fichier: File): Promise<string> {
  const extension = fichier.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const chemin = `${entrepriseId()}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from('catalogue')
    .upload(chemin, fichier, { contentType: fichier.type || undefined });
  if (error) throw new Error(error.message);

  const ancien = ok<{ photo_chemin: string | null }>(
    await supabase.from('produit').select('photo_chemin').eq('id', produitId).single(),
  ).photo_chemin;

  await enregistrerProduit({ id: produitId, photo_chemin: chemin, photo_url: null });
  if (ancien && ancien !== chemin) {
    await supabase.storage.from('catalogue').remove([ancien]);
  }
  return lienPhoto(chemin);
}

/** Cache mémoire des liens signés du catalogue, le temps de l'onglet. */
const liensPhoto = new Map<string, { url: string; expire: number }>();

/** Un lien de consultation pour une photo de catalogue, valable une heure. */
export async function lienPhoto(chemin: string): Promise<string> {
  const connu = liensPhoto.get(chemin);
  if (connu && connu.expire > Date.now()) return connu.url;
  const { data, error } = await supabase.storage
    .from('catalogue').createSignedUrl(chemin, 3600);
  if (error) throw new Error(error.message);
  liensPhoto.set(chemin, { url: data.signedUrl, expire: Date.now() + 3_300_000 });
  return data.signedUrl;
}

/**
 * Résout d'un coup les photos d'une liste de références.
 *
 * Une requête pour tout le catalogue plutôt qu'une par vignette : sur deux
 * cents références, la différence n'est pas subtile. Une photo dont le lien
 * échoue est simplement absente — une vignette manquante ne doit pas empêcher
 * le catalogue de s'afficher.
 */
export async function resoudrePhotos(
  produits: { id: string; photo_chemin: string | null }[],
): Promise<Record<string, string>> {
  const chemins = [...new Set(
    produits.map((p) => p.photo_chemin).filter((c): c is string => !!c),
  )];
  if (chemins.length === 0) return {};

  const { data, error } = await supabase.storage
    .from('catalogue').createSignedUrls(chemins, 3600);
  if (error) throw new Error(error.message);

  const parChemin = new Map<string, string>();
  for (const x of data ?? []) {
    if (x.path && x.signedUrl) {
      parChemin.set(x.path, x.signedUrl);
      liensPhoto.set(x.path, { url: x.signedUrl, expire: Date.now() + 3_300_000 });
    }
  }

  const sortie: Record<string, string> = {};
  for (const p of produits) {
    const url = p.photo_chemin ? parChemin.get(p.photo_chemin) : undefined;
    if (url) sortie[p.id] = url;
  }
  return sortie;
}

export async function retirerPhoto(produitId: string): Promise<void> {
  const ancien = ok<{ photo_chemin: string | null }>(
    await supabase.from('produit').select('photo_chemin').eq('id', produitId).single(),
  ).photo_chemin;
  await enregistrerProduit({ id: produitId, photo_chemin: null, photo_url: null });
  if (ancien) await supabase.storage.from('catalogue').remove([ancien]);
}


// --- Formats de produits ----------------------------------------------------

export async function listerFormats(): Promise<FormatProduit[]> {
  return ok(await supabase.from('format_produit').select('*').eq('actif', true).order('position'));
}

export async function enregistrerFormat(f: Partial<FormatProduit>): Promise<FormatProduit> {
  if (f.id) {
    return ok(await supabase.from('format_produit').update(f).eq('id', f.id).select().single());
  }
  const derniers = ok<{ position: number }[]>(
    await supabase.from('format_produit').select('position').order('position', { ascending: false }).limit(1),
  );
  return ok(await supabase.from('format_produit')
    .insert({ ...ent(), position: (derniers[0]?.position ?? 0) + 1, ...f }).select().single());
}

export async function supprimerFormat(id: string): Promise<void> {
  ok(await supabase.from('format_produit').update({ actif: false }).eq('id', id).select());
}

/** Duplique une référence, suffixe la référence pour rester unique. */
export async function dupliquerProduit(id: string): Promise<Produit> {
  const source = ok<Produit>(await supabase.from('produit').select('*').eq('id', id).single());
  const { id: _i, created_at: _c, ...reste } = source as Produit & { created_at?: string };
  let reference = `${source.reference}-COPIE`;
  let n = 1;
  // On incrémente jusqu'à trouver une référence libre : la contrainte est unique.
  while (true) {
    const existe = ok<{ id: string }[]>(
      await supabase.from('produit').select('id').eq('reference', reference).limit(1),
    );
    if (existe.length === 0) break;
    reference = `${source.reference}-COPIE${++n}`;
  }
  return ok(await supabase.from('produit')
    .insert({ ...reste, reference, photo_url: null, photo_chemin: null })
    .select().single());
}

// --- Catalogue en brouillon -------------------------------------------------

/**
 * Une référence lue dans un fichier ou dans un devis, avant relecture.
 * Volontairement pauvre : c'est le strict nécessaire pour reconnaître un
 * produit. Tout le reste se complète à la main, une fois publié.
 */
export interface ProduitImporte {
  reference: string | null;
  designation: string;
  description: string | null;
  famille: Famille;
  nature: Nature;
  unite: string;
  prix_achat_ht: number | null;
  prix_vente_ht: number;
}

export interface ResultatCatalogue {
  crees: number;
  ignores: { designation: string; raison: string }[];
}

export async function listerBrouillons(): Promise<Produit[]> {
  return ok(await supabase.from('produit').select('*')
    .eq('brouillon', true)
    .order('importe_le', { ascending: false })
    .order('designation'));
}

/** Une référence lisible tirée de la désignation, quand le fichier n'en donne pas. */
function referenceDepuis(texte: string): string {
  const base = texte.toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
    .replace(/-$/, '');
  return base || 'REF';
}

/**
 * Crée un lot de références en brouillon.
 *
 * Deux règles héritées de l'import de devis, pour les mêmes raisons :
 * une référence déjà présente au catalogue n'est jamais réécrite — la ligne
 * est signalée et laissée de côté ; une référence absente du fichier est
 * fabriquée depuis la désignation, puis rendue unique.
 */
export async function importerProduitsBrouillon(
  lot: ProduitImporte[], origine: string,
): Promise<ResultatCatalogue> {
  const resultat: ResultatCatalogue = { crees: 0, ignores: [] };
  if (lot.length === 0) return resultat;

  // Toutes les références de l'entreprise, brouillons compris : la contrainte
  // d'unicité ne fait pas la différence entre un brouillon et un publié.
  //
  // La comparaison ignore la casse, alors que Postgres ne l'ignore pas : mieux
  // vaut refuser « ftxm35r » quand « FTXM35R » existe que se retrouver avec
  // deux fiches pour la même machine. La référence est en revanche enregistrée
  // telle qu'elle a été écrite dans le fichier — c'est elle qu'on retrouvera
  // chez le fournisseur.
  const prises = new Set(
    ok<{ reference: string }[]>(await supabase.from('produit').select('reference'))
      .map((p) => p.reference.toUpperCase()),
  );

  const importeLe = new Date().toISOString();
  const aCreer: Record<string, unknown>[] = [];

  for (const p of lot) {
    const designation = p.designation.trim();
    if (!designation) continue;

    const donnee = p.reference?.trim() ?? '';
    if (donnee && prises.has(donnee.toUpperCase())) {
      resultat.ignores.push({ designation, raison: `Référence ${donnee} déjà au catalogue` });
      continue;
    }

    let reference = donnee || referenceDepuis(designation);
    if (!donnee) {
      let n = 1;
      while (prises.has(reference.toUpperCase())) {
        reference = `${referenceDepuis(designation)}-${++n}`;
      }
    }
    prises.add(reference.toUpperCase());

    aCreer.push({
      ...ent(),
      reference,
      designation,
      description: p.description,
      famille: p.famille,
      nature: p.nature,
      unite: p.unite,
      prix_achat_ht: p.prix_achat_ht,
      prix_vente_ht: p.prix_vente_ht,
      actif: true,
      brouillon: true,
      origine,
      importe_le: importeLe,
    });
  }

  if (aCreer.length === 0) return resultat;

  // Un seul aller-retour dans le cas normal. Si le lot est refusé en bloc,
  // on recommence ligne à ligne pour dire laquelle pose problème plutôt que
  // de rendre un « échec » global que personne ne peut corriger.
  const groupe = await supabase.from('produit').insert(aCreer).select('id');
  if (!groupe.error) {
    resultat.crees = aCreer.length;
    return resultat;
  }

  for (const ligne of aCreer) {
    const seul = await supabase.from('produit').insert(ligne).select('id');
    if (seul.error) {
      resultat.ignores.push({
        designation: String(ligne.designation), raison: seul.error.message,
      });
    } else resultat.crees++;
  }
  return resultat;
}

/** Fait passer des brouillons au catalogue. Rien n'est recopié : c'est un drapeau. */
export async function publierProduits(ids: string[]): Promise<void> {
  if (!ids.length) return;
  ok(await supabase.from('produit').update({ brouillon: false }).in('id', ids).select('id'));
}

/** Jette des brouillons. Suppression réelle : ils n'ont jamais servi à chiffrer. */
export async function supprimerBrouillons(ids: string[]): Promise<void> {
  if (!ids.length) return;
  ok(await supabase.from('produit').delete().eq('brouillon', true).in('id', ids).select('id'));
}

// --- Encaissements ----------------------------------------------------------

export type EncaissementDetaille = Encaissement & {
  tiers: Pick<Tiers, 'id' | 'nom'> | null;
  devis: Pick<Devis, 'id' | 'numero'> | null;
};

export async function listerEncaissements(): Promise<EncaissementDetaille[]> {
  return ok(await supabase.from('encaissement')
    .select('*, tiers(id, nom), devis(id, numero)')
    .order('du_le', { nullsFirst: false }));
}

export async function genererEncaissements(devisId: string, totalTtc: number): Promise<number> {
  return ok(await supabase.rpc('generer_encaissements', {
    p_devis: devisId, p_total_ttc: totalTtc,
  }));
}

export async function enregistrerEncaissement(e: Partial<Encaissement>): Promise<Encaissement> {
  if (e.id) return ok(await supabase.from('encaissement').update(e).eq('id', e.id).select().single());
  return ok(await supabase.from('encaissement').insert({ ...ent(), ...e }).select().single());
}

export async function pointerEncaissement(id: string, recuLe: string | null): Promise<void> {
  ok(await supabase.from('encaissement').update({ recu_le: recuLe }).eq('id', id).select());
}

// --- Équipe -----------------------------------------------------------------

export async function enregistrerMembre(m: Partial<Membre>): Promise<Membre> {
  if (m.id) return ok(await supabase.from('membre').update(m).eq('id', m.id).select().single());
  return ok(await supabase.from('membre').insert({ ...ent(), ...m }).select().single());
}

export async function chargerMembreParId(id: string): Promise<Membre> {
  return ok(await supabase.from('membre').select('*').eq('id', id).single());
}

export async function supprimerMembre(id: string): Promise<void> {
  ok(await supabase.from('membre').update({ actif: false }).eq('id', id).select());
}

// --- Journal des chantiers --------------------------------------------------

export type EntreeJournal = Fil & {
  tiers: Pick<Tiers, 'id' | 'nom'> | null;
  chantier: Pick<Chantier, 'id' | 'numero' | 'libelle'> | null;
};

/** Tout ce qui a été noté sur un chantier, tous chantiers confondus. */
export async function listerJournal(chantierId?: string): Promise<EntreeJournal[]> {
  let q = supabase.from('fil')
    .select('*, tiers(id, nom), chantier(id, numero, libelle)')
    .not('chantier_id', 'is', null)
    .order('occurred_at', { ascending: false })
    .limit(300);
  if (chantierId) q = q.eq('chantier_id', chantierId);
  return ok(await q);
}


// --- Variantes --------------------------------------------------------------

export async function listerVariantes(produitId?: string): Promise<Variante[]> {
  let q = supabase.from('variante').select('*').eq('actif', true).order('position');
  if (produitId) q = q.eq('produit_id', produitId);
  return ok(await q);
}

export async function enregistrerVariante(v: Partial<Variante>): Promise<Variante> {
  if (v.id) return ok(await supabase.from('variante').update(v).eq('id', v.id).select().single());
  return ok(await supabase.from('variante').insert({ ...ent(), ...v }).select().single());
}

export async function supprimerVariante(id: string): Promise<void> {
  ok(await supabase.from('variante').update({ actif: false }).eq('id', id).select());
}

/** Fabrique une ligne de devis à partir d'une référence, éventuellement déclinée. */
export function ligneDepuisVariante(
  produit: Produit, variante: Variante, devisId: string, lotId: string,
  position: number, quantite = 1,
): Partial<DevisLigne> {
  return {
    devis_id: devisId, lot_id: lotId, position,
    produit_id: produit.id,
    variante_id: variante.id,
    // La désignation porte la variante : le client doit lire ce qu'il achète.
    designation: `${produit.designation} — ${variante.nom}`,
    description: variante.description ?? produit.description,
    nature: produit.nature,
    unite: produit.unite,
    quantite,
    prix_unitaire_ht: variante.prix_vente_ht,
    remise_pct: 0,
    prix_achat_ht: variante.prix_achat_ht ?? produit.prix_achat_ht,
    taux_tva: 20,
    taux_force: false,
  };
}

// --- Numérotation -----------------------------------------------------------

export async function etatCompteurs(): Promise<{ type: string; annee: number; dernier: number }[]> {
  return ok(await supabase.rpc('etat_compteurs'));
}

/** Reprend la numérotation là où Fabrice l'avait laissée hors de Batinium. */
export async function calerCompteur(type: string, dernier: number): Promise<number> {
  return ok(await supabase.rpc('caler_compteur', { p_type: type, p_dernier: dernier }));
}

// --- Paiements de l'équipe --------------------------------------------------

export async function listerPaiementsEquipe(
  filtre: { membreId?: string; tiersId?: string } = {},
): Promise<PaiementEquipe[]> {
  let q = supabase.from('paiement_equipe').select('*').order('du_le', { ascending: false });
  if (filtre.membreId) q = q.eq('membre_id', filtre.membreId);
  if (filtre.tiersId) q = q.eq('tiers_id', filtre.tiersId);
  return ok(await q);
}

export type PaiementDetaille = PaiementEquipe & {
  membre: Pick<Membre, 'id' | 'nom'> | null;
  tiers: Pick<Tiers, 'id' | 'nom'> | null;
  chantier: Pick<Chantier, 'id' | 'numero' | 'libelle'> | null;
};

/** La paie avec les noms plutôt que les identifiants. Un écran ne lit pas des uuid. */
export async function listerPaie(): Promise<PaiementDetaille[]> {
  return ok(await supabase.from('paiement_equipe')
    .select('*, membre(id, nom), tiers(id, nom), chantier(id, numero, libelle)')
    .order('du_le', { ascending: false, nullsFirst: false })
    .limit(2000));
}

export async function enregistrerPaiementEquipe(p: Partial<PaiementEquipe>): Promise<PaiementEquipe> {
  if (p.id) {
    return ok(await supabase.from('paiement_equipe').update(p).eq('id', p.id).select().single());
  }
  return ok(await supabase.from('paiement_equipe').insert({ ...ent(), ...p }).select().single());
}

export async function supprimerPaiementEquipe(id: string): Promise<void> {
  ok(await supabase.from('paiement_equipe').delete().eq('id', id).select());
}

// --- Rémunérations ----------------------------------------------------------

export async function listerRemunerations(membreId?: string): Promise<Remuneration[]> {
  let q = supabase.from('remuneration').select('*').order('depuis_le', { ascending: false });
  if (membreId) q = q.eq('membre_id', membreId);
  return ok(await q);
}

export async function enregistrerRemuneration(r: Partial<Remuneration>): Promise<Remuneration> {
  if (r.id) {
    return ok(await supabase.from('remuneration').update(r).eq('id', r.id).select().single());
  }
  return ok(await supabase.from('remuneration').insert({ ...ent(), ...r }).select().single());
}

export async function supprimerRemuneration(id: string): Promise<void> {
  ok(await supabase.from('remuneration').delete().eq('id', id).select('id'));
}

/** Celle qui s'applique à une date donnée : la plus récente déjà prise d'effet. */
export function remunerationCourante(
  liste: Remuneration[], membreId: string, aDate = new Date().toISOString().slice(0, 10),
): Remuneration | null {
  return liste
    .filter((r) => r.membre_id === membreId && r.depuis_le <= aDate)
    .sort((a, b) => b.depuis_le.localeCompare(a.depuis_le))[0] ?? null;
}

/**
 * Ce que le salarié coûte réellement chaque mois.
 *
 * Le chiffre du comptable s'il a été saisi, une estimation sinon — et le
 * drapeau `estime` existe pour que l'écran le dise. Afficher une estimation
 * sous les traits d'un fait, c'est ce qui fait qu'on découvre l'écart en fin
 * d'exercice.
 */
export function coutEmployeur(
  r: Remuneration, coefficient: number,
): { montant: number; estime: boolean } {
  if (r.cout_employeur_mensuel != null) {
    return { montant: Number(r.cout_employeur_mensuel), estime: false };
  }
  return {
    montant: Math.round(Number(r.brut_mensuel) * (coefficient || 1.42) * 100) / 100,
    estime: true,
  };
}

/** Le taux horaire, saisi ou déduit. 151,67 h = 35 h × 52 / 12, le mois légal. */
export function tauxHoraire(r: Remuneration): number {
  if (r.taux_horaire_brut != null) return Number(r.taux_horaire_brut);
  const mensuelles = (Number(r.heures_hebdo) || 35) * 52 / 12;
  return Math.round((Number(r.brut_mensuel) / mensuelles) * 100) / 100;
}

// --- Création de devis à partir d'un ancien ---------------------------------

/**
 * Reprend un devis passé pour un nouveau client. Le contenu est copié,
 * le client et le site sont remplacés, tout le reste est remis à zéro.
 * C'est le geste que Fabrice fait déjà à la main dans son ancien outil.
 */
export async function devisDepuisModele(
  modeleId: string,
  cible: { tiers_id: string | null; site_id: string | null; demande_id?: string | null; titre?: string | null },
): Promise<Devis> {
  const { devis, lots, lignes } = await chargerDevis(modeleId);
  const copie = await creerDevis({
    tiers_id: cible.tiers_id,
    site_id: cible.site_id,
    demande_id: cible.demande_id ?? null,
    titre: cible.titre ?? devis.titre,
    intro: devis.intro,
    resume_materiel: devis.resume_materiel,
    type_prestation: devis.type_prestation,
    validite_jours: devis.validite_jours,
    remise_montant: 0,
    remise_libelle: devis.remise_libelle,
    marge_mode: devis.marge_mode,
    marge_valeur: devis.marge_valeur,
    echeancier: devis.echeancier,
    notes_internes: null,
    statut: 'brouillon',
  });
  await copierArborescence(copie.id, lots, lignes, null, null);
  return copie;
}


// --- Voyants de suivi -------------------------------------------------------

export interface SuiviTiers {
  devis: number;
  devisSignes: number;
  chantiers: number;
  chantiersOuverts: number;
}

/**
 * Combien de devis et de chantiers par client. Sert au voyant des listes :
 * savoir d'un coup d'œil si une fiche est déjà engagée évite d'ouvrir un
 * second chantier pour la même affaire.
 */
export async function suiviParTiers(): Promise<Map<string, SuiviTiers>> {
  const [devis, chantiers] = await Promise.all([
    ok<{ tiers_id: string | null; statut: string }[]>(
      await supabase.from('devis').select('tiers_id, statut')),
    ok<{ tiers_id: string; statut: string }[]>(
      await supabase.from('chantier').select('tiers_id, statut')),
  ]);

  const carte = new Map<string, SuiviTiers>();
  const pour = (id: string) => {
    if (!carte.has(id)) {
      carte.set(id, { devis: 0, devisSignes: 0, chantiers: 0, chantiersOuverts: 0 });
    }
    return carte.get(id)!;
  };

  for (const d of devis) {
    if (!d.tiers_id) continue;
    const s = pour(d.tiers_id);
    s.devis++;
    if (d.statut === 'signe') s.devisSignes++;
  }
  for (const c of chantiers) {
    const s = pour(c.tiers_id);
    s.chantiers++;
    if (!['receptionne'].includes(c.statut)) s.chantiersOuverts++;
  }
  return carte;
}

// --- Import de devis existants ----------------------------------------------

export interface DevisImporte {
  numero: string;
  date_emission: string | null;
  client: string;
  email?: string | null;
  telephone?: string | null;
  adresse?: string | null;
  code_postal?: string | null;
  ville?: string | null;
  annee_achevement?: number | null;
  objet?: string | null;
  statut?: Devis['statut'];
  lignes: {
    lot?: string | null;
    sous_lot?: string | null;
    designation: string;
    description?: string | null;
    quantite: number;
    unite?: string | null;
    prix_unitaire_ht: number;
    taux_tva?: number | null;
  }[];
}

export interface ResultatImport {
  crees: number;
  ignores: { numero: string; raison: string }[];
  clientsCrees: number;
}

/**
 * Reprend des devis venus d'un autre logiciel. Le numéro d'origine est
 * conservé tel quel : c'est lui qui fait le lien avec les archives papier.
 * Un numéro déjà présent n'est pas réimporté, jamais écrasé.
 */
export async function importerDevis(lot: DevisImporte[]): Promise<ResultatImport> {
  const entreprise = entrepriseId();
  const resultat: ResultatImport = { crees: 0, ignores: [], clientsCrees: 0 };

  const existants = new Set(
    ok<{ numero: string }[]>(await supabase.from('devis').select('numero'))
      .map((d) => d.numero),
  );
  const clients = await listerTiers();
  const parNom = new Map(clients.map((c) => [c.nom.trim().toLowerCase(), c]));

  for (const d of lot) {
    if (!d.numero?.trim()) {
      resultat.ignores.push({ numero: '(sans numéro)', raison: 'Numéro absent' });
      continue;
    }
    if (existants.has(d.numero)) {
      resultat.ignores.push({ numero: d.numero, raison: 'Numéro déjà présent' });
      continue;
    }
    if (d.lignes.length === 0) {
      resultat.ignores.push({ numero: d.numero, raison: 'Aucune ligne' });
      continue;
    }

    try {
      // Le client : on le retrouve par son nom, sinon on le crée.
      const cle = d.client.trim().toLowerCase();
      let tiers = parNom.get(cle);
      if (!tiers && d.client.trim()) {
        tiers = await enregistrerTiers({
          type: 'particulier', categorie: 'client', nom: d.client.trim(),
          email: d.email ?? null, telephone: d.telephone ?? null,
          adresse: d.adresse ?? null, code_postal: d.code_postal ?? null,
          ville: d.ville ?? null,
          notes: 'Fiche créée à l’import des anciens devis.',
        });
        parNom.set(cle, tiers);
        resultat.clientsCrees++;
      }

      // Le site, seulement si on a une adresse et qu'il n'en existe pas déjà une identique.
      let siteId: string | null = null;
      if (tiers && d.adresse) {
        const siens = await listerSites(tiers.id);
        const meme = siens.find((s) =>
          s.adresse.trim().toLowerCase() === d.adresse!.trim().toLowerCase());
        siteId = meme
          ? meme.id
          : (await enregistrerSite({
              tiers_id: tiers.id, adresse: d.adresse,
              code_postal: d.code_postal ?? null, ville: d.ville ?? null,
              usage_local: 'habitation',
              annee_achevement: d.annee_achevement ?? null,
            })).id;
      }

      const devis = ok<Devis>(await supabase.from('devis').insert({
        entreprise_id: entreprise,
        numero: d.numero,
        statut: d.statut ?? 'signe',
        tiers_id: tiers?.id ?? null,
        site_id: siteId,
        date_emission: d.date_emission ?? new Date().toISOString().slice(0, 10),
        titre: d.objet ?? null,
        notes_internes: 'Devis repris d’un ancien logiciel.',
      }).select().single());

      // Reconstruction de l'arborescence lot / sous-lot dans l'ordre du fichier
      const lots = new Map<string, string>();
      let positionLot = 0;

      for (const [i, l] of d.lignes.entries()) {
        const nomLot = (l.lot ?? 'PRESTATIONS').trim() || 'PRESTATIONS';
        const nomSous = (l.sous_lot ?? '').trim();

        if (!lots.has(nomLot)) {
          const cree = await ajouterLot(devis.id, nomLot, null, positionLot++);
          lots.set(nomLot, cree.id);
        }
        let lotId = lots.get(nomLot)!;

        if (nomSous) {
          const cleSous = `${nomLot}»${nomSous}`;
          if (!lots.has(cleSous)) {
            const parent = lots.get(nomLot)!;
            const cree = await ajouterLot(devis.id, nomSous, parent, lots.size);
            lots.set(cleSous, cree.id);
          }
          lotId = lots.get(cleSous)!;
        }

        await ajouterLigne({
          devis_id: devis.id, lot_id: lotId, position: i,
          designation: l.designation,
          description: l.description ?? null,
          nature: 'fourniture',
          unite: l.unite ?? 'U',
          quantite: l.quantite,
          prix_unitaire_ht: l.prix_unitaire_ht,
          // Le taux du fichier fait foi : c'est celui qui a été facturé.
          taux_tva: l.taux_tva ?? 20,
          taux_force: true,
        });
      }

      existants.add(d.numero);
      resultat.crees++;
    } catch (e) {
      resultat.ignores.push({ numero: d.numero, raison: (e as Error).message });
    }
  }

  return resultat;
}


// --- Chargement groupé des devis --------------------------------------------

export interface DevisGroupe {
  devis: DevisAvecTiers;
  lots: DevisLot[];
  lignes: DevisLigne[];
  site: Site | null;
}

/**
 * Charge tous les devis avec leurs lots, leurs lignes et leur site,
 * en quatre requêtes au lieu d'une par devis.
 *
 * L'ancienne approche faisait quatre allers-retours par devis : avec vingt
 * devis, quatre-vingts requêtes, et une page qui met plusieurs secondes à
 * s'afficher. Ici le regroupement se fait en mémoire, ce qui est instantané.
 */
export async function chargerTousLesDevis(): Promise<DevisGroupe[]> {
  const [devis, lots, lignes, sites] = await Promise.all([
    ok<DevisAvecTiers[]>(await supabase.from('devis')
      .select('*, tiers(id, nom, ville)')
      .order('created_at', { ascending: false })),
    ok<DevisLot[]>(await supabase.from('devis_lot').select('*').order('position').limit(20000)),
    ok<DevisLigne[]>(await supabase.from('devis_ligne').select('*').order('position').limit(20000)),
    ok<Site[]>(await supabase.from('site').select('*').limit(5000)),
  ]);

  const parSite = new Map(sites.map((s) => [s.id, s]));
  const lotsParDevis = new Map<string, DevisLot[]>();
  const lignesParDevis = new Map<string, DevisLigne[]>();

  for (const l of lots) {
    if (!lotsParDevis.has(l.devis_id)) lotsParDevis.set(l.devis_id, []);
    lotsParDevis.get(l.devis_id)!.push(l);
  }
  for (const l of lignes) {
    if (!lignesParDevis.has(l.devis_id)) lignesParDevis.set(l.devis_id, []);
    lignesParDevis.get(l.devis_id)!.push(l);
  }

  return devis.map((d) => ({
    devis: d,
    lots: lotsParDevis.get(d.id) ?? [],
    lignes: lignesParDevis.get(d.id) ?? [],
    site: d.site_id ? parSite.get(d.site_id) ?? null : null,
  }));
}


// --- Charges fixes et dépenses ----------------------------------------------

/**
 * Un montant annuel et un montant mensuel ne se comparent pas : on ramène au mois.
 *
 * Le troisième argument n'a pas de valeur par défaut, exprès. Depuis qu'il
 * existe une périodicité personnalisée, un appel qui l'oublierait diviserait
 * par un sans rien dire, et le tableau de charges serait faux sans qu'aucun
 * message ne le signale. Le rendre obligatoire déplace l'erreur du bilan
 * comptable vers le compilateur. Même signature que cout_mensuel() en base.
 */
export function coutMensuel(
  montant: number, periodicite: Periodicite, moisPersonnalises: number | null,
): number {
  const diviseur = periodicite === 'personnalisee'
    ? Math.max(1, Number(moisPersonnalises) || 1)
    : { mensuelle: 1, trimestrielle: 3, semestrielle: 6, annuelle: 12 }[periodicite];
  return Math.round((Number(montant) / diviseur) * 100) / 100;
}

/** Le même coût, ramené au jour. 365 jours, pas 21 : ici on proratise une période. */
export function coutJournalier(c: ChargeFixe): number {
  return (coutMensuel(c.montant_ht, c.periodicite, c.mois_personnalises) * 12) / 365;
}

export async function listerChargesFixes(inclureInactives = false): Promise<ChargeFixe[]> {
  let q = supabase.from('charge_fixe').select('*').order('categorie').order('libelle');
  if (!inclureInactives) q = q.eq('actif', true);
  return ok(await q);
}

export async function enregistrerChargeFixe(c: Partial<ChargeFixe>): Promise<ChargeFixe> {
  if (c.id) return ok(await supabase.from('charge_fixe').update(c).eq('id', c.id).select().single());
  return ok(await supabase.from('charge_fixe').insert({ ...ent(), ...c }).select().single());
}

export async function supprimerChargeFixe(id: string): Promise<void> {
  ok(await supabase.from('charge_fixe').delete().eq('id', id).select());
}

export type DepenseDetaillee = Depense & {
  chantier: Pick<Chantier, 'id' | 'numero' | 'libelle'> | null;
};

export async function listerDepenses(filtre: { chantierId?: string } = {}): Promise<DepenseDetaillee[]> {
  let q = supabase.from('depense')
    .select('*, chantier(id, numero, libelle)')
    .order('date_achat', { ascending: false })
    .limit(2000);
  if (filtre.chantierId) q = q.eq('chantier_id', filtre.chantierId);
  return ok(await q);
}

export async function enregistrerDepense(d: Partial<Depense>): Promise<Depense> {
  if (d.id) return ok(await supabase.from('depense').update(d).eq('id', d.id).select().single());
  return ok(await supabase.from('depense').insert({ ...ent(), ...d }).select().single());
}

export async function supprimerDepense(id: string): Promise<void> {
  ok(await supabase.from('depense').delete().eq('id', id).select());
}

// --- Pièces jointes ---------------------------------------------------------

/**
 * À quoi la pièce se rattache. Un seul rattachement à la fois : une photo
 * appartient à un chantier ou à un salarié, pas aux deux, sinon personne ne
 * sait où la chercher — et la base le refuse depuis le SQL 13.
 */
export type CibleDocument =
  | { chantier_id: string }
  | { intervention_id: string }
  | { membre_id: string }
  | { tiers_id: string }
  | { devis_id: string }
  | { fil_id: string }
  | { achat_id: string }
  /** Une pièce de l'entreprise elle-même : attestation de capacité, Kbis. */
  | { portee_entreprise: true };

const DOSSIERS: Record<string, string> = {
  chantier_id: 'chantier', intervention_id: 'intervention',
  membre_id: 'membre', tiers_id: 'tiers', devis_id: 'devis', fil_id: 'note',
  portee_entreprise: 'entreprise', achat_id: 'achat',
};

export async function listerDocuments(cible: CibleDocument): Promise<Document[]> {
  const [cle, valeur] = Object.entries(cible)[0];
  return ok(await supabase.from('document').select('*')
    .eq(cle, valeur).order('created_at', { ascending: false }));
}

/**
 * Dépose un fichier et enregistre sa ligne.
 *
 * Le chemin commence par l'identifiant de l'entreprise : c'est sur ce premier
 * segment que les politiques du seau s'appuient pour cloisonner. Le nom
 * d'origine n'entre pas dans le chemin — un « Bulletin Karim mars.pdf » dans
 * une URL raconte déjà trop, et les accents cassent les liens signés.
 */
export async function televerserDocument(
  cible: CibleDocument, fichier: File,
  options: {
    legende?: string | null; type?: TypeDocument;
    prise_le?: string | null; emis_le?: string | null; expire_le?: string | null;
    /** Rattachement secondaire : une photo appartient au chantier ET à sa note. */
    fil_id?: string | null;
  } = {},
): Promise<Document> {
  const [cle, valeur] = Object.entries(cible)[0];
  const extension = fichier.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const chemin = `${entrepriseId()}/${DOSSIERS[cle] ?? 'divers'}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from('documents')
    .upload(chemin, fichier, { contentType: fichier.type || undefined, upsert: false });
  if (error) throw new Error(error.message);

  try {
    return ok(await supabase.from('document').insert({
      ...ent(), [cle]: valeur,
      type: options.type ?? 'autre',
      nom: fichier.name,
      chemin,
      type_mime: fichier.type || null,
      taille_octets: fichier.size,
      legende: options.legende ?? null,
      prise_le: options.prise_le ?? null,
      emis_le: options.emis_le ?? null,
      expire_le: options.expire_le ?? null,
      fil_id: options.fil_id ?? null,
      depose_par: membre().id,
    }).select().single());
  } catch (e) {
    // La ligne a échoué : on retire le fichier, sinon le seau se remplit
    // d'orphelins que plus rien ne référence et que personne ne verra.
    await supabase.storage.from('documents').remove([chemin]);
    throw e;
  }
}

/**
 * Un lien de consultation, valable dix minutes.
 *
 * Le seau est privé : pas d'URL publique devinable pour une attestation URSSAF
 * ou une photo prise chez un particulier. Le lien se redemande à chaque fois,
 * ce qui est un peu plus bavard mais ne laisse pas traîner d'accès permanent.
 */
export async function lienDocument(chemin: string): Promise<string> {
  const { data, error } = await supabase.storage.from('documents')
    .createSignedUrl(chemin, 600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function majDocument(id: string, patch: Partial<Document>): Promise<void> {
  ok(await supabase.from('document').update(patch).eq('id', id).select('id'));
}

/** Retire la ligne puis le fichier. Dans cet ordre : une ligne sans fichier
 *  se voit et se corrige, un fichier sans ligne est invisible pour toujours. */
export async function supprimerDocument(d: Document): Promise<void> {
  ok(await supabase.from('document').delete().eq('id', d.id).select('id'));
  if (d.chemin) await supabase.storage.from('documents').remove([d.chemin]);
}

/** Taille lisible. « 824 ko » se compare d'un coup d'œil, pas « 844213 ». */
export function poids(octets: number | null): string {
  if (octets == null) return '—';
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} ko`;
  return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
}

// --- Procès-verbal de réception ---------------------------------------------

/**
 * Prononce la réception. C'est cette date qui fait courir les garanties :
 * parfait achèvement un an, bon fonctionnement deux ans, décennale dix ans.
 * Sans PV daté, ce point de départ est contestable.
 */
export async function prononcerReception(
  chantierId: string,
  o: { date: string; avecReserves: boolean; representant: string; observations: string },
): Promise<void> {
  const numero = ok<string>(await supabase.rpc('prochain_numero', { p_type: 'pv' }));
  await majChantier(chantierId, {
    pv_numero: numero,
    pv_date: o.date,
    pv_avec_reserves: o.avecReserves,
    pv_representant_client: o.representant || null,
    pv_observations: o.observations || null,
    date_reception: o.date,
    statut: 'receptionne',
  });
  const c = await chargerChantier(chantierId);
  await ajouterFil({
    tiers_id: c.tiers_id, chantier_id: chantierId, type: 'systeme',
    sujet: `Réception prononcée${o.avecReserves ? ' avec réserves' : ' sans réserve'}`,
    contenu: `Procès-verbal ${numero} du ${new Date(o.date).toLocaleDateString('fr-FR')}.`,
  });
}
