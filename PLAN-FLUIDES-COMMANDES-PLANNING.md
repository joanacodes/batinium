# Batinium — Plan : fluides, interventions, commandes, planning

Établi le 4 octobre 2026, à partir de : les notes d'appel avec Fabrice, sa
conversation avec un autre assistant, les trois PDF remplissables (Cerfa
15497*04 pour 5 machines, carnet de mise en service et d'entretien, carnet des
fluides frigorigènes), le planning « Les Samouraïs » du 30/09, et le bon de
commande BC-20260930-0063.

Ce document sert de cahier des charges pour la suite, que ce soit avec moi ou
avec Claude Code. Il dit ce qu'il faut construire, sur quoi ça s'appuie, et ce
que la loi impose. Il ne contient pas de code.

---

## 1. Ce que Fabrice veut, en une page

Fabrice a aujourd'hui **trois PDF remplissables** qu'il remplit à la main et
range dans Dropbox, client par client. Ils marchent, mais tout y est ressaisi :
le client, l'adresse, les machines, le technicien, l'attestation. Il veut que
Batinium **les remplisse depuis ce qu'il sait déjà** et n'en fasse générer le
document final qu'après vérification.

Sa chaîne, telle qu'il la décrit :

1. Un client signe un devis.
2. Batinium en tire les coordonnées du client et la liste des machines.
3. Il vérifie que les factures fournisseurs correspondent aux machines du devis.
4. Sur place, **la photo de la plaque signalétique fait foi** pour le modèle et
   le numéro de série — elle l'emporte sur le devis et sur la facture.
5. Des autocontrôles doivent être cochés ; sans eux, pas de document final.
6. Le Cerfa (une fiche par machine), le carnet de mise en service (laissé chez
   le client) et le carnet des fluides (registre de l'entreprise pour SOCOTEC)
   se génèrent tout seuls.

À côté, **deux autres besoins** qu'il distingue bien du fluide :

- Une **fiche d'intervention ordinaire** : ce qu'on a fait, le temps passé,
  des photos ou une vidéo, un descriptif dicté dans la langue du poseur —
  polonais, roumain — qui lui arrive traduit, et qui débouche sur une facture
  ou un devis à signer sur place.
- Un **ordre d'intervention** qu'il crée et envoie au technicien, avec tout :
  le client, le code d'accès, et l'historique complet du chantier.

Et il insiste : **un client peut avoir plusieurs chantiers**, les deux doivent
rester distincts. C'est déjà le cas dans Batinium (tiers → sites → chantiers).

Vos notes d'appel ajoutent le **volet fournisseurs** :

- synchroniser les arrivées de commandes avec les chantiers ;
- ajouter les consommables (bouchons, vis…) aux commandes ;
- planifier les bons de commande ;
- relancer les fournisseurs par e-mail — « accusez réception » — avec un voyant
  rouge tant que ce n'est pas fait ;
- demandes de prix et consultations ;
- un carnet fournisseurs, avec reconnaissance par domaine d'e-mail ;
- Pennylane ;
- le Cerfa des fluides, numéroté et rempli.

Le planning PDF montre ce que Fabrice gère **à la main** aujourd'hui : des
chantiers par état (en cours, à finir, bloqué, en attente, décalé), le
matériel et son statut de commande par fournisseur, l'équipe affectée, les
codes d'accès, les blocages et leur cause, et les rendez-vous de Yann. C'est
exactement ce que l'application doit tenir à sa place.

---

## 2. Ce qui existe déjà — ne pas reconstruire

Après les lots 12 à 37, Batinium a déjà :

| Besoin | Existant |
|---|---|
| Client ≠ chantier, plusieurs chantiers par client | `tiers` → `site` → `chantier` |
| Machines posées | `equipement` : marque, modèle, n° de série, emplacement, fluide, charge, mise en service, garantie, prochain entretien, photo de plaque, statut |
| Interventions | `intervention` : type (visite, pose, mise en service, SAV, entretien, contrôle d'étanchéité), dates, technicien ou sous-traitant, compte rendu, fluide, charge, récupéré, étanchéité |
| Attestation de capacité de l'entreprise | `parametres.attestation_capacite` + échéance + fichier + alerte 90 j |
| Attestation d'aptitude des techniciens | `membre.aptitude_fluides_num` + échéance + alerte |
| Matériel à commander par chantier | `approvisionnement`, rempli à la signature du devis |
| Factures fournisseurs, rapprochement ligne à ligne | `achat`, `achat_ligne` |
| Photos et vidéos de chantier | journal + `document` |
| Temps passé | `pointage` |
| Facturation, avoir, signature à distance ou hors établissement | `facture`, `devis.mode_conclusion` |
| Traduction | `fil.langue`, `fil.traductions` en base ; tâche `traduction` dans la passerelle IA — **pas encore d'écran** |
| Ma journée, fiche de pose pour le technicien | pages existantes |
| Documents par client, salarié, sous-traitant, chantier | bibliothèque unique, seau privé |
| Codes d'accès | `site.contraintes_acces` (texte libre) |
| Fournisseurs | `tiers.categorie = 'fournisseur'` existe, sans écran dédié |

Ce qui **n'existe pas** : le Cerfa comme objet, les carnets, les bons de
commande, les consultations, les équipes, la signature sur écran, l'écran de
traduction.

---

## 3. Le plan, module par module

### Module A — Le registre des machines

C'est le socle de tout le reste : le Cerfa, le carnet et l'entretien partent
tous d'une machine identifiée.

**Création automatique à la signature du devis.** Pour chaque ligne dont le
produit est une machine (familles `mono_split`, `multi_split`, `gainable`,
`console`, `cassette`, `groupe_eau`), une ligne `equipement` **par unité** —
une quantité de 2 donne deux machines — avec marque, modèle, fluide et charge
nominale repris du catalogue, et le numéro de série vide, marqué « à relever
sur place ». Ça s'ajoute à la chaîne `signerDevis()` du lot 23.

**La plaque signalétique fait foi.** Sur la fiche machine, un bouton
« Photographier la plaque » : la photo devient un document rattaché à la
machine, et le numéro de série se saisit en regardant la photo. Tant que la
photo n'est pas là, la machine reste « non vérifiée » — c'est un des
autocontrôles. Option, avec la passerelle IA déjà en place : lecture
automatique de la plaque (tâche `plaque` : marque, modèle, n° de série,
fluide, charge) **proposée**, jamais imposée — on relit avant d'accepter.

**Cohérence avec les achats.** Une machine dont la référence catalogue a une
ligne d'achat rapprochée est « cohérente avec la facture » ; sinon l'écran le
dit. Ce n'est pas bloquant mais ça se voit, c'est ce que Fabrice demande.

**Champs à ajouter sur `equipement`** : `puissance_kw`, `hermetique` (oui/non,
change le seuil de contrôle), `prp` (potentiel de réchauffement du fluide,
rempli automatiquement depuis le fluide), `tonnage_co2` calculé = charge × PRP
÷ 1000, `piece` (la pièce, distinct de l'emplacement libre), `verifie_le`
(date de la vérification plaque), `date_fin_garantie_pieces` (2 ans après
mise en service).

**Calculs réglementaires sur la fiche** : tonnage éq. CO2, fréquence de
contrôle d'étanchéité qui en découle, obligation d'entretien selon la
puissance. Voir §5.

**Écran** : onglet « Machines » sur la fiche chantier et sur la fiche client
(toutes ses machines, tous chantiers confondus). Le technicien y accède depuis
Ma journée pour relever les plaques.

### Module B — La fiche d'intervention fluides (Cerfa 15497*04)

**Objet nouveau : `fiche_fluide`.** Une fiche par machine et par intervention
touchant au fluide. Reprend rubrique par rubrique le Cerfa :

- *Opérateur* : rempli depuis `parametres` (raison sociale, adresse, SIRET,
  attestation de capacité, organisme, validité) et `membre` (technicien,
  n° de certificat d'aptitude).
- *Détenteur* : depuis `tiers` et `site` (nom, SIRET éventuel, adresse de
  l'installation, téléphone).
- *Équipement* : depuis `equipement` (marque/modèle, n° de série, pièce,
  fluide, charge, tonnage CO2, hermétique).
- *Nature* : les huit cases du Cerfa (assemblage, mise en service,
  modification, maintenance, contrôle périodique, contrôle non périodique,
  démantèlement, autre).
- *Contrôle d'étanchéité* : identification du détecteur, date de son dernier
  contrôle (depuis le registre des détecteurs, module D), détection permanente,
  fréquence applicable (calculée), fuites constatées, tableau des fuites avec
  réparation faite / à faire.
- *Manipulation* : A = B + C + D chargé (vierge, recyclé, régénéré), E = F + G
  récupéré (traitement, réutilisation), contenants, dénomination ADR/RID
  (préremplie selon le fluide : R32 → UN 3252 Difluorométhane, 2.1),
  installation de destination, n° de BSFF.
- *Observations*, *signatures* opérateur et détenteur avec dates.

**Numérotation** : `prochain_numero('fiche')` — le compteur existant, qui ne
recule jamais. Format proposé `FF-2026-0001`, réglable comme les autres.

**Autocontrôles bloquants** avant génération du PDF :
1. machine vérifiée par photo de plaque et numéro de série saisi ;
2. technicien avec attestation d'aptitude en cours de validité ;
3. attestation de capacité de l'entreprise en cours de validité ;
4. nature de l'intervention cochée ;
5. si fluide manipulé : quantités cohérentes (A = B + C + D, E = F + G) et
   contenant identifié ; si fluide récupéré : destination et BSFF ;
6. contrôle d'étanchéité renseigné quand la nature l'exige ;
7. les deux signatures.

Tant qu'une case manque, l'écran liste ce qui reste et le bouton « Générer la
fiche » est inactif — c'est la règle que Fabrice formule.

**Signature sur écran** : un composant de signature au doigt (canvas → image),
pour le technicien et pour le client, enregistré comme document de type
`signature` rattaché à la fiche, avec horodatage et nom du signataire.

**Immuabilité** : une fiche signée ne se modifie plus (déclencheur, comme pour
les factures). Correction par une fiche rectificative qui référence
l'originale. Le registre des fluides en dépend : une ligne qui bouge en
silence rendrait le bilan annuel faux.

**PDF** : généré côté navigateur (impression) dans un premier temps, comme les
devis et factures. Il reproduit **toutes les rubriques** du 15497*04, dans
l'ordre, avec la mention « Modèle Cerfa n° 15497*04 ». Voir §5 sur le
formulaire officiel. Deux exemplaires : l'un dans la bibliothèque du client,
l'autre dans celle de l'entreprise, conservés cinq ans — la bibliothèque
existante le fait déjà, il suffit d'un type de document `fiche_fluide`.

**Déclenchement** : depuis une intervention de type mise en service, entretien,
SAV ou contrôle d'étanchéité, bouton « Fiche fluides » par machine du chantier.
Une intervention sur trois machines donne trois fiches, préremplies à
l'identique sauf l'équipement.

### Module C — Le carnet de mise en service et d'entretien

Le document que Fabrice laisse chez le client. **Il ne se saisit pas, il se
génère** depuis ce que la base contient pour un chantier :

- page 1 : installation (client, adresse, lot, contacts, devis, date de mise en
  service, nombre de machines), installateur, garanties, numéro SAV — tout
  existe ;
- page 2 : identification des machines — depuis `equipement`, avec le tonnage
  CO2 calculé ; accessoires et options (télécommandes remises, évacuation des
  condensats, protection électrique, notices remises) — **quatre champs à
  ajouter sur `chantier`** ;
- page 3 : procès-verbal de mise en service — **17 contrôles par machine**
  (azote, vide, tenue du vide, charge complémentaire, étanchéité, électricité,
  condensats, températures froid/chaud, intensité, bruit, télécommande, Cerfa
  établi, utilisateur formé) : à saisir sur l'intervention de mise en service,
  colonne par machine. Stockage en `jsonb` sur `intervention.controles`,
  structuré `{ machine_id: { controle: valeur } }` ;
- page 4 : réglementation et conseils — texte fixe ;
- pages 5-6 : registre des interventions — depuis `intervention`, avec le
  numéro de la fiche fluides quand il y en a une ;
- pages 7-8 : visites d'entretien — **13 opérations par machine**, saisies
  sur chaque intervention d'entretien, même mécanisme que le PV.

Généré en PDF à la mise en service, régénéré à chaque entretien avec le
registre à jour, rangé dans la bibliothèque du chantier et envoyable au
client. Fabrice peut aussi l'imprimer pour le laisser sur place, comme
aujourd'hui.

**L'attestation d'entretien** : à chaque intervention d'entretien close sur une
PAC de 4 à 70 kW, un document d'une page généré automatiquement et remis au
client — c'est une obligation (voir §5), et aujourd'hui rien ne la produit.

### Module D — Le carnet des fluides frigorigènes (registre de l'opérateur)

Le registre de **l'entreprise**, que SOCOTEC peut demander et dont le bilan
part chaque janvier. Contrairement au carnet du client, il est unique et
transversal. Trois nouvelles tables, et le reste se calcule.

**`detecteur_fuite`** : marque/modèle, identification, date du dernier
contrôle, prochain contrôle (12 mois). Alerte dans la cloche un mois avant.
C'est lui qu'on cite dans la rubrique 5 du Cerfa.

**`bouteille`** : n° de bouteille, fluide, type (V vierge / R récupération),
fournisseur, date et quantité reçues, date et quantité retournées, n° de BL ou
de BSFF. Le stock par fluide en découle.

**Les mouvements** ne se saisissent pas : chaque `fiche_fluide` signée en est
une ligne (date, client, machine, n° de fiche, fluide, bouteille, chargé,
récupéré, destination/BSFF). Une vue suffit.

**Le bilan annuel par fluide** : stock au 1er janvier + acquis − chargé +
récupéré − remis = stock au 31 décembre. Calculé, modifiable, et surtout
**exportable** en PDF pour SOCOTEC, avec une alerte dans la cloche à partir du
1er décembre : « bilan fluides à transmettre avant le 31 janvier ».

**Personnel habilité** : la page 1 du carnet se tire des membres ayant une
attestation d'aptitude — déjà en base.

**Écran** : une entrée « Fluides » dans Terrain, réservée à ceux qui voient les
prix, avec quatre onglets : détecteurs, bouteilles, mouvements, bilan annuel.

### Module E — La fiche d'intervention ordinaire et sa clôture

Ce que Fabrice distingue du fluide : « ce qu'on a fait, le temps qu'on y a
passé ». La plupart des briques existent, il manque l'enchaînement.

**La clôture d'une intervention** devient un écran à part entière, sur le
téléphone du technicien :
- ce qui a été fait — compte rendu, **dicté dans sa langue** ;
- le temps : prérempli depuis `debut_le`/`fin_le`, créant le pointage ;
- photos et vidéos — le journal, déjà là ;
- matériel utilisé, s'il y en a ;
- la **suite** : « sous garantie, rien à facturer » / « à facturer » /
  « devis à établir ».

**La traduction** : `fil.langue` et `fil.traductions` existent, la tâche
`traduction` existe dans la passerelle, il manque l'écran. Règle : le compte
rendu est enregistré dans la langue d'origine **et** traduit en français ; les
deux sont conservés, le français s'affiche en premier chez Fabrice, l'original
reste consultable. Une traduction n'est pas une réécriture — le modèle a
consigne de ne rien résumer.

**Facture ou devis sur place** : depuis la clôture, « Facturer » crée le
brouillon de facture depuis le matériel utilisé et le temps (au taux de la
grille), « Établir un devis » crée un brouillon de devis dicté. Puis signature
sur écran du client, en mode `hors_etablissement` — ce qui déclenche les règles
de rétractation déjà en place. Voir §5, c'est le point légal le plus délicat
de tout le plan.

### Module F — L'ordre d'intervention

Fabrice crée une intervention, l'affecte, et le technicien reçoit « tout ».

**Ce qui existe** : Ma journée montre les interventions du jour avec adresse,
itinéraire, contraintes d'accès, fiche de pose, journal.

**Ce qui manque** :
- `site.code_acces` séparé des contraintes libres — un code d'immeuble n'est
  pas une remarque, il doit se lire en un coup d'œil et se copier ;
- l'historique **complet** depuis la première demande : le fil du chantier
  existe, il faut l'ouvrir depuis Ma journée et y inclure la demande d'origine,
  le devis, les échanges, les interventions passées ;
- une **notification** au technicien à l'affectation. Sans infrastructure de
  notification pour l'instant : un e-mail (via Google, quand il sera branché)
  ou un SMS (via Allô, qui sait en envoyer — à vérifier dans leur API). En
  attendant, le badge « nouvelle intervention » dans Ma journée ;
- une version **imprimable** de l'ordre, pour le sous-traitant qui n'a pas
  l'application.

### Module G — Les bons de commande fournisseurs

Le bon de commande BC-20260930-0063 montre le format que Fabrice utilise : un
numéro daté, le fournisseur et son contact, la référence du chantier et du
devis, un tableau quantité / référence / désignation / localisation, et une
liste de **confirmations attendues** (prix, délais, disponibilité, mode de
livraison). Il attend une réponse ; c'est cette réponse qu'il faut suivre.

**Objets nouveaux** : `commande_fournisseur` (numéro `BC-AAAAMMJJ-NNNN` via le
compteur, fournisseur, contact, chantier, devis, statut, dates d'envoi,
d'accusé, de confirmation, livraison annoncée, notes, questions posées) et
`commande_ligne` (lien vers `approvisionnement`, désignation, référence,
quantité, localisation, prix et délai confirmés par le fournisseur).

**Cycle** : brouillon → envoyée → accusé de réception → confirmée (prix et
délais remplis) → livrée partiellement → livrée. Chaque passage est daté.

**Le voyant rouge** : une commande envoyée sans accusé de réception depuis
**deux jours ouvrés** passe en rouge dans la liste et dans la cloche, avec un
bouton « Relancer » qui prépare l'e-mail « Merci d'accuser réception de notre
commande n°… ». L'envoi passe par Google quand il sera branché ; en attendant,
ouverture dans la messagerie, comme pour les devis.

**Synchronisation avec le chantier** : marquer une ligne livrée coche
`approvisionnement.livre_le`, et quand tout est livré, le préalable « Matériel
livré » du chantier se coche seul. La date de livraison annoncée par le
fournisseur alimente le planning : un chantier dont le matériel arrive le 15
ne peut pas démarrer le 12, et l'écran le dit.

**Consommables** : une case `consommable` sur les produits, et dans chaque bon
de commande un bouton « Ajouter les consommables » qui propose la liste
(bouchons, vis, colliers, gaine, mastic…) avec des quantités par défaut selon
le nombre de machines. Fabrice règle la liste une fois dans le catalogue.

**Création depuis le chantier** : « Commander le matériel » regroupe les
lignes d'approvisionnement non commandées par fournisseur habituel du produit
(nouveau champ `produit.fournisseur_id`) et crée un brouillon par fournisseur.

### Module H — Demandes de prix et consultations

Avant de commander, Fabrice consulte parfois plusieurs fournisseurs.

**Objets** : `consultation` (chantier, lignes, date limite de réponse) et
`consultation_reponse` (fournisseur, statut, prix par ligne, délai, remarques).
Même liste envoyée à N fournisseurs, tableau comparatif des réponses, « Retenir
ce fournisseur » qui transforme la consultation en bon de commande. Simple,
mais ça évite trois e-mails et une feuille Excel.

### Module I — Carnet fournisseurs et reconnaissance par domaine

**Écran fournisseurs** : les `tiers` de catégorie fournisseur n'ont pas
d'écran. Fiche avec contacts (plusieurs : commercial, administratif, comptoir),
conditions, délais habituels, **domaines d'e-mail** (`dgclimatisation.com`,
`clim-plus.fr`…), et l'historique des commandes et des factures.

**Reconnaissance** : un e-mail entrant dont l'expéditeur est sur un domaine
connu est rattaché au fournisseur ; s'il contient un numéro `BC-…`, il est
rattaché à la commande et, selon son contenu (« accusé », « confirmation »,
« bon de livraison »), fait avancer son statut — proposé, pas imposé. Ce
module **dépend de la synchronisation Gmail**, donc de la configuration Google
décrite dans `GOOGLE.md`.

### Module J — Le planning d'équipe

Le PDF des Samouraïs, dans l'application.

**Équipes** : table `equipe` (nom, membres, sous-traitants) — Équipe 1
Alexander + Yvan, Équipe 2 Alex + Dominique, Yann + Martin en formation.
`chantier.equipe_id`, avec possibilité de « toute l'équipe » sur un chantier
prioritaire.

**État de planning** sur le chantier, distinct du statut d'avancement :
`en_cours`, `a_finir`, `bloque`, `en_attente`, `decale`, avec `motif_blocage`
(carrelage pas fait, feu vert de l'architecte, matériel manquant…) et
`date_cible`. C'est ce qui manque pour que Rentabilité et Aujourd'hui disent
*pourquoi* un chantier n'avance pas.

**Vue planning** : par semaine, une colonne par équipe, les chantiers en
cartes avec adresse, code d'accès, matériel (vert livré / orange en cours /
rouge manquant — depuis les commandes), blocage en rouge. Les rendez-vous de
Yann sont ses interventions `visite_technique`. C'est le lot « calendrier »
prévu depuis le début, avec les filtres additifs et le glisser-déposer.

**Export PDF** du planning, pour continuer à l'envoyer à l'équipe par
WhatsApp comme aujourd'hui, le temps que tout le monde ait l'application.

### Module K — Pennylane

API Entreprise V2 en OAuth2 : même classe de travail que Google. Pousser les
factures émises et les factures fournisseurs, récupérer les règlements. À
faire quand Fabrice y sera, pas avant. Prévoir le connecteur sur la page
Connexions, comme Allô.

### Module L — Dropbox

Fabrice range aujourd'hui ses PDF dans Dropbox, par client, dans un dossier
« DOCUMENTS OFFICIELS MACHINES ». Batinium a sa propre bibliothèque, privée et
cloisonnée. Deux options, à trancher avec lui :

- **Batinium remplace Dropbox** pour ces documents : plus simple, un seul
  endroit, les droits sont tenus par la base ;
- **Batinium pousse une copie** dans Dropbox, dans son arborescence actuelle :
  rassurant pour lui, mais deux endroits pour le même fichier, et une
  intégration OAuth de plus.

Recommandation : la première, avec un export complet possible à tout moment
(il existe). La seconde seulement s'il y tient.

---

## 4. Ordre de réalisation

Chaque phase est livrable et utile seule. Les dépendances sont indiquées.

**Phase 1 — Machines et Cerfa** (modules A, B). Le cœur de la demande, et
l'obligation légale la plus immédiate. Dépend de rien.

**Phase 2 — Les deux carnets** (modules C, D). Se génèrent depuis la phase 1.
Comprend l'attestation d'entretien et le bilan annuel.

**Phase 3 — Clôture d'intervention, traduction, signature sur place,
ordre d'intervention** (modules E, F). La traduction débloque les poseurs
étrangers ; la signature sur place débloque le SAV facturé le jour même.

**Phase 4 — Commandes, voyant rouge, consommables, livraison synchronisée**
(module G). Indépendant des phases précédentes ; l'envoi d'e-mail est en mode
« ouvrir dans ma messagerie » tant que Google n'est pas branché.

**Phase 5 — Planning d'équipe** (module J). Le calendrier promis, enrichi des
équipes et des blocages.

**Phase 6 — Consultations, carnet fournisseurs, reconnaissance par domaine**
(modules H, I). La reconnaissance exige Gmail.

**Phase 7 — Pennylane, Dropbox** (modules K, L). Quand Fabrice y sera.

---

## 5. Ce que la loi impose — à ne pas rater

Ces points conditionnent la conception. Les références sont celles citées dans
les documents de Fabrice ; les articles exacts et les valeurs chiffrées sont
**à faire vérifier** par SOCOTEC ou un juriste avant la mise en production, la
réglementation des fluides ayant changé en 2024.

**Fiche d'intervention.** Toute opération sur le fluide d'un équipement —
assemblage, mise en service, maintenance, contrôle, démantèlement — donne lieu
à une fiche conforme au Cerfa 15497*04 (art. R.543-82 du Code de
l'environnement, arrêté du 29 février 2016). Une fiche **par équipement**,
établie en **deux exemplaires**, signée par l'opérateur et le détenteur, et
conservée **cinq ans** par chacun. Conséquences : une fiche par machine et non
par chantier ; deux exemplaires rangés ; immuable après signature.

**Qui a le droit.** Seule une entreprise titulaire d'une **attestation de
capacité** peut manipuler le fluide (R.543-99), et seuls des techniciens
titulaires d'une **attestation d'aptitude** peuvent intervenir. D'où les
autocontrôles 2 et 3 : une fiche ne doit pas pouvoir se générer avec une
attestation périmée. Pilotech : ACO / SQ026081-001, SOCOTEC, catégorie I,
valable jusqu'au 06/09/2031.

**Contrôle d'étanchéité périodique.** Obligatoire à partir de **5 tonnes
équivalent CO2** de fluide par circuit, **10 tonnes** si l'équipement est
hermétiquement scellé. Fréquence : tous les 12 mois de 5 à 50 t, 6 mois de
50 à 500 t, 3 mois au-delà ; **doublée** avec un système permanent de
détection. Pour le R32 (PRP 675), 5 t correspondent à 7,4 kg : la plupart des
installations résidentielles sont en dessous — « non soumis », mais la fiche
reste due pour toute charge ou récupération. Le tonnage se calcule charge ×
PRP ÷ 1000. PRP utilisés dans les documents de Fabrice : R32 675, R410A 2088,
R454B 466, R290 3, R134a 1430 — **à confirmer** contre l'annexe du règlement
F-gaz en vigueur (UE 2024/573).

**Bilan annuel.** L'opérateur transmet chaque année à l'organisme qui a délivré
son attestation (SOCOTEC, via Certi'Fluide) le bilan de ses mouvements de
fluide, **avant le 31 janvier**. D'où le registre, le calcul et l'alerte.

**Fluide récupéré.** Remis à un distributeur ou à une installation de
traitement, avec un **bordereau de suivi (BSFF) sur Trackdéchets**. Le numéro
de BSFF est une rubrique du Cerfa. Il est interdit de dégazer à l'air libre.

**Détecteurs de fuite.** Contrôlés au moins **une fois par an**. D'où le
registre et l'alerte.

**Entretien des pompes à chaleur.** Décret n° 2020-912 du 28 juillet 2020 :
entretien **tous les deux ans** pour les PAC de **4 à 70 kW**, avec remise
d'une **attestation d'entretien** au commanditaire. En dessous de 4 kW,
recommandé, pas imposé. D'où `puissance_kw` sur la machine, le calcul du
prochain entretien, et le document d'attestation.

**Signature sur place chez un particulier.** C'est le point le plus délicat
du plan. Un devis signé au domicile du client est un contrat **hors
établissement** : le consommateur dispose d'un délai de rétractation de
**14 jours**, et le professionnel ne peut recevoir **aucun paiement avant
sept jours** (Code de la consommation, L.221-10 et L.221-18). Batinium
applique déjà ces règles par `mode_conclusion`. Deux exceptions à connaître,
car elles sont exactement le cas du SAV :
- les travaux d'entretien ou de réparation **à réaliser en urgence** au domicile
  du consommateur et **expressément sollicités par lui** échappent à la
  rétractation, mais seulement pour la réparation demandée, pas pour ce qui
  serait vendu en plus (L.221-28) ;
- pour commencer avant la fin du délai, il faut une **demande expresse** du
  client, écrite, et il reste alors redevable du travail effectué s'il se
  rétracte (L.221-25).
Conséquence : l'écran de signature sur place doit faire cocher et signer
explicitement l'une de ces mentions, les conserver avec la signature, et la
facture ne peut être encaissée sur place que dans le cas de l'urgence
sollicitée. Ces formulations sont **à faire valider par un juriste** avant
usage : une erreur ici rend le contrat annulable.

**Signature électronique.** Pour ces documents, une signature « simple » —
tracé au doigt, horodaté, avec identité du signataire et empreinte du document
— est admise. Il faut conserver ensemble le document signé, l'image de la
signature, la date, l'heure et l'identité déclarée. On n'a pas besoin d'un
prestataire de signature qualifiée.

**Garanties.** Le carnet annonce deux ans pièces et main-d'œuvre et la
décennale. Ces engagements doivent être **identiques à ceux des conditions
générales** du devis ; le texte du carnet doit se générer depuis les
paramètres, pas être écrit en dur.

**Conservation.** Fiches cinq ans, factures dix ans, pointages cinq ans : déjà
dans le registre RGPD de la page Données. Les fiches fluides s'y ajoutent.

---

## 6. Questions à poser à Fabrice avant de coder

1. **Le formulaire officiel.** L'autre assistant a reproduit les rubriques du
   Cerfa, pas sa mise en page. SOCOTEC accepte-t-il une reproduction fidèle, ou
   exige-t-il le formulaire officiel de service-public.fr ? Ça change la façon
   de générer le PDF.
2. **Numérotation des fiches** : par an (`FF-2026-0001`) ou continue ?
3. **Client absent** : qui signe la rubrique « détenteur » quand le client n'est
   pas là ? Signature différée par e-mail ?
4. **Bouteilles** : utilise-t-il des bouteilles de récupération ? Chez quel
   distributeur les retourne-t-il ?
5. **Dropbox** : remplacement ou copie ?
6. **Équipes** : fixes ou recomposées par chantier ?
7. **Consommables** : sa liste, avec les quantités habituelles par machine.
8. **Notification du technicien** : e-mail, SMS, ou l'application suffit ?
9. **La note coupée** : « fiche d'intervention qui garde le nom du… » — de qui ?
10. **Google** : la synchronisation e-mail conditionne les relances
    fournisseurs et la reconnaissance par domaine. Quand peut-il faire la
    configuration de `GOOGLE.md` ?
