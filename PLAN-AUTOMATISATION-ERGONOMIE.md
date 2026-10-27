# Batinium — Plan : après la signature, tout s'enchaîne

Établi le 27 octobre 2026, à partir de : les deux pages de notes de Fabrice
(« Batinium Pilotech Notes »), ses deux messages du matin sur l'assistant à
la voix, et la capture de son artifact « Devis à valider » du 15 octobre, où
il relit ses brouillons Tolteck avec Claude.

Ce document complète `PLAN-FLUIDES-COMMANDES-PLANNING.md` (modules A à L,
phases 1 à 7) sans le remplacer : ses modules sont repris là où la chaîne en
a besoin, et les nouveaux continuent la lettre (M à U). Comme lui, il dit quoi
construire, sur quoi ça s'appuie et ce que la loi impose ; il ne contient pas
de code. Un prompt par étape s'écrira une fois les décisions du § 6 prises.

---

## 1. Ce que Fabrice demande, en une page

**Il ne veut pas réfléchir.** Une fois le devis signé, tout doit suivre seul ;
ce qui reste à décider doit lui arriver prêt, avec un bouton.

Sa chaîne, telle qu'il l'écrit :

> Prise de rendez-vous > devis > accepté avec acompte > commande de matériel >
> affectation chantier avec liste de ce qu'il y a à faire > réception du
> paiement de matériaux > Cerfa, attestation TVA

et pour la facturation : *facture d'acompte > facture de solde*.

**La réunion du matin, à la voix.** Ses mots : « un chat comme avec Claude… le
truc reste ouvert à la voix pendant que tu consultes le reste… tu lui dis
celui-là, tu me le passes en facture, celui-là il faut relancer cette
commande-là, il faut relancer ce client-là, tu lui réponds ça… tu refermes et
tu vas travailler, et le logiciel met à jour suivant toutes les informations
que tu as données. » Et : « comme une réunion matinale : tu checkes tout ce
qui est arrivé en rouge, tout ce qu'il y a à faire […] ensuite le logiciel va
bosser et mettre dans les cases tout seul. »

**L'ergonomie « pour les nuls »**, qu'il a commencé à dessiner lui-même :

- une **file de travail**, pas un tableau : ses brouillons rangés en onglets
  avec leur compte (à traiter, à modifier, validés, envoyés, déjà traités,
  anciens, abandonnés, tout) ;
- une **carte par devis** : client, objet, montant TTC, marge, et les **points
  à vérifier** écrits en clair — une puissance à revoir dans une chambre, une
  seule unité pour un grand salon, une option hors total, un rapport d'expert
  pas reçu, l'e-mail du client manquant, des prix estimés ;
- **trois ou quatre gros boutons** : Validé, À modifier, Déjà traité, Ouvrir ;
- et la règle d'or : « Envoyer » montre le mail exact avec ses pièces jointes,
  et **« Envoyer ce mail » vaut accord** : l'envoi part, Fabrice en copie.

**Sur le terrain** :

- *fiche d'intervention* : « tel jour, telle heure, tel endroit pour une
  réparation ; l'employé récupère toutes les infos » ;
- *emplacements des chantiers (chambres…* — la note est coupée ;
- *vue devis des techniciens* ;
- *sous-traitants* : « simplifier la vue, pour pas qu'il se monte la tête en
  voyant les prix. Il doit juste savoir ce qui doit être installé et où. »

**Et encore** : plusieurs TVA dans le même devis ; le suivi client.

Les quatre demandes de sa première liste — heure d'arrivée, GPS, à facturer /
SAV / nouveau devis, contrats d'entretien — sont codées depuis le 13 octobre
(SQL 35 à 37).

---

## 2. Ce qui existe déjà, ce qui manque

| Ce qu'il demande | Ce qui existe | Ce qui manque |
|---|---|---|
| Prise de rendez-vous | Demandes avec date de rappel ; interventions de type « visite » ; calendrier basique ; agenda Google prévu (code prêt, Google pas configuré) | Proposer un créneau depuis la demande, confirmer au client, le rappeler la veille |
| Devis | Éditeur complet, devis dicté, gabarits, variantes, TVA justifiée par ligne, import CSV (Tolteck compris), envoi relu par l'IA | Fabrice chiffre encore dans Tolteck ; l'envoi passe par sa messagerie, à la main |
| Accepté avec acompte | `signerDevis` : chantier, machines, matériel à commander, interventions à planifier, échéancier, facture d'acompte en brouillon, note au journal ; délais légaux calculés | La chaîne tourne dans le navigateur de celui qui clique ; la liste des devis peut passer un devis « signé » sans elle ; « Ouvrir le chantier » en crée un à chaque clic ; le client ne peut pas signer à distance ; l'acompte reste un brouillon à émettre et envoyer |
| Commande de matériel | Liste « À commander et faire livrer » tirée du devis ; achats rapprochés ligne à ligne, qui cochent la livraison | Bons de commande, envoi, accusé de réception, relance : module G (phase 4), pas commencé |
| Affectation, liste de ce qu'il y a à faire | Interventions sans date ni personne ; préalables cochables ; fiche de pose sans prix ; Ma journée | Date et équipe choisies à la main ; pas de planning d'équipe (module J, phase 5) ; pas d'heure de rendez-vous |
| Réception du paiement de matériaux | Échéancier d'encaissement (échéance, reçu le, moyen) ; alerte « encaissement possible » | Pas d'alerte d'échéance dépassée, pas de relance ; la facture d'échéance ne se prépare pas à la livraison |
| Cerfa | Fiche fluides Cerfa 15497*04 (phase 1) | En attente des correctifs de la revue (`REVUE-PHASE-1.md`) ; SQL 32 et 33 non exécutés |
| Attestation TVA | Moteur de TVA : taux choisi et justifié selon le site et l'ancienneté du logement | Aucun document ; la règle a changé en 2025 (§ 7) |
| Facture d'acompte, puis de solde | Factures d'acompte, de situation, de solde, avoirs ; numéro à l'émission ; immuables | Le solde se crée à la main, et l'acompte déjà facturé s'y **retape** au lieu d'être lu |
| Plusieurs TVA dans le même devis | **Déjà là** : un taux par ligne, ventilation par taux sur le devis, l'acompte et la facture | Rien — à montrer à Fabrice |
| Fiche d'intervention | Intervention SAV ; Ma journée : adresse, itinéraire, accès, fiche de pose, journal, arrivée et départ | L'ordre d'intervention du module F (phase 3) : code d'accès à part, historique complet, technicien prévenu, version imprimable ; et l'heure |
| Emplacements (chambres) | Un texte libre « emplacement » sur la ligne de devis et sur la machine | Pas de pièces par site (nom, surface) ; rien ne relie une pièce à ses lignes, ses machines, sa puissance |
| Vue devis des techniciens | Fiche de pose : le devis sans aucun prix, garanti par la base (`v_fiche_pose`) | À préciser (question 1) |
| Sous-traitants | Un rôle à part, sans prix ; le mode démonstration montre son écran | La base leur ouvre tous les clients, demandes et chantiers ; leur menu est celui d'un technicien |
| Suivi client | Fiche client et son historique ; devis à relancer (date, alerte) ; « Devis envoyés sans réponse » sur l'accueil ; Boîte mail en lecture | Relances écrites et envoyées à la main ; pas de relance de paiement ; pas de rappel d'entretien au client |
| Réunion du matin | La cloche : toutes les alertes, par gravité ; l'accueil | Une liste de liens, pas de décisions : chaque alerte oblige à ouvrir un écran et à savoir quoi y faire |
| Assistant à la voix | Bulle sur toutes les pages, qui lit avec les droits de la personne ; dictée du navigateur ; notes et brouillons de devis | Aucune autre action (facture, relance, réponse) ; ne sait pas ce qui est à l'écran (« celui-là ») |

**Ce qui ressort.** La chaîne existe aux deux tiers : signer un devis ouvre
déjà le chantier, crée les machines, la liste de matériel, les interventions,
l'échéancier et la facture d'acompte. Ce qui manque n'est pas une fonction de
plus. Ce sont quatre capacités que Batinium n'a pas — envoyer, produire un
document sans personne devant l'écran, se réveiller seul à une heure donnée,
enchaîner une signature qui ne passe pas par le navigateur de Fabrice — et
l'écran qui lui dit quoi décider.

**Le préalable à tout** : que les devis se fassent dans Batinium. L'artifact
de Fabrice relit des brouillons Tolteck ; tant qu'un devis est signé dans
Tolteck, rien ne se déclenche ici. L'import CSV existe pour reprendre les
devis en cours.

---

## 3. Les fondations — sans elles, rien n'est automatique

### F1 — Envoyer depuis le serveur

Aujourd'hui, tout envoi ouvre la messagerie de celui qui clique (`mailto`) :
rien ne part sans Fabrice devant l'écran, et rien ne part la nuit. Il faut une
fonction serveur qui envoie un e-mail avec ses pièces jointes et en garde la
trace (quoi, à qui, quand, réponse du serveur d'envoi).

Deux voies :

- **le Gmail de Pilotech**, par l'autorisation longue décrite dans
  `GOOGLE.md` (le droit `gmail.send` est déjà demandé, jamais utilisé) : les
  mails partent de son adresse, restent dans ses « Envoyés », et les réponses
  arrivent chez lui. Recommandé pour commencer ;
- **un service d'envoi** au domaine de l'entreprise (DKIM, SPF) : à prévoir
  pour la revente, où chaque entreprise n'aura pas Gmail.

Les SMS (rappel de rendez-vous, « le technicien arrive ») : Allô sait en
envoyer, à vérifier dans son API.

### F2 — Faire les PDF sans personne devant l'écran

Devis, factures, PV et attestations s'impriment aujourd'hui par le navigateur
(`window.print()`). Un document joint à un envoi automatique doit exister
comme fichier, rangé dans la bibliothèque (seau `documents`), identique à
celui qu'on imprime. Choix à faire en tête de l'étape 2 : un rendu côté
serveur, ou une génération dans le navigateur au moment où Fabrice valide. Le
second évite un service de plus mais suppose quelqu'un devant l'écran ; seul
le premier permet l'envoi de nuit. Un document émis est figé (règle 5) : le
PDF d'une facture se fabrique une fois, à l'émission, et ne se refait pas.

### F3 — Se réveiller tout seul

Relances, échéances dépassées, point du matin préparé avant 7 h, mails
entrants relevés la nuit, rappel de rendez-vous la veille : il faut des tâches
planifiées (Supabase Cron, qui appelle une fonction). Le projet n'en a aucune.

### F4 — La chaîne de signature en base, quel que soit le chemin

`signerDevis` tourne dans le navigateur de celui qui clique : si l'onglet se
ferme au milieu, la suite s'arrête ; si le client signe depuis chez lui, rien
ne se passe ; la liste des devis peut passer un devis « signé » sans elle ;
« Ouvrir le chantier » en crée un à chaque clic. La chaîne doit vivre côté
serveur, en une fonction **rejouable** — elle complète ce qui manque et ne
recrée jamais ce qui existe — appelée par **tous** les chemins : éditeur,
liste, lien de signature du client, signature sur place.

### F5 — Prévenir sur le téléphone (plus tard)

Pour que le technicien reçoive son ordre d'intervention et que Fabrice sache
qu'un devis est signé : Batinium installable sur l'écran d'accueil (manifeste,
service worker) et des notifications. Sur iPhone, il faut l'avoir installé
depuis Safari. En attendant : e-mail ou SMS (F1).

---

## 4. Le plan, module par module

### Module M — La file « À décider »

La réponse directe à « ergonomie pour les nuls », reprise de l'artifact de
Fabrice et étendue à tout Batinium.

**Ce qu'il voit.** En ouvrant Batinium, en tête de l'accueil, à la place des
listes actuelles (« Sur le terrain aujourd'hui » reste dessous) : une seule
file de cartes, le rouge d'abord, avec des onglets et leur compte (Urgent,
À décider, En attente du client, Fait aujourd'hui). Chaque carte dit
qui, quoi, combien, ce qui cloche, et porte deux à quatre gros boutons. Le
bouton principal dit ce qui va se passer : « Envoyer le devis », « Émettre et
envoyer l'acompte », « Relancer », « Planifier jeudi 8 h avec Alex ». Quand
quelque chose doit partir, il montre d'abord le mail exact et ses pièces
jointes, et c'est le toucher sur « Envoyer ce mail » qui vaut accord.
Partout : « Déjà traité » (rangé sans rien faire) et « Plus tard » (revient à
la date choisie).

**Les cartes**, chacune tirée de ce qui est déjà en base :

| Carte | Bouton principal | À partir de |
|---|---|---|
| Devis à valider, avec ses points à vérifier (module S) | Validé / À modifier | étape 1 |
| Devis validé à envoyer | Envoyer (mail et PDF) | étape 2 ; avant : ouvrir dans la messagerie |
| Devis sans réponse | Relancer | étape 2 |
| Devis signé : la suite (acompte, commande, dates) | voir module N | étape 3 |
| Facture à émettre et envoyer (acompte, échéance, solde) | Émettre et envoyer | étape 2 |
| Paiement en retard | Relancer / Marquer reçu | étape 1 pour « reçu », étape 2 pour la relance |
| Commande à passer, ou sans accusé de réception | Envoyer / Relancer (module G) | étape 3 |
| Demande sans réponse, rappel prévu, panne | Appeler / Faire un devis / Prendre rendez-vous | étape 1 ; rendez-vous à l'étape 6 |
| Demande du terrain (à facturer, SAV, nouveau devis) | Facturer / Planifier / Faire le devis | étape 1 |
| Intervention sans date ni personne | Planifier | étape 1 |
| Heures à valider, achat à rapprocher | Valider / Rapprocher | étape 1 |
| Document périmé (sous-traitant, attestation de capacité) | Demander le document | étape 2 |
| Entretien à planifier (contrats, machines) | Planifier / Prévenir le client | étape 1 |

**En base.** Les cartes se calculent depuis les données, comme les alertes de
la cloche aujourd'hui, avec la même clé stable par objet et par date. S'y
ajoute ce que Fabrice en a fait — rangé, reporté jusqu'au…, action lancée —
et, pour chaque action, sa trace (`action_proposee`, module P). La cloche
reste la vue « tout » ; la file devient la vue « à faire ».

Le **chef de chantier** a sa file (heures à valider, interventions à planifier,
demandes du terrain). Le **technicien** garde Ma journée.

### Module N — La chaîne après signature

Le cœur de « il ne veut pas réfléchir ». Chaque étape crée la carte suivante
dans la file, au bon moment, prête à un toucher. Celles que Fabrice aura
passées en automatique (décision D2) se font seules et le disent.

1. **Signature** (F4) : chantier, machines, matériel à commander,
   interventions à planifier, échéancier, facture d'acompte en brouillon — ce
   que fait déjà `signerDevis`, côté serveur, une seule fois.
2. **Acompte** : carte « Émettre et envoyer la facture d'acompte », avec le
   moyen de paiement (décision D7). Hors établissement, aucun paiement avant
   sept jours : la carte n'arrive qu'à la date déjà calculée
   (`encaissement_autorise_le`).
3. **Commande de matériel** : à la réception de l'acompte, ou dès la signature
   (question 5), carte « Commander » : un bon par fournisseur, tiré de la liste
   « À commander ». C'est le module G (phase 4), qui s'y branche.
4. **Affectation** : carte « Planifier la pose » — à l'étape 3, une date et une
   personne à choisir ; avec le planning (étape 6), un créneau proposé : équipe
   libre, matériel livré avant, délai de rétractation passé (§ 7). Puis le
   technicien prévenu (F1, F5) et le client informé de la date.
5. **Matériel livré** (achats rapprochés, livraison cochée) : si l'échéancier
   prévoit un appel à la livraison — sa « réception du paiement de
   matériaux », question 2 —, carte « Émettre la facture d'échéance ».
6. **Fin de chantier** : PV de réception (existe), fiches fluides (phase 1),
   attestation de TVA si la règle l'exige encore (§ 7), et la **facture de
   solde préparée** : total du devis moins les acomptes et situations émis,
   **lus en base**. Aujourd'hui, l'acompte déjà facturé se retape dans le
   brouillon de solde, ce que la règle 3 interdit : `factureDepuisDevis` sait
   le déduire, mais aucun écran ne lui passe la somme, qui vaut donc zéro.
   Carte « Émettre et envoyer le solde », PV et Cerfa joints.
7. **Relances** : échéance dépassée, carte « Relancer », texte prêt, avec un
   ton pour le particulier et un autre pour le professionnel (§ 7). Délais
   réglables.
8. **Après** : à la mise en service, proposer le contrat d'entretien
   (SQL 37).

Chaque passage s'écrit au journal du chantier (« Acompte émis et envoyé le
… »), comme la signature aujourd'hui.

### Module O — La signature du client, à distance

Sans elle, la chaîne attend que Fabrice clique sur « Signé ».

Le mail du devis porte un lien vers une page sans connexion, ouverte par un
jeton imprévisible (comme les webhooks) : le devis, les conditions, le droit
de rétractation, la case de demande expresse de commencer avant la fin du
délai (§ 7), une signature au doigt. On garde la preuve : date, heure,
adresse IP, empreinte du document signé, e-mail ou téléphone vérifié. La
signature déclenche F4. La page ne montre que ce devis : une fonction
`security definer` qui ne rend que le document lié au jeton.

À choisir (D6) : cette signature électronique simple, ou un prestataire.

### Module P — Le point du matin, à la voix

1. **Avant 7 h** (F3) : la file M se calcule, et l'IA en écrit le résumé en
   cinq lignes (« 3 urgences : … »), prêt à l'ouverture.
2. **L'écran** : le résumé en tête, la file dessous, le rouge d'abord, et un
   gros micro.
3. **La conversation** : Fabrice parle ; chaque phrase devient une réponse ou
   une **action proposée** — une carte pré-remplie : le mail tel qu'il
   partira, la facture telle qu'elle sera émise, l'intervention avec sa date
   et son technicien. L'IA choisit dans une **liste fermée d'actions** —
   émettre et envoyer une facture, relancer un client, répondre à un client,
   relancer un fournisseur, planifier, créer une tâche, noter, marquer un
   paiement reçu, préparer un devis, ranger ou reporter une carte —, comme la
   passerelle n'accepte aujourd'hui que des tâches déclarées.
4. **« Celui-là »** : chaque phrase part avec la page ouverte et la carte
   sélectionnée. Aujourd'hui, l'assistant ne sait pas ce qui est à l'écran.
5. **Ouvert pendant qu'il consulte le reste** : la bulle reste montée d'une
   page à l'autre — elle l'est déjà ; elle se réduit en bandeau, micro
   allumé. La reconnaissance vocale de Safari s'arrête après un silence :
   relance automatique ou bouton maintenu, à éprouver sur son iPhone.
6. **« Tu refermes et le logiciel met tout à jour »** : en fermant, la liste
   des actions proposées — « Tout valider », une par une, ou annuler. Puis
   Batinium les exécute — son code, avec les droits de Fabrice, pas l'IA — et
   écrit le compte rendu : « 6 faites, 1 bloquée : e-mail du client
   manquant ».
7. **Lecture à voix haute** du résumé et des réponses par le navigateur, sans
   coût : pour la voiture.

**En base** : `action_proposee` — type, cible, contenu exact, proposée par
(IA ou règle), statut (proposée, validée, exécutée, échouée, annulée), qui a
validé, quand. C'est la trace de ce qui a été décidé et fait.

Une **première version** peut arriver dès l'étape 1, limitée aux actions qui
n'envoient rien : noter, créer une tâche, planifier, marquer un paiement reçu,
ranger ou reporter une carte, préparer un brouillon de devis.

### Module Q — Les vues du terrain

**Q1. Le sous-traitant — d'abord pour la sécurité.** Aujourd'hui la base lui
ouvre tous les clients, toutes les demandes et tous les chantiers ; seuls les
prix lui sont cachés. Il ne doit recevoir — par la RLS, pas par l'écran
(règle 4) — que ses interventions, leur chantier et leur site (adresse,
accès, contact sur place), la fiche de pose de ces chantiers (déjà sans prix)
et leur journal. Plus de liste de clients, de demandes, de devis ni de
factures. Son menu : Ma journée, Mes chantiers, Mes documents. Le mode
démonstration (SQL 38) permet de l'éprouver avec ses vrais droits.

**Q2. La vue devis du technicien.** La fiche de pose enrichie : par pièce
(module R), ce qui va où, quantités, références, notes du devis destinées à
la pose, photos de la visite. Sans prix d'achat ni marge ; les prix de vente
selon la réponse de Fabrice (question 1).

**Q3. La fiche d'intervention** (« tel jour, telle heure, tel endroit ») :
c'est l'ordre d'intervention du module F (phase 3) — code d'accès à part,
historique depuis la première demande, version imprimable —, plus **l'heure**.
Une intervention n'a qu'une date prévue ; `debut_le` et `fin_le` servent au
temps réalisé. Il faut un créneau : heure de début et durée.

### Module R — Les pièces du chantier

Ses notes et son artifact raisonnent par pièce : « chambre des enfants »,
« salon de 51,8 m² », « option chambre d'amis ». Aujourd'hui, une pièce n'est
qu'un texte libre (`emplacement`) sur la ligne de devis et sur la machine.

- Par site, des **pièces** : nom, surface, étage, ancien équipement.
- La ligne de devis, la machine, la fiche de pose et la fiche fluides
  pointent la pièce au lieu de la recopier (règle 3).
- La fiche de pose et la vue devis se lisent pièce par pièce ; le devis peut
  s'imprimer par pièce, options comprises.
- La puissance posée dans une pièce se rapproche de sa surface (module S).
- Les pièces se saisissent à la visite, dictées (« salon, 51,8 m² »), ou se
  tirent du devis dicté.

Les `emplacement` existants restent lisibles ; les nouvelles lignes pointent
une pièce.

### Module S — La relecture des devis avant validation

Les « points à vérifier » de l'artifact de Fabrice, sur chaque carte « Devis à
valider ».

- **Par règles**, sans IA, dès l'étape 1 : client sans e-mail ni téléphone,
  pas de site, ligne sans prix de catalogue ou au prix estimé, marge sous un
  seuil réglable, taux de TVA forcé sans justification, option hors total,
  devis qui expire.
- **Par l'IA**, à l'étape 5 : relecture du devis avec ses pièces et
  l'historique du site — puissance au regard de la surface, ancien appareil
  plus puissant, pièce sans unité, pièce jointe attendue (un rapport
  d'expert) —, en deux à cinq phrases simples. Une tâche de plus dans la
  passerelle.

Fabrice peut valider malgré un point : il décide, la carte l'informe.

### Module T — La prise de rendez-vous

La première étape de sa chaîne, et les « rendez-vous » prévus avec la phase 5.
Depuis une demande, « Prendre rendez-vous » propose trois créneaux (planning,
agenda Google, trajet). Un toucher crée la visite, l'inscrit dans l'agenda,
envoie la confirmation au client — date, heure, adresse, nom du technicien —,
puis le rappel la veille (F3).

### Module U — Le suivi client et les relances

- La fiche client se lit d'un seul fil : appels, e-mails, devis, factures,
  interventions, notes, photos. L'essentiel existe ; il manque les mails
  envoyés et reçus.
- Les relances deviennent des cartes, texte prêt : devis sans réponse (J+7,
  J+14, puis « abandonné ? »), paiements, documents de vigilance des
  sous-traitants, entretien annuel à proposer au client (SQL 37).
- Chaque type de relance peut passer en automatique (D2).

---

## 5. Ordre de réalisation

Chaque étape est livrable et utile seule. Les phases du plan précédent s'y
insèrent ; la phase 2 (carnets fluides) et les phases 6 et 7 (consultations,
Pennylane, Dropbox) gardent leur place.

**Étape 0 — Finir ce qui est en cours.** Exécuter les SQL 34 à 38, puis le 39
une fois Supabase passé en Pro. Corriger la phase 1 (`REVUE-PHASE-1.md`),
puis exécuter 32 et 33. Configurer Google avec l'autorisation longue
(`GOOGLE.md`) : l'étape 2 en dépend. Décider de la bascule de Tolteck vers
Batinium pour les devis (D3) et importer les brouillons en cours.

**Étape 1 — La file « À décider » et les droits des sous-traitants** (M, S par
règles, Q1, première version de P). Sans nouvelle infrastructure.
*Fabrice voit* : en ouvrant Batinium, ce qu'il a à décider, le rouge
d'abord, de gros boutons et des compteurs ; les sous-traitants ne voient plus
que leurs chantiers.

**Étape 2 — Les fondations et la signature à distance** (F1 à F4, O).
*Fabrice voit* : « Envoyer » envoie pour de vrai, mail exact et PDF joint ;
le client signe depuis son téléphone ; une signature déclenche la suite,
même la nuit.

**Étape 3 — La chaîne après signature** (N, relances de U, et la phase 4 :
bons de commande, module G).
*Fabrice voit* : après une signature, les cartes arrivent seules dans
l'ordre — acompte, commande, planification, échéance, solde, relances —, un
toucher chacune, ou aucun pour celles qu'il a passées en automatique.

**Étape 4 — Le point du matin à la voix** (P complet). Dépend des étapes 1 à
3 : il faut des actions à proposer.
*Fabrice voit* : il parle, Batinium propose, il valide, tout se fait.

**Étape 5 — Le terrain** (Q2, Q3 — c'est la phase 3 —, R, S par l'IA, F5).
*Fabrice voit* : l'ordre d'intervention complet, avec l'heure, sur le
téléphone du technicien ; le devis pièce par pièce ; des points à vérifier
plus fins.

**Étape 6 — Rendez-vous et planning** (T, et la phase 5 : planning d'équipe,
module J).
*Fabrice voit* : une demande devient un rendez-vous en un toucher et le
client reçoit sa confirmation ; le planning propose les créneaux de pose.

---

## 6. Décisions à prendre avant de coder

**D1 — L'IA propose, Fabrice valide.** Fabrice veut que « le logiciel mette
tout à jour ». La règle actuelle (`CLAUDE.md`) : l'assistant n'écrit que des
notes et des brouillons de devis, jamais envoyés, signés ni facturés.
Proposition : l'IA *propose* des actions prises dans une liste fermée ; rien
ne part, ne se signe ni ne se facture sans un toucher de la direction sur
l'action exacte — le mail tel qu'il partira, la facture telle qu'elle sera
émise ; Batinium exécute, pas l'IA ; tout est tracé. C'est le principe même de
son artifact (« Envoyer ce mail vaut votre accord »). À valider, puis à écrire
dans `CLAUDE.md`.

**D2 — Un toucher ou automatique, étape par étape.** Recommandation : un
toucher par défaut ; dans Entreprise, un interrupteur « automatique » par type
— relance de devis, relance de paiement, envoi de l'acompte, commande — à
allumer quand il a confiance. Jamais d'automatique avant les dates légales
(§ 7).

**D3 — Les devis se font dans Batinium.** Quand Fabrice quitte-t-il Tolteck ?
Sans cette bascule, rien de ce plan ne se déclenche pour ses devis.

**D4 — Le canal d'envoi** : son Gmail (recommandé pour Pilotech) ou un
service d'envoi au domaine de l'entreprise (indispensable à la revente).

**D5 — Les PDF** : rendu côté serveur, ou génération au moment du toucher
(F2).

**D6 — La signature à distance** : signature électronique simple faite dans
Batinium, ou prestataire (Yousign, par exemple), payant et plus probant.

**D7 — Le paiement de l'acompte** : virement (RIB, référence, QR code), ou
lien de paiement par carte, avec des frais à chaque paiement.

---

## 7. Ce que la loi impose — à ne pas rater

- **Contrat hors établissement** : aucun paiement avant sept jours
  (`encaissement_autorise_le`, déjà calculé). L'envoi automatique de
  l'acompte attend cette date.
- **Rétractation de quatorze jours** (hors établissement et à distance) : les
  travaux ne commencent pas avant la fin du délai, sauf demande expresse du
  client sur un support durable. La planification proposée (N4) respecte
  `retractation_fin_le`, et la demande expresse s'enregistre à la signature
  (module O).
- **Factures d'acompte, de situation, de solde** : mentions d'une facture
  ordinaire, numérotation continue, immuabilité (SQL 20). Le solde déduit ce
  qui a été facturé, pas ce qui a été encaissé. La TVA sur les acomptes est à
  confirmer avec l'expert-comptable.
- **TVA à taux réduit (5,5 et 10 %)** : selon nos informations, la loi de
  finances pour 2025 a remplacé l'attestation (formulaires 1300-SD et
  1301-SD) par une mention portée sur le devis ou la facture et certifiée par
  le client. À confirmer avec l'expert-comptable avant d'en faire un
  document : si c'est le cas, « l'attestation TVA » de la chaîne devient une
  mention et une case à la signature (module O), pas un formulaire de plus.
- **Facturation électronique** : depuis le 1er septembre 2026, toute
  entreprise doit pouvoir recevoir des factures électroniques ; au 1er
  septembre 2027, Pilotech devra émettre ses factures aux professionnels par
  une plateforme agréée et transmettre les données de ses ventes aux
  particuliers (e-reporting). Des factures émises automatiquement devront y
  partir : Pennylane (module K) prend de l'importance. Calendrier à
  confirmer avec l'expert-comptable.
- **Relances de paiement** : pénalités de retard et indemnité forfaitaire de
  40 € entre professionnels seulement ; avec un particulier, une relance
  courtoise et les pénalités prévues aux conditions générales. Deux modèles de
  texte.
- **Signature électronique** : une signature simple vaut pour un devis si l'on
  peut prouver qui a signé quoi et quand (date, IP, empreinte du document,
  e-mail ou téléphone vérifié).
- **La voix** : Batinium ne garde aucun enregistrement — le navigateur
  transcrit, seul le texte part. Il passe par la passerelle IA et s'efface au
  bout de trente jours (journal IA), comme aujourd'hui.
- **Les sous-traitants** : ne leur ouvrir que ce dont ils ont besoin, c'est
  aussi la minimisation qu'exige le RGPD.

---

## 8. L'IA : ce qu'elle reçoit, quel modèle, combien

- **Elle reçoit du texte.** La voix est transcrite par le navigateur, sans
  coût, comme la dictée actuelle ; seul le texte part vers la passerelle.
- **Elle ne fait que proposer** (D1) : chaque action est un outil déclaré dans
  la passerelle, que l'IA remplit ; Batinium l'exécute après le toucher.
- **Le modèle.** La passerelle appelle `claude-sonnet-4-6` (réglable par la
  variable `IA_MODELE`). Pour l'assistant qui propose des actions, passer au
  modèle actuel, `claude-opus-5-5` (4 $ le million de jetons lus, 20 $ le
  million écrits, 0,20 $ le million relu en cache). Ce qui change en passant :
  pas de choix d'outil imposé (`tool_choice` « any » ou « tool » refusés — on
  nomme l'outil dans la consigne et on rend les schémas stricts), réflexion
  toujours active (réglée par `effort`), pas de début de réponse pré-rempli.
- **Le cache.** Le contexte métier — la file, les clients, les devis en
  cours — pèse de l'ordre de 30 000 jetons et change peu pendant une réunion.
  Mis en cache, il coûte vingt fois moins à chaque échange. La passerelle n'en
  fait pas encore.
- **L'ordre de grandeur.** Une réunion du matin de dix échanges : environ
  0,50 $ avec le cache, environ 1,50 $ sans. Une vingtaine de réunions par
  mois et l'usage de la journée : de l'ordre de 10 à 30 € par mois.
- **Le plafond** se compte aujourd'hui en jetons, sans distinguer leur prix :
  2 millions par mois. Sans cache, une réunion en consomme environ 300 000 ;
  le plafond en tiendrait sept. Avec le cache, il faudra aussi compter les
  jetons relus, que la passerelle n'enregistre pas encore. Le plus simple :
  compter en euros, au prix de chaque catégorie de jetons, et fixer le
  plafond avec Fabrice — c'est lui qui paie.

---

## 9. Questions à poser à Fabrice

1. **Vue devis des techniciens** : le devis sans aucun prix (comme la fiche de
   pose), avec les prix de vente, ou pour qu'ils fassent eux-mêmes des devis
   sur place ?
2. **« Réception du paiement de matériaux »** : un appel de fonds à la
   livraison du matériel ? Son échéancier habituel (30 / 70 ? 30 / 40 / 30 ?) ?
3. **« Cerfa » dans la chaîne** : la fiche fluides, le formulaire de TVA, ou
   les deux ?
4. **La facture d'acompte** : émise et envoyée seule (après sept jours hors
   établissement), ou un toucher ?
5. **La commande de matériel** : dès la signature, ou à la réception de
   l'acompte ?
6. **Tolteck** : quand bascule-t-il ? Combien de brouillons en cours à
   reprendre ?
7. **Le point du matin** : à quelle heure, sur quel appareil (bureau,
   téléphone en voiture), lu à voix haute ou non ?
8. **Les sous-traitants** : que doivent-ils voir — adresse, code d'accès,
   contact sur place, photos, plans ? Déclarent-ils leurs heures, leurs
   factures ?
9. **« Emplacements des chantiers (chambres… »** : la note est coupée. Quoi
   d'autre : surface, étage, orientation, ancien équipement ?
10. **Les relances** : à combien de jours, par e-mail ou par SMS, signées de
    qui ?
11. **Plusieurs TVA dans le même devis** : c'est déjà possible dans Batinium.
    Qu'est-ce qui coinçait ?
12. **Le paiement en ligne de l'acompte** : le souhaite-t-il, avec les frais ?

S'ajoutent aux questions ouvertes de `ETAT-DU-PROJET.md` (§ 5), toujours sans
réponse.
