# Revue de la phase 1 — 13 octobre 2026

Objet : les commits « Phase 1 … version livrée » et « Fiche fluides :
corrections… » — SQL 32 et 33, `machines.ts`, `fichesFluide.ts`,
`alertesFluides.ts`, `Machines.tsx`, `FicheFluide.tsx`.

Méthode : quatre relecteurs indépendants (SQL, code, conformité au Cerfa
15497*04 et à sa notice 52064*04, règles de `CLAUDE.md`), puis un contre-examen
de chaque constat. Chaque défaut a été reproduit sur une copie de la base
locale reconstituée, en rôle `authenticated` quand il s'agissait de droits.
Les identifiants (SQL-…, F…, CERFA-…, R…) renvoient au rapport complet de la
revue ; plusieurs relecteurs ont trouvé les mêmes défauts, regroupés ici.

**Conclusion : ne pas exécuter les SQL 32 et 33 sur Supabase avant d'avoir
corrigé les sections 1 et 2.** Un technicien ne peut pas signer depuis
l'écran, une fiche se fige sans fluide ni charge, et la preuve de signature
reste modifiable après coup. Le SQL 34 (appels Allô) n'est pas concerné.

---

## 1. Bloque le parcours principal

| Constat | Ce qui se passe | Correctif |
|---|---|---|
| **F1, R3** — un technicien ne peut jamais signer | L'autocontrôle 3 lit `parametres`, que la RLS réserve à `voit_les_prix()`. L'erreur est avalée (`catch(() => null)`), l'attestation de capacité paraît absente, le bouton « Signer » reste grisé pour les techniciens et sous-traitants. La base, elle, accepterait. | Lire l'attestation dans la copie `f.operateur`, que la base rafraîchit et que tous lisent. Afficher les erreurs de lecture (paramètres, documents, liens signés) au lieu de les remplacer par du vide. |
| **F2, SQL-05, CERFA-02** — une fiche se fige sans fluide ni charge | L'autocontrôle 1 n'exige que le numéro de série et la photo. Les machines nées du devis n'ont jamais de charge. Une fréquence inconnue (`NULL`) est lue comme « non soumis », donc le contrôle d'étanchéité n'est plus exigé — l'inverse de la règle posée au SQL 32. La notice veut les cadres 1 à 4 toujours remplis. | Autocontrôle 1 : fluide connu du référentiel, charge > 0, tonnage calculé pour un HFC — en base et à l'écran. Fréquence `NULL` : bloquante (ou contrôle exigé), jamais « non soumis ». |
| **SQL-06** — le R134a n'est jamais reconnu | Le référentiel porte `'R134a'`, l'application normalise en `'R134A'`. Ni PRP, ni famille, ni fréquence, ni alerte d'étanchéité ; la liste déroulante retombe sur « — ». | Code `'R134A'` au référentiel, reprise des machines et brouillons existants. |
| **SQL-07, CERFA-01, F8, CERFA-09** — cadres 12 et 13 mal déclenchés | Destination **et** BSFF exigés dès que D + E > 0. Or E (fluide réintroduit) n'est pas un déchet, et le BSFF est « si connu » — il naît après la fiche, puisqu'il cite son numéro. Une réparation avec tirage au vide ne se signe qu'en inventant un BSFF. À l'inverse, la dénomination ADR du déchet s'imprime sur toutes les fiches et revient si on l'efface. | Cadres 12-13 seulement si D > 0 : destination exigée, BSFF facultatif et ajoutable après signature (hors colonnes figées). Dénomination ADR seulement si D > 0, sans réécrire un champ vidé. |
| **CERFA-03** — contenant exigé du mauvais côté | Le numéro de contenant est exigé pour le fluide chargé, jamais pour le fluide récupéré — l'inverse de la notice (« bouteille ou container de récupération »). | Exiger le contenant quand D > 0 (et E > 0 s'il y a transfert) ; ne plus l'exiger pour la charge. |
| **F3, CERFA-04** — le signataire n'est pas celui qui signe | `technicien_id` est figé à la création (souvent le gérant, si la fiche est ouverte au bureau) ; `signer_fiche_fluide` ne compare jamais `mon_membre()` au technicien. La fiche imprime le nom et l'attestation d'aptitude d'une autre personne que celle qui a tracé la signature ; un sous-traitant sans attestation peut signer au nom d'un technicien qui en a une. Qualité toujours « Technicien ». | À la signature, en base : technicien := `mon_membre()`, autocontrôle d'aptitude sur lui, qualité saisie. |

## 2. Sécurité et immuabilité (règles 4 et 5)

| Constat | Ce qui se passe | Correctif |
|---|---|---|
| **SQL-01, R2** — fuite entre entreprises | `instantane_fiche_fluide` et `manques_fiche_fluide` sont `security definer` et relisent machine, technicien, site, client, chantier et documents d'après les identifiants de la fiche, sans filtre d'entreprise. Un membre de A qui connaît un uuid de B copie dans sa fiche le client, la machine et l'attestation du technicien de B. Bloquant avant toute revente. | Filtrer chaque lecture sur `f.entreprise_id`, et refuser à l'écriture (déclencheur) une fiche qui pointe vers une ligne d'une autre entreprise. Filtrer la jointure chantier de `v_mouvements_fluide`. |
| **SQL-03, R1, CERFA-05** — signatures remplaçables après coup | Les images de signature sont des lignes `document` que tout membre peut modifier, supprimer ou doubler, fiche signée ou non ; l'impression prend la plus récente. Le fichier lui-même est réécrivable dans le seau. | Figer sur la fiche l'identifiant du document de chaque signature, n'imprimer que celui-là ; déclencheur sur `document` qui refuse update/delete et nouvel insert de signature sur une fiche non brouillon (sauf la signature attendue du client). |
| **SQL-02** — signature du client falsifiable sur un brouillon | Sur un brouillon, les colonnes `signature_detenteur_*` se modifient par simple UPDATE ; la signature du technicien ne les remet pas à zéro et la fiche se fige avec un client qui n'a pas signé. | Verrou : ces colonnes (et `rectifie_id`, `signature_detenteur_requise`) ne bougent qu'avec le drapeau des fonctions de signature ; remise à zéro à la signature du technicien. |
| **SQL-04, R4** — une rectification sort un mouvement du registre | L'originale passe « rectifiée » dès la création du brouillon rectificatif ; si celui-ci est abandonné ou supprimé (permis à tout membre), le mouvement disparaît du registre pour toujours et la fiche ne peut plus être rectifiée. | L'originale passe « rectifiée » à la signature de la rectificative ; interdire la suppression d'un brouillon rectificatif et la modification de son `rectifie_id` ; réserver la rectification à direction et chef de chantier. |
| **SQL-09, R6** — RGPD | La copie figée du détenteur contient le téléphone, que le Cerfa ne demande pas. `anonymiser_tiers` ignore les fiches : le registre des effacements déclare effacée une identité que les fiches gardent. | Ne copier que nom, adresse, SIRET. Faire compter les fiches signées par `portee_effacement` / `anonymiser_tiers` (conservation cinq ans, R.543-82), et le dire dans le compte rendu. |
| **SQL-10, CERFA-20** — série FF | `prochain_numero_fiche` est exécutable par tous, et `lpad(…, 4)` fait échouer toutes les signatures après la 9 999e de l'année. | Révoquer l'exécution ; ne pas tronquer (`greatest(4, length(n))`). Même défaut latent dans `prochain_numero` (SQL 01). |
| **R13** — une fiche par machine et par intervention, tenu par l'écran seul | Deux créations simultanées donnent deux fiches, toutes deux signables et comptées. | Index unique partiel sur (`intervention_id`, `equipement_id`) hors rectifiées. |
| **SQL-08, R11** — rejouer le 32 après le 33 | Le 32 réécrit la politique et la contrainte de `document` sans `fiche_fluide_id` : soit il échoue, soit les techniciens perdent l'accès aux signatures. | Un seul propriétaire pour cette politique et cette contrainte. |
| **SQL-13** — vérifications | Les blocs de vérification tournent en propriétaire : aucune politique RLS n'est éprouvée. | Rejouer les cas sous `set local role authenticated`, avec un technicien, et vérifier les refus ci-dessus. |

## 3. Conformité au Cerfa et à la notice

| Constat | Correctif |
|---|---|
| **CERFA-06** — le cadre 2 ne contient jamais l'adresse du détenteur, seulement celle du site, et il est vide sans site. | Adresse du client dans `detenteur.adresse`, adresse du site en adresse d'installation ; autocontrôle bloquant. |
| **R5** — détection permanente saisie deux fois (machine et fiche) ; dénomination ADR figée sur l'ancien fluide si la machine est corrigée. Le Cerfa peut imprimer 12 mois au lieu de 24, ou UN 1078 pour du R32. | Une seule source pendant le brouillon : la machine. Recalculer l'ADR tant que la fiche est en brouillon. |
| **CERFA-15** — « Fuites constatées : NON » suivi d'un tableau de fuites, ou « OUI » sans fuite. | Vider les fuites quand on passe à « non », exiger une localisation quand « oui ». |
| **CERFA-17** — une rectificative imprimée ne dit pas quelle fiche elle corrige ni pourquoi. | Imprimer « rectificative de FF-… (motif : …) » et « remplacée par FF-… » ; colonne motif. |
| **CERFA-18** — date d'intervention : la date prévue par défaut, librement modifiable, et le cadre signature imprime les dates de signature au lieu de celle de l'intervention. | Date de fin réelle par défaut, bornée par la signature ; l'imprimer dans le cadre signature. |
| **CERFA-19 (3)** — la qualité du client signataire est facultative. | La rendre obligatoire quand le client signe. |
| **CERFA-12** — catégories d'attestation limitées à I–V ; les attestations de 2027 (A1, A2, B, C, D, E, V) ne se saisissent pas. | Accepter les nouvelles catégories, ou ne plus imprimer la catégorie (le Cerfa ne demande que le numéro). |
| **CERFA-13** — R290 et R744 hors champ R.543-75 reçoivent quand même une fiche et une alerte « infraction » ; une charge de R22 vierge se signe sans avertissement. | Pas de fiche pour les fluides hors champ ; refuser ou justifier une charge d'un fluide inactif. |
| **CERFA-14** — huit fluides, aucun HFO, et personne ne peut en ajouter. | Compléter le référentiel (R404A, R448A, R449A, R452B, R513A, R1234yf, R1234ze…) ; ajout réservé à la direction. |
| **CERFA-11** — PRP des mélanges arrondis (2088 au lieu de 2087,5 pour le R410A) et tonnage arrondi avant les seuils ; PRP du R22 hors des règlements cités. | Valeurs exactes de l'annexe VI, arrondi à l'impression seulement. |
| **CERFA-10, R14** — commentaire faux sur la dérogation « hermétique de moins de 3 kg en logement » (vraie aussi pour les HFO) ; grille [7] tirée de la fréquence plutôt que de la quantité. | Corriger le commentaire ; cocher [7] d'après la charge ou le tonnage. |

## 4. Justesse des données et de l'écran

| Constat | Correctif |
|---|---|
| **F4** — une intervention crée un brouillon pour chaque machine active du chantier, sans moyen d'en écarter une ; l'alerte 3 les réclame ensuite comme des infractions. | Choisir les machines concernées ; permettre de supprimer un brouillon et de passer une machine en « déposée ». |
| **F5** — un entretien ou un dépannage ouvre son propre chantier : les machines du client, posées sur le chantier d'origine, sont introuvables et l'écran pousse à les ressaisir. | Chercher les machines du chantier **ou du site**. |
| **F6** — passer d'une fiche à l'autre garde l'état de la précédente : champs saisis, nom et qualité du client. | `key={id}` sur la page ; remise à zéro du nom et de la qualité. |
| **F7** — supprimer une fuite déplace sa localisation sur la suivante. | Clé stable par fuite. |
| **F9** — l'éditeur numérote 5, 6, 7 ce que le Cerfa numérote 5 à 10, 11 à 13, 14. | Reprendre la numérotation du Cerfa. |
| **F10** — alertes lues sans tri ni limite : au-delà de 1 000 lignes, réponse tronquée sans erreur. | Dernier contrôle par machine calculé en base ; requêtes filtrées. |
| **R7** — le PRP recopié sur la machine l'emporte sur le référentiel ; deux tonnages pour la même machine selon l'écran. | Lire le PRP au référentiel. |
| **R9** — `piece` et `emplacement` : le PV de réception lit l'ancienne colonne, vide pour les machines nées du devis. | Une seule colonne, lue partout. |
| **R10** — une lecture ratée du référentiel efface en silence le PRP de la machine. | Laisser l'erreur remonter, ne pas écrire `prp` sans référentiel. |
| **R12** — « fluide chargé si changement » en texte libre : « R-32 » et « R32 » font deux fluides au registre. | Normaliser par `codeFluide`, liste suggérée. |
| **SQL-11** — supprimer un chantier ou une intervention qui porte une fiche signée échoue avec « une fiche signée ne se modifie plus ». | Message explicite (conservation cinq ans). |
| **R8, R15** — en-têtes qui promettent un rejeu « par-dessus la version livrée » qu'ils ne tiennent pas ; variable `v_new`. | Corriger les en-têtes ; `v_rectificative`. |

## 5. À décider avec Fabrice avant de coder

- **Multi-split (CERFA-07).** Une machine et une fiche par unité intérieure,
  alors que le Cerfa raisonne par équipement, c'est-à-dire par circuit : un
  multi-split de quatre unités donne cinq fiches, avec des tonnages et des
  seuils calculés sur des fractions. Proposition : une machine par groupe
  extérieur, les unités intérieures en composants, la charge totale du
  circuit sur la machine.
- **Le formulaire officiel (CERFA-08, CERFA-16).** La notice déclare le
  formulaire 15497*04 obligatoire pour les catégories I à IV, et la FAQ de la
  DGPR dit que l'opérateur « doit utiliser le formulaire CERFA 15497 ». La
  page imprimée est une mise en page propre, cadres 5 à 10 et 11 à 13
  fusionnés, cadre 12 sans les rubriques déchet pré-imprimées. Proposition :
  remplir le PDF officiel par ses champs de formulaire et y poser les
  signatures. En attendant la réponse de SOCOTEC, ne pas titrer la page
  « Modèle Cerfa ».
- **PDF figé et empreinte (CERFA-19).** Le PLAN (§5) fait dépendre la
  validité de la signature simple d'une « empreinte du document » ; rien
  n'est figé aujourd'hui que la ligne en base.

## 6. Réfutés au contre-examen

- **SQL-12** — `drop view … cascade` : aucune vue ne dépend de
  `v_mouvements_fluide` ; c'est la convention du projet.
- **SQL-14** — la dérogation résidentielle : la DGPR la lit comme une
  exemption de plus, ce que fait le code (seul le commentaire est à
  corriger, voir R14).
- **SQL-15** — détection d'un `prochain_numero` écrasé : le 33 livré, joué
  en une fois, échoue et annule tout ; le cas n'existe pas sur Supabase.
- Sous-points écartés : le préfixe `FF-` (décision de `CLAUDE.md`), la
  signature à distance et l'envoi du PDF (utiles, non exigés), le contrôle
  des attestations à la date d'intervention (c'est la bonne référence).
