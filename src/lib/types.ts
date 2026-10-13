/** Types Batinium. Miroir du schéma Postgres, pas plus. */

export type Nature = 'fourniture' | 'pose' | 'deplacement';

export type Famille =
  | 'groupe_eau' | 'mono_split' | 'multi_split' | 'gainable' | 'console' | 'cassette'
  | 'accessoire' | 'fourniture' | 'plomberie' | 'electricite' | 'pose' | 'phonique' | 'logistique';

export type TypePrestation = 'installation' | 'entretien' | 'depannage' | 'mise_en_service';
export type UsageLocal = 'habitation' | 'mixte' | 'professionnel';
export type Role = 'direction' | 'chef_chantier' | 'technicien' | 'sous_traitant';

export interface Entreprise {
  id: string;
  nom: string;
  code_invitation: string;
}

export interface Rattachement {
  id: string;
  user_id: string;
  entreprise_id: string;
  email: string | null;
  nom: string;
  statut: 'en_attente' | 'accepte' | 'refuse';
  created_at: string;
  traite_le: string | null;
}

export interface Membre {
  id: string;
  entreprise_id: string;
  user_id: string;
  nom: string;
  role: Role;
  aptitude_fluides_num: string | null;
  aptitude_fluides_expire_le: string | null;
  actif: boolean;
  /** Mode démonstration (SQL 38) : le rôle dont la direction emprunte les droits. */
  apercu_role?: Exclude<Role, 'direction'> | null;
  /** Combien de jours avant une échéance d'entretien prévenir ce membre (SQL 37). */
  preavis_entretien_jours?: number;
}

export type Priorite = 'basse' | 'normale' | 'haute' | 'urgente';

export interface Tache {
  id: string;
  entreprise_id: string;
  titre: string;
  detail: string | null;
  echeance: string | null;
  priorite: Priorite;
  rang: number;
  etiquettes: string[];
  faite: boolean;
  faite_le: string | null;
  tiers_id: string | null;
  chantier_id: string | null;
  devis_id: string | null;
  demande_id: string | null;
  assignee_id: string | null;
  created_at: string;
}

export interface Doublon {
  a: string;
  b: string;
  nom_a: string;
  nom_b: string;
  motif: string;
}

export type TypeChamp = 'texte' | 'nombre' | 'liste' | 'booleen';

export interface ChampLibre {
  cle: string;
  libelle: string;
  type: TypeChamp;
  unite?: string;
  options?: string[];
  aide?: string;
}

export interface FormatProduit {
  id: string;
  entreprise_id: string;
  nom: string;
  description: string | null;
  champs_standards: string[];
  champs_libres: ChampLibre[];
  familles: string[];
  position: number;
  actif: boolean;
}

export interface Encaissement {
  id: string;
  entreprise_id: string;
  devis_id: string | null;
  chantier_id: string | null;
  tiers_id: string | null;
  libelle: string;
  pourcentage: number | null;
  montant_ttc: number;
  du_le: string | null;
  recu_le: string | null;
  moyen: 'virement' | 'carte' | 'cheque' | 'especes' | 'prelevement' | 'financement' | null;
  reference: string | null;
  position: number;
  /** La facture qui appelle cette échéance, quand elle a été émise. */
  facture_id: string | null;
}

export interface Variante {
  id: string;
  entreprise_id: string;
  produit_id: string;
  nom: string;
  description: string | null;
  reference: string | null;
  prix_achat_ht: number | null;
  prix_vente_ht: number;
  attributs: Record<string, string | number | boolean | null>;
  photo_url: string | null;
  position: number;
  actif: boolean;
}

export interface Produit {
  id: string;
  entreprise_id: string;
  reference: string;
  designation: string;
  description: string | null;
  famille: Famille;
  nature: Nature;
  unite: string;
  puissance_kw: number | null;
  classe_froid: string | null;
  classe_chaud: string | null;
  fluide: string | null;
  fixe: boolean | null;
  reversible: boolean | null;
  connecte: boolean | null;
  prix_achat_ht: number | null;
  coefficient: number | null;
  prix_vente_ht: number;
  actif: boolean;
  /** Adresse publique historique. Plus lisible depuis que le seau est privé. */
  photo_url: string | null;
  /** Chemin dans le seau `catalogue`. C'est lui qui sert à signer un lien. */
  photo_chemin: string | null;
  afficher_photo: boolean;
  format_id: string | null;
  attributs: Record<string, string | number | boolean | null>;
  /** Vrai tant que la référence n'a pas été relue : elle n'apparaît alors ni au
   *  catalogue, ni dans le sélecteur de lignes de devis. */
  brouillon: boolean;
  origine: string | null;
  importe_le: string | null;
}

export interface Tiers {
  id: string;
  entreprise_id: string;
  type: 'particulier' | 'professionnel';
  categorie: 'prospect' | 'client' | 'fournisseur' | 'sous_traitant';
  nom: string;
  email: string | null;
  telephone: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  siret: string | null;
  notes: string | null;
  created_at: string;
}

export interface Site {
  id: string;
  entreprise_id: string;
  tiers_id: string;
  adresse: string;
  code_postal: string | null;
  ville: string | null;
  usage_local: UsageLocal;
  annee_achevement: number | null;
  en_copropriete: boolean;
  accord_copro: boolean;
  declaration_prealable: 'sans_objet' | 'a_deposer' | 'deposee' | 'accordee';
  contraintes_acces: string | null;
  notes: string | null;
  /** Position de l'adresse, d'après l'IGN (SQL 35). */
  latitude?: number | null;
  longitude?: number | null;
}

/** Ce qu'une demande notée sur le terrain appelle (SQL 36). */
export type SuiteDemande = 'a_facturer' | 'sav' | 'nouveau_devis';

export interface Demande {
  id: string;
  entreprise_id: string;
  source: string;
  source_ref: string | null;
  recu_le: string;
  nom: string | null;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  besoin: string | null;
  resume: string | null;
  transcription: string | null;
  enregistrement_url: string | null;
  duree_secondes: number | null;
  urgence: 'panne' | 'saison' | 'projet';
  necessite_visite: boolean | null;
  statut: 'nouvelle' | 'a_rappeler' | 'qualifiee' | 'a_visiter' | 'devisee' | 'perdue' | 'spam';
  repondu: boolean;
  repondu_le: string | null;
  rappeler_le: string | null;
  motif_perte: string | null;
  tiers_id: string | null;
  suite?: SuiteDemande | null;
  chantier_id?: string | null;
  intervention_id?: string | null;
  cree_par?: string | null;
}

export type TypeFil =
  | 'appel_entrant' | 'appel_manque' | 'appel_sortant'
  | 'email_recu' | 'email_envoye' | 'sms' | 'note' | 'visite'
  | 'devis_envoye' | 'devis_signe' | 'relance' | 'systeme';

export type CategorieCharge =
  | 'abonnement' | 'loyer' | 'vehicule' | 'outillage' | 'assurance'
  | 'telephonie' | 'banque' | 'comptabilite' | 'cotisation' | 'certification' | 'autre';

export type Periodicite =
  | 'mensuelle' | 'trimestrielle' | 'semestrielle' | 'annuelle' | 'personnalisee';

export interface ChargeFixe {
  id: string;
  entreprise_id: string;
  libelle: string;
  categorie: CategorieCharge;
  fournisseur: string | null;
  montant_ht: number;
  taux_tva: number;
  periodicite: Periodicite;
  /** Nombre de mois entre deux échéances. Renseigné si et seulement si
   *  la périodicité est 'personnalisee' — la base l'exige. */
  mois_personnalises: number | null;
  debut_le: string;
  fin_le: string | null;
  chantier_id: string | null;
  notes: string | null;
  actif: boolean;
}

/**
 * 'sous_traitance' a été retirée en SQL 12 : le coût d'un sous-traitant est
 * déjà porté par le prix d'achat de la ligne de devis, ou par paiement_equipe.
 *
 * 'materiel' et 'fourniture' restent, mais le SQL 29 les interdit sur une
 * dépense rattachée à un chantier : ce matériel-là passe par les achats, où il
 * se rapproche de ce qui était prévu. Hors chantier, ce sont des frais
 * généraux et il n'y a rien à rapprocher.
 */
export type CategorieDepense =
  | 'materiel' | 'outillage' | 'carburant' | 'peage' | 'repas'
  | 'fourniture' | 'vehicule' | 'formation' | 'certification' | 'autre';

export interface Depense {
  id: string;
  entreprise_id: string;
  libelle: string;
  categorie: CategorieDepense;
  fournisseur: string | null;
  montant_ht: number;
  taux_tva: number;
  chantier_id: string | null;
  membre_id: string | null;
  date_achat: string;
  facture_au_nom_entreprise: boolean;
  numero_piece: string | null;
  justificatif_id: string | null;
  paye_le: string | null;
  notes: string | null;
}

export interface PaiementEquipe {
  id: string;
  entreprise_id: string;
  membre_id: string | null;
  tiers_id: string | null;
  chantier_id: string | null;
  type: 'salaire' | 'prime' | 'acompte' | 'facture' | 'note_de_frais' | 'autre';
  libelle: string;
  periode: string | null;
  montant: number;
  du_le: string | null;
  paye_le: string | null;
  moyen: string | null;
  document_id: string | null;
  notes: string | null;
}

export interface Fil {
  id: string;
  entreprise_id: string;
  tiers_id: string | null;
  demande_id: string | null;
  chantier_id: string | null;
  devis_id: string | null;
  type: TypeFil;
  sujet: string | null;
  contenu: string | null;
  auteur: string | null;
  source: string | null;
  source_ref: string | null;
  a_traiter: boolean;
  traite_le: string | null;
  occurred_at: string;
  metadonnees: Record<string, unknown> | null;
  langue: string | null;
  traductions: Record<string, string>;
}

export interface Devis {
  id: string;
  entreprise_id: string;
  numero: string;
  statut: 'brouillon' | 'envoye' | 'relance' | 'signe' | 'refuse' | 'expire';
  tiers_id: string | null;
  site_id: string | null;
  demande_id: string | null;
  date_emission: string;
  validite_jours: number;
  titre: string | null;
  intro: string | null;
  resume_materiel: string | null;
  type_prestation: TypePrestation;
  entreprise_rge: boolean;
  remise_montant: number;
  remise_libelle: string | null;
  marge_mode: 'aucune' | 'pourcentage' | 'montant';
  marge_valeur: number;
  marge_cible_ligne: string | null;
  echeancier: { libelle: string; pourcentage: number }[];
  envoye_le: string | null;
  signe_le: string | null;
  mode_conclusion: 'distance' | 'hors_etablissement' | 'etablissement';
  retractation_fin_le: string | null;
  encaissement_autorise_le: string | null;
  relance_prochaine_le: string | null;
  notes_internes: string | null;
  updated_at: string;
}

export interface DevisLot {
  id: string;
  entreprise_id: string;
  devis_id: string;
  parent_id: string | null;
  position: number;
  titre: string;
}

export interface DevisLigne {
  id: string;
  entreprise_id: string;
  devis_id: string;
  lot_id: string;
  position: number;
  produit_id: string | null;
  designation: string;
  description: string | null;
  nature: Nature;
  unite: string;
  quantite: number;
  prix_unitaire_ht: number;
  remise_pct: number;
  prix_achat_ht: number | null;
  taux_tva: number;
  taux_force: boolean;
  justification_tva: JustificationTva | null;
  consigne_pose: string | null;
  emplacement: string | null;
  variante_id: string | null;
}

/** Un préalable : ce qu'il faut avoir obtenu avant de planifier. */
export interface Prealable {
  id: string;
  entreprise_id: string;
  cle: string;
  libelle: string;
  aide: string | null;
  position: number;
  actif: boolean;
}

/** La copie que porte un chantier. Sans identifiant : c'est un instantané. */
export interface PrealableChantier {
  cle: string;
  libelle: string;
  aide?: string | null;
}

/** Une facture de fournisseur, telle qu'elle arrive. */
export interface Achat {
  id: string;
  entreprise_id: string;
  tiers_id: string | null;
  fournisseur: string;
  numero: string | null;
  date_facture: string;
  echeance_le: string | null;
  montant_ht: number | null;
  montant_tva: number | null;
  montant_ttc: number | null;
  statut: 'a_rapprocher' | 'rapproche' | 'paye' | 'litige';
  /** Faux pour un ticket au nom d'un salarié : la TVA n'est pas récupérable. */
  tva_recuperable: boolean;
  membre_id: string | null;
  document_id: string | null;
  paye_le: string | null;
  notes: string | null;
}

/**
 * Une ligne de facture fournisseur.
 *
 * `approvisionnement_id` est le nœud du rapprochement : il relie ce qu'on
 * avait prévu de commander à ce qui a réellement été facturé. Nul quand la
 * ligne n'était pas prévue — et c'est précisément l'information qu'on veut
 * voir.
 */
export interface AchatLigne {
  id: string;
  entreprise_id: string;
  achat_id: string;
  chantier_id: string | null;
  produit_id: string | null;
  approvisionnement_id: string | null;
  position: number;
  designation: string;
  reference: string | null;
  unite: string;
  quantite: number;
  prix_unitaire_ht: number;
  taux_tva: number;
  notes: string | null;
}

/** Ce qu'un chantier a réellement coûté. Agrégé : rien d'individuel. */
export interface CoutReel {
  chantier_id: string;
  materiel: number;
  lignes_achat: number;
  depenses: number;
  main_oeuvre: number;
  heures: number;
  total: number;
}

/** Le catalogue contre la facture. Un écart durable ronge tous les devis en cours. */
export interface EcartAchat {
  produit_id: string;
  reference: string;
  designation: string;
  prix_catalogue: number | null;
  prix_facture_moyen: number;
  /** Le dernier prix payé : celui qui vaudra sur le prochain devis. */
  prix_facture_dernier: number;
  dernier_achat: string;
  nombre_achats: number;
  ecart_pct: number | null;
}

export type TypeFacture = 'acompte' | 'situation' | 'solde' | 'facture' | 'avoir';
export type StatutFacture = 'brouillon' | 'emise' | 'payee' | 'annulee';

/**
 * Une facture.
 *
 * `numero` est nul tant qu'elle est un brouillon : le numéro s'attribue à
 * l'émission pour que la série reste continue. Une fois émise, elle ne se
 * modifie plus — la base le refuse, pas seulement l'écran.
 */
export interface Facture {
  id: string;
  entreprise_id: string;
  numero: string | null;
  type: TypeFacture;
  statut: StatutFacture;
  devis_id: string | null;
  chantier_id: string | null;
  tiers_id: string | null;
  site_id: string | null;
  facture_origine_id: string | null;
  titre: string | null;
  intro: string | null;
  date_emission: string;
  echeance_le: string | null;
  remise_montant: number;
  remise_libelle: string | null;
  acompte_deduit: number;
  notes_internes: string | null;
  emise_le: string | null;
  payee_le: string | null;
  updated_at: string;
}

export interface FactureLigne {
  id: string;
  entreprise_id: string;
  facture_id: string;
  position: number;
  produit_id: string | null;
  devis_ligne_id: string | null;
  designation: string;
  description: string | null;
  unite: string;
  quantite: number;
  prix_unitaire_ht: number;
  remise_pct: number;
  taux_tva: number;
  justification_tva: JustificationTva | null;
}

export type StatutChantier =
  | 'a_planifier' | 'bloque' | 'planifie' | 'en_cours' | 'a_receptionner' | 'receptionne' | 'sav';

export interface Chantier {
  id: string;
  entreprise_id: string;
  numero: string;
  devis_id: string | null;
  tiers_id: string;
  site_id: string | null;
  libelle: string;
  statut: StatutChantier;
  checklist: Record<string, boolean>;
  /** Copie de la liste au moment de la création. Nul = liste de l'entreprise. */
  prealables: PrealableChantier[] | null;
  date_debut: string | null;
  date_fin: string | null;
  date_reception: string | null;
  reserves: { texte: string; levee: boolean }[];
  reserves_levees_le: string | null;
  notes: string | null;
  pv_numero: string | null;
  pv_date: string | null;
  pv_avec_reserves: boolean | null;
  pv_signe_client: boolean;
  pv_signe_entreprise: boolean;
  pv_observations: string | null;
  pv_representant_client: string | null;
}

/** Ce qu'il faut commander et faire livrer. Copié du devis à la signature. */
export interface Approvisionnement {
  id: string;
  entreprise_id: string;
  chantier_id: string;
  produit_id: string | null;
  devis_ligne_id: string | null;
  designation: string;
  reference: string | null;
  unite: string;
  quantite: number;
  fournisseur: string | null;
  commande_le: string | null;
  livraison_prevue_le: string | null;
  livre_le: string | null;
  notes: string | null;
  position: number;
}

export interface Intervention {
  id: string;
  entreprise_id: string;
  chantier_id: string | null;
  tiers_id: string | null;
  type: 'visite_technique' | 'pose' | 'mise_en_service' | 'sav' | 'entretien' | 'controle_etancheite';
  date_prevue: string | null;
  debut_le: string | null;
  fin_le: string | null;
  membre_id: string | null;
  sous_traitant_id: string | null;
  statut: 'planifiee' | 'en_cours' | 'terminee' | 'annulee' | 'reportee';
  compte_rendu: string | null;
  fluide: string | null;
  charge_kg: number | null;
  recuperee_kg: number | null;
  controle_etancheite: boolean;
  resultat_etancheite: string | null;
  /** La visite d'un contrat d'entretien (SQL 37). */
  contrat_id?: string | null;
  /** L'échéance du contrat que cette visite a soldée, posée par la base. */
  echeance_honoree?: string | null;
}

/** Pourquoi une position n'a pas été relevée. */
export type SansPosition = 'refusee' | 'indisponible' | 'delai' | 'non_supportee';

/**
 * Une arrivée sur un chantier, et le départ qui la complète (SQL 35).
 * Heures posées par le serveur ; position relevée une fois par geste.
 */
export interface Presence {
  id: string;
  entreprise_id: string;
  membre_id: string;
  chantier_id: string | null;
  intervention_id: string | null;
  arrive_le: string;
  arrivee_latitude: number | null;
  arrivee_longitude: number | null;
  arrivee_precision_m: number | null;
  arrivee_distance_m: number | null;
  arrivee_sans_position: SansPosition | null;
  parti_le: string | null;
  depart_latitude: number | null;
  depart_longitude: number | null;
  depart_precision_m: number | null;
  depart_distance_m: number | null;
  depart_sans_position: SansPosition | null;
  depart_auto: boolean;
  commentaire: string | null;
  created_at: string;
}

/** Un contrat d'entretien vendu à un client (SQL 37). Porte un prix. */
export interface ContratEntretien {
  id: string;
  entreprise_id: string;
  tiers_id: string;
  site_id: string | null;
  chantier_id: string | null;
  libelle: string;
  periodicite_mois: number;
  prochaine_echeance: string;
  debut_le: string;
  fin_le: string | null;
  prix_ht: number | null;
  statut: 'actif' | 'suspendu' | 'resilie';
  notes: string | null;
  created_at: string;
}

export type TypePointage =
  | 'pose' | 'deplacement' | 'preparation' | 'sav' | 'entretien'
  | 'attente' | 'atelier' | 'autre';

/**
 * Une déclaration d'heures. Volontairement pauvre : un poseur ne remplit pas
 * huit champs sur un téléphone à dix-huit heures, les mains sales.
 */
export interface Pointage {
  id: string;
  entreprise_id: string;
  membre_id: string;
  chantier_id: string | null;
  intervention_id: string | null;
  jour: string;
  /** En heures décimales : 7,5 pour sept heures trente. */
  heures: number;
  type: TypePointage;
  commentaire: string | null;
  valide: boolean;
  valide_le: string | null;
  created_at: string;
}

/** Agrégat par chantier. Rien d'individuel n'en sort : ni nom, ni taux. */
export interface CoutMainOeuvre {
  chantier_id: string;
  heures: number;
  heures_validees: number | null;
  cout: number;
}

export interface Equipement {
  id: string;
  entreprise_id: string;
  site_id: string | null;
  chantier_id: string | null;
  produit_id: string | null;
  marque: string | null;
  modele: string | null;
  numero_serie: string | null;
  emplacement: string | null;
  mise_en_service_le: string | null;
  fluide: string | null;
  charge_kg: number | null;
  garantie_fin: string | null;
  prochain_entretien_le: string | null;
  photo_plaque_url: string | null;
  statut: 'actif' | 'depose' | 'remplace';
}

/**
 * Le vocabulaire de la bibliothèque de documents.
 *
 * Les sept premières valeurs sont les pièces de vigilance : celles qu'un
 * donneur d'ordre doit réclamer à son sous-traitant, et dont l'absence
 * l'expose à la solidarité financière. Elles portent une échéance et la
 * cloche les surveille. Les suivantes sont des papiers ordinaires.
 */
export type TypeDocument =
  | 'attestation_urssaf' | 'kbis' | 'decennale' | 'rc_pro'
  | 'attestation_capacite_fluides' | 'liste_salaries_etrangers' | 'rib'
  | 'contrat' | 'avenant' | 'bulletin' | 'permis' | 'visite_medicale'
  | 'diplome' | 'attestation_aptitude_fluides' | 'facture' | 'photo'
  | 'plaque_signaletique' | 'signature' | 'fiche_fluide'
  | 'autre';

/**
 * Une pièce de la bibliothèque : photo de chantier, contrat, attestation,
 * facture de sous-traitant. Le fichier vit dans le seau privé `documents` ;
 * la ligne ci-dessous dit à quoi il se rattache, ce qu'il est et quand il
 * expire.
 *
 * Une pièce peut exister sans fichier : on connaît souvent l'échéance avant
 * d'avoir le papier, et mieux vaut une date surveillée qu'un oubli.
 */
export interface Document {
  id: string;
  entreprise_id: string;
  tiers_id: string | null;
  chantier_id: string | null;
  intervention_id: string | null;
  devis_id: string | null;
  membre_id: string | null;
  fil_id: string | null;
  /** La machine dont c'est la plaque signalétique (SQL 32). */
  equipement_id: string | null;
  /** La fiche fluides dont c'est une signature ou le PDF (SQL 33). */
  fiche_fluide_id: string | null;
  /** La demande notée sur le terrain que cette photo accompagne (SQL 36). */
  demande_id?: string | null;
  /** Pièce de l'entreprise elle-même, rattachée à rien d'autre. */
  portee_entreprise: boolean;
  type: TypeDocument;
  nom: string;
  url: string | null;
  chemin: string | null;
  type_mime: string | null;
  taille_octets: number | null;
  legende: string | null;
  depose_par: string | null;
  dropbox_path: string | null;
  prise_le: string | null;
  emis_le: string | null;
  expire_le: string | null;
  conforme: boolean | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

export interface Parametres {
  entreprise_id: string;
  raison_sociale: string;
  forme_juridique: string | null;
  siret: string | null;
  rcs: string | null;
  code_ape: string | null;
  tva_intracom: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  telephone: string | null;
  portable: string | null;
  email: string | null;
  site_web: string | null;
  iban: string | null;
  assureur_nom: string | null;
  assureur_adresse: string | null;
  assureur_police: string | null;
  assureur_couverture: string | null;
  mediateur_nom: string | null;
  mediateur_url: string | null;
  delai_execution: string | null;
  mention_retractation: string | null;
  afficher_retractation: boolean;
  attestation_capacite: string | null;
  attestation_capacite_expire_le: string | null;
  attestation_capacite_organisme: string | null;
  /** Catégorie I à V, reprise dans la rubrique 1 de chaque fiche fluides. */
  attestation_capacite_categorie: string | null;
  rge_qualification: string | null;
  conditions_generales: string | null;
  logo_data_url: string | null;
  prefixe_devis: string;
  prefixe_chantier: string;
  prefixe_facture: string;
  numero_avec_mois: boolean;
  /** Multiplicateur brut → coût employeur, pour le prévisionnel seulement.
   *  Environ 1,42 au régime général. C'est une estimation, jamais un bulletin. */
  coefficient_charges: number;
  /** Pourcentage proposé par défaut pour un acompte. */
  acompte_defaut_pct: number;
  /** Délai de règlement. 30 est le délai supplétif, 60 le maximum entre professionnels. */
  delai_paiement_jours: number;
  mentions_reglement: string | null;
  penalites_retard: string | null;
}

/**
 * Une rémunération, à partir d'une date.
 *
 * Table à part et non colonnes sur `membre` : la RLS filtre des lignes et non
 * des colonnes, et tout membre de l'entreprise peut lire toutes les fiches
 * pour que le planning affiche des noms. Un salaire posé là serait lisible
 * par n'importe quel technicien, quoi qu'affiche l'interface.
 *
 * Une augmentation ajoute une ligne, elle n'écrase pas la précédente : sans
 * historique, un prévisionnel sur douze mois appliquerait le salaire
 * d'aujourd'hui au mois de janvier dernier.
 */
export interface Remuneration {
  id: string;
  entreprise_id: string;
  membre_id: string;
  depuis_le: string;
  brut_mensuel: number;
  /** Renseigné quand le comptable a donné le chiffre. Nul = à estimer. */
  cout_employeur_mensuel: number | null;
  taux_horaire_brut: number | null;
  heures_hebdo: number;
  notes: string | null;
  created_at: string;
}

export interface GabaritSousLot {
  titre: string;
  lignes: { reference: string; quantite: number }[];
}

export interface Gabarit {
  id: string;
  entreprise_id: string;
  nom: string;
  description: string | null;
  sous_lots: GabaritSousLot[];
  position: number;
  actif: boolean;
}

// --- Moteur TVA -------------------------------------------------------------

export interface Critere {
  code: string;
  libelle: string;
  attendu: string;
  constate: string;
  satisfait: boolean;
}

export interface JustificationTva {
  regle: string;
  libelle: string;
  baseLegale: string;
  taux: number;
  criteres: Critere[];
  mention: string;
  reserve: string | null;
}
