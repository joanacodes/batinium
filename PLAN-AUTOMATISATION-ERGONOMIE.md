# Batinium — Plan : après la signature, tout s'enchaîne

Établi le 27 octobre 2026, à partir de : les deux pages de notes de Fabrice
(« Batinium Pilotech Notes »), ses deux messages du matin sur l'assistant à
la voix, et la capture de son artifact « Devis à valider » du 15 octobre, où
il relit ses brouillons Tolteck avec Claude. Mis à jour le 3 novembre avec
ses réponses (§ 9) et une demande nouvelle : régler lui-même qui a accès à
quoi (module V).

Ce document complète `PLAN-FLUIDES-COMMANDES-PLANNING.md` (modules A à L,
phases 1 à 7) sans le remplacer : ses modules sont repris là où la chaîne en
a besoin, et les nouveaux continuent la lettre (M à W). Comme lui, il dit quoi
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
- *les accès* (message du 3 novembre) : une version sous-traitant, sur
  téléphone comme sur ordinateur, « comme l'interface technicien » puisqu'ils
  font aussi du SAV, et « le moyen de gérer les accès, qui a accès à quoi »,
  réglé sur l'ordinateur par menus déroulants — « la demande de documents,
  l'endroit où il doit poser ses documents ».

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
| Vue devis des techniciens | Fiche de pose : le devis sans aucun prix, garanti par la base (`v_fiche_pose`) | Faire le devis sur place, sans prix, et l'envoyer au gérant (Q2) ; la base laisse aujourd'hui un technicien lire les prix du catalogue |
| Sous-traitants | Un rôle à part, sans prix ; le mode démonstration montre son écran | La base leur ouvre tous les clients, demandes et chantiers ; leur menu est celui d'un technicien |
| Qui a accès à quoi | Quatre rôles fixes ; les prix réservés à la direction et aux chefs de chantier (`voit_les_prix()`) | Rien ne se règle : les droits sont écrits dans les scripts SQL |
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
jointes, et c'est le clic sur « Envoyer ce mail » qui vaut accord.
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
dans la file, au bon moment, prête à un clic. Celles que Fabrice aura
passées en automatique (décision D2) se font seules et le disent.

1. **Signature** (F4) : chantier, machines, matériel à commander,
   interventions à planifier, échéancier, facture d'acompte en brouillon — ce
   que fait déjà `signerDevis`, côté serveur, une seule fois.
2. **Acompte** : la facture d'acompte se prépare, avec l'IBAN et la référence
   à rappeler (virement seulement, D7). Par défaut, carte « Émettre et envoyer
   la facture d'acompte » ; envoi tout seul si Fabrice l'a réglé ainsi
   (réglages ci-dessous). Hors établissement, aucun paiement avant sept jours :
   ni la carte ni l'envoi tout seul n'arrivent avant la date déjà calculée
   (`encaissement_autorise_le`).
3. **Commande de matériel** : dès la signature ou à la réception de
   l'acompte, selon le réglage ; carte « Commander » par défaut, envoi tout
   seul si Fabrice l'a réglé ainsi. Un bon par fournisseur, tiré de la liste
   « À commander », avec en référence **le nom de la rue et le nom du client**
   — c'est désormais le numéro du chantier (SQL 40) ; le plan précédent
   prévoyait `BC-AAAAMMJJ-NNNN`.
   C'est le module G (phase 4), qui s'y branche.
4. **Affectation** : carte « Planifier la pose » — à l'étape 3, une date et une
   personne à choisir ; avec le planning (étape 6), un créneau proposé : équipe
   libre, matériel livré avant, délai de rétractation passé (§ 7). Puis le
   technicien prévenu (F1, F5) et le client informé de la date.
5. **Matériel livré** (achats rapprochés, livraison cochée) : si l'échéancier
   du devis prévoit un paiement à la livraison — sa « réception du paiement de
   matériaux » —, carte « Émettre la facture d'échéance ». L'échéancier reste
   au choix de l'utilisateur, devis par devis (réponse de Fabrice) :
   Entreprise en propose des modèles (30 / 70, 30 / 40 / 30…), dont une étape
   « à la livraison du matériel ».
6. **Fin de chantier** : PV de réception (existe), fiches fluides (phase 1),
   attestation de TVA si la règle l'exige encore (§ 7), et la **facture de
   solde préparée** : total du devis moins les acomptes et situations émis,
   **lus en base**. Aujourd'hui, l'acompte déjà facturé se retape dans le
   brouillon de solde, ce que la règle 3 interdit : `factureDepuisDevis` sait
   le déduire, mais aucun écran ne lui passe la somme, qui vaut donc zéro.
   Carte « Émettre et envoyer le solde », PV et Cerfa joints.
7. **Relances** : échéance dépassée, carte « Relancer », texte prêt, avec un
   ton pour le particulier et un autre pour le professionnel (§ 7). Elles
   partent à la main (module U).
8. **Après** : à la mise en service, proposer le contrat d'entretien
   (SQL 37).

Chaque passage s'écrit au journal du chantier (« Acompte émis et envoyé le
… »), comme la signature aujourd'hui.

**Les réglages** (Entreprise → Automatisation). Fabrice l'a dit pour chacun :
« laisse l'utilisateur décider ». Les valeurs par défaut sont les plus
prudentes, et se changent d'un menu :

| Réglage | Choix | Par défaut |
|---|---|---|
| Facture d'acompte | Validée d'un clic, ou envoyée toute seule | D'un clic (réponse de Fabrice) |
| Commande de matériel : quand | Dès la signature, ou à la réception de l'acompte | À la réception de l'acompte |
| Commande de matériel : envoi | Validé d'un clic, ou tout seul | D'un clic |
| Échéancier | Modèles (30 / 70, 30 / 40 / 30…), modifiable devis par devis | Celui d'Entreprise |
| Relances | Toujours à la main, par e-mail, envoi programmable | — (réponse de Fabrice) |
| Rappel des relances au gérant | Jour et heure | Le lundi à 8 h |
| Factures des sous-traitants | Reçues par e-mail, ou déposées dans Batinium | Par e-mail |
| Point du matin | Heure, lecture à voix haute | 7 h, sans lecture |

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

1. **À l'heure que chacun choisit** (F3) : la file M se calcule, et l'IA en
   écrit le résumé en cinq lignes (« 3 urgences : … »), prêt à l'ouverture,
   sur l'ordinateur comme sur le téléphone (réponse de Fabrice : toutes les
   options).
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
7. **Lecture à voix haute**, au choix de chacun, du résumé et des réponses par
   le navigateur, sans coût : pour la voiture.

**En base** : `action_proposee` — type, cible, contenu exact, proposée par
(IA ou règle), statut (proposée, validée, exécutée, échouée, annulée), qui a
validé, quand. C'est la trace de ce qui a été décidé et fait.

Une **première version** peut arriver dès l'étape 1, limitée aux actions qui
n'envoient rien : noter, créer une tâche, planifier, marquer un paiement reçu,
ranger ou reporter une carte, préparer un brouillon de devis.

### Module Q — Les vues du terrain

**Q1. Le sous-traitant.** Il fait aussi du SAV : son écran est celui du
technicien, sur téléphone comme sur ordinateur. Sur ses chantiers, il voit
tout ce que voit un salarié — adresse, code d'accès, contact sur place,
photos, plans, fiche de pose, journal — sans aucun prix (règle 8). Une
différence, par défaut : il ne déclare pas d'heures, puisqu'il travaille au
projet et non à l'heure ; une option, sous-traitant par sous-traitant, les lui
ouvre. Il reçoit les demandes de documents (vigilance) et sait où les déposer.
Ses factures arrivent par e-mail ou se déposent dans Batinium, au choix de
Fabrice (réglages du module N) ; déposées, elles se rattachent au chantier et
au paiement d'équipe — le coût d'un sous-traitant ne va jamais en dépense
(SQL 12).
Son menu : Ma journée, Mes chantiers, Mes documents, et Mes heures si
l'option est ouverte.

Aujourd'hui, la base lui ouvre tous les clients, toutes les demandes et tous
les chantiers ; seuls les prix lui sont cachés. Il ne doit recevoir — par la
RLS, pas par l'écran (règle 4) — que ses interventions, leur chantier et leur
site. C'est la première application du module V ; le mode démonstration
(SQL 38) permet de l'éprouver avec ses vrais droits.

**Q2. Le devis fait sur place, sans prix.** Réponse de Fabrice : les
techniciens font le devis sur place, sans voir aucun prix ; il part chez le
gérant, qui voit les prix, ajuste et l'envoie. Sur place, le technicien relève
les pièces (module R), choisit appareils et accessoires dans un catalogue sans
prix, dicte ce qu'il faut, prend les photos. En validant, un brouillon arrive
dans la file du gérant (« Devis à valider », module M) : les prix, la TVA et
la marge s'y posent en base, depuis le catalogue, et ne redescendent jamais
vers le technicien (règle 4).

Deux trous à boucher pour cela : la base laisse aujourd'hui un technicien lire
le catalogue avec ses prix (`produit`, SQL 01) — il faut une vue du catalogue
sans prix, comme `v_fiche_pose` pour les devis ; et le devis dicté rassemble
le catalogue, prix compris, dans le navigateur — sa version terrain ne doit
voir que les références.

Une fois le devis signé, le technicien le retrouve en fiche de pose, pièce par
pièce, toujours sans prix.

**Q3. La fiche d'intervention** (« tel jour, telle heure, tel endroit ») :
c'est l'ordre d'intervention du module F (phase 3) — code d'accès à part,
historique depuis la première demande, version imprimable —, plus **l'heure**.
Une intervention n'a qu'une date prévue ; `debut_le` et `fin_le` servent au
temps réalisé. Il faut un créneau : heure de début et durée.

### Module R — Les pièces du chantier

Ses notes et son artifact raisonnent par pièce : « chambre des enfants »,
« salon de 51,8 m² », « option chambre d'amis ». Aujourd'hui, une pièce n'est
qu'un texte libre (`emplacement`) sur la ligne de devis et sur la machine.

- Par site, des **pièces** : nom, surface, étage, orientation, ancien
  équipement (réponse de Fabrice : « oui, tout »).
- La ligne de devis, la machine, la fiche de pose et la fiche fluides
  pointent la pièce au lieu de la recopier (règle 3).
- La fiche de pose et la vue devis se lisent pièce par pièce ; le devis peut
  s'imprimer par pièce, options comprises.
- La puissance posée dans une pièce se rapproche de sa surface (module S).
- Les pièces se saisissent à la visite, par le technicien qui fait le devis
  sur place (Q2) : dictées (« salon, 51,8 m², plein sud »), ou tirées du devis
  dicté.

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
agenda Google, trajet). Un clic crée la visite, l'inscrit dans l'agenda,
envoie la confirmation au client — date, heure, adresse, nom du technicien —,
puis le rappel la veille (F3).

### Module U — Le suivi client et les relances

- La fiche client se lit d'un seul fil : appels, e-mails, devis, factures,
  interventions, notes, photos. L'essentiel existe ; il manque les mails
  envoyés et reçus.
- Les relances deviennent des cartes, texte prêt : devis sans réponse,
  paiements, documents de vigilance des sous-traitants, entretien annuel à
  proposer au client (SQL 37).
- **Elles partent à la main**, jamais seules (réponse de Fabrice) : le gérant
  envoie la relance tout de suite, ou en programme l'envoi à une date et une
  heure (F3).
- **Un rappel au gérant une fois par semaine** : la liste des relances à
  faire, jour et heure réglables, dans la file et par e-mail.
- **Par e-mail** (réponse de Fabrice), depuis l'adresse de l'entreprise (F1),
  signées du gérant avec la signature de l'entreprise — réglable dans
  Entreprise.

### Module V — Qui a accès à quoi

Demande du 3 novembre : « qu'on puisse avoir le moyen de gérer les accès —
qui a accès à quoi — […] un vrai menu déroulant, sur l'ordinateur […] : le
sous-traitant a accès à ça, la demande de documents, l'endroit où il doit
poser ses documents ».

- **Un écran Équipe → Accès**, sur ordinateur : pour chaque rôle — et pour une
  personne, si elle fait exception —, une ligne par partie de Batinium (Ma
  journée, chantiers, journal et photos, heures, documents, clients,
  demandes, devis, factures, achats…) et un menu déroulant : aucun accès,
  lecture, lecture et écriture.
- **C'est la base qui applique ces réglages** (règle 4) : ils sont en base, et
  les politiques RLS les lisent par une fonction, comme elles lisent
  `voit_les_prix()` aujourd'hui. Un réglage qui ne changerait que le menu ne
  protégerait rien.
- **Des garde-fous que nul réglage ne lève** : aucun prix sur un écran de
  terrain (règle 8) ; un sous-traitant ne voit que ses chantiers ; la
  direction garde tout.
- **Les valeurs par défaut** sont celles des réponses de Fabrice : le
  sous-traitant comme un salarié sur ses chantiers, sans heures, avec ses
  documents à déposer (Q1).
- Le mode démonstration (SQL 38) vérifie un réglage avec les vrais droits du
  rôle.

### Module W — La bascule depuis Tolteck, automatisée

Demande du 3 novembre : « fais en sorte que ça soit automatisé » — Fabrice
donne un document, ou un accès à Tolteck s'il y a une API, et à partir de là
Batinium démarre.

- **Pas d'API publique connue** chez Tolteck, logiciel de Saint-Gobain
  Distribution Bâtiment France : ses seules intégrations documentées sont les
  fournisseurs Point.P et Cedeo, et l'outil de métré Solu+. Si son support en
  ouvre une, on s'y branche ; sinon, des fichiers. Lui demander l'export
  complet : clients, devis, factures, articles.
- **Un seul dépôt** : Fabrice dépose ce qu'il a — un export en tableur, ou
  simplement les PDF de ses devis — dans un écran « Reprendre mes données ».
  Batinium reconnaît chaque fichier : un tableur se lit par règles (l'import
  de devis le fait déjà pour le CSV), un PDF par l'IA (comme « Remplir le
  catalogue » le fait déjà pour les tarifs).
- **Ce qui se crée** : les clients et leurs adresses, sans doublon avec ceux
  déjà là ; les devis avec leurs numéros d'origine ; les articles du
  catalogue. Les quinze brouillons arrivent dans la file « Devis à valider »
  (module M), avec leurs points à vérifier (module S).
- **Rien ne s'écrit sans relecture** : l'écran montre ce qu'il a compris,
  fichier par fichier, et Fabrice valide d'un clic — la règle de l'import
  actuel : un import qui devine sans montrer ne se vérifie pas.
- **Puis Batinium démarre** : les numéros de devis et de factures reprennent
  la suite de ceux de Tolteck, sans trou ni doublon, et chaque devis signé
  déclenche la chaîne (module N).
- **Les factures déjà émises** dans Tolteck ne se réémettent pas : on en
  reprend la trace (numéro, client, montant, échéances non payées) et leurs
  PDF dans la bibliothèque. À récupérer avant toute résiliation de Tolteck :
  une facture se conserve dix ans.

---

## 5. Ordre de réalisation

Chaque étape est livrable et utile seule. Les phases du plan précédent s'y
insèrent ; la phase 2 (carnets fluides) et les phases 6 et 7 (consultations,
Pennylane, Dropbox) gardent leur place.

**Étape 0 — Finir ce qui est en cours.** Exécuter les SQL 34 à 38, puis le 39
une fois Supabase passé en Pro. Corriger la phase 1 (`REVUE-PHASE-1.md`),
puis exécuter 32 et 33. Configurer Google avec l'autorisation longue
(`GOOGLE.md`) : l'étape 2 en dépend. Demander à Tolteck l'export complet de
ses données (module W).

**Étape 1 — La file « À décider », les accès, les sous-traitants, la reprise
de Tolteck** (M, S par règles, V, Q1, W, première version de P). Sans
nouvelle infrastructure.
*Fabrice voit* : en ouvrant Batinium, ce qu'il a à décider, le rouge
d'abord, de gros boutons et des compteurs ; il règle depuis l'ordinateur qui a
accès à quoi ; les sous-traitants ne voient plus que leurs chantiers ; il
dépose ses données Tolteck, et ses quinze brouillons arrivent à valider.

**Étape 2 — Les fondations et la signature à distance** (F1 à F4, O).
*Fabrice voit* : « Envoyer » envoie pour de vrai, mail exact et PDF joint ;
le client signe depuis son téléphone ; une signature déclenche la suite,
même la nuit.

**Étape 3 — La chaîne après signature** (N, relances de U, et la phase 4 :
bons de commande, module G).
*Fabrice voit* : après une signature, les cartes arrivent seules dans
l'ordre — acompte, commande, planification, échéance, solde, relances —, un
clic chacune, ou aucun pour celles qu'il a passées en automatique.

**Étape 4 — Le point du matin à la voix** (P complet). Dépend des étapes 1 à
3 : il faut des actions à proposer.
*Fabrice voit* : il parle, Batinium propose, il valide, tout se fait.

**Étape 5 — Le terrain** (Q2, Q3 — c'est la phase 3 —, R, S par l'IA, F5).
*Fabrice voit* : ses techniciens font le devis sur place, sans prix, et il le
reçoit à valider ; l'ordre d'intervention complet, avec l'heure, sur leur
téléphone ; des points à vérifier plus fins. Le devis fait sur place (Q2, R)
peut passer plus tôt : il ne dépend que de la file (étape 1).

**Étape 6 — Rendez-vous et planning** (T, et la phase 5 : planning d'équipe,
module J).
*Fabrice voit* : une demande devient un rendez-vous en un clic et le
client reçoit sa confirmation ; le planning propose les créneaux de pose.

---

## 6. Décisions à prendre avant de coder

**D1 — L'IA propose, Fabrice valide : tranché le 3 novembre.** Fabrice veut
que « le logiciel mette tout à jour ». L'IA *propose* des actions prises dans
une liste fermée ; rien ne part, ne se signe ni ne se facture sans un clic de
la direction sur l'action exacte — le mail tel qu'il partira, la facture
telle qu'elle sera émise ; Batinium exécute, pas l'IA ; tout est tracé. C'est
le principe même de son artifact (« Envoyer ce mail vaut votre accord »). La
règle de `CLAUDE.md` est réécrite en ce sens.

**D2 — Un clic ou automatique : tranché.** Les relances partent toujours à
la main ; la facture d'acompte et la commande de matériel se règlent dans
Entreprise, d'un clic par défaut (réglages du module N). Jamais rien de tout
seul avant les dates légales (§ 7).

**D3 — Les devis se font dans Batinium : tranché.** La bascule est
automatisée (module W) : elle a lieu quand Fabrice dépose ses données
Tolteck, quinze brouillons compris. Sans elle, rien de ce plan ne se
déclenche pour ses devis.

**D4 — Le canal d'envoi** : son Gmail (recommandé pour Pilotech) ou un
service d'envoi au domaine de l'entreprise (indispensable à la revente).

**D5 — Les PDF** : rendu côté serveur, ou génération au moment du clic
(F2).

**D6 — La signature à distance** : signature électronique simple faite dans
Batinium, ou prestataire (Yousign, par exemple), payant et plus probant.

**D7 — Le paiement de l'acompte** : tranché, virement seulement pour
l'instant — l'IBAN et la référence à rappeler sur la facture. Le paiement par
carte attendra.

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
  la passerelle, que l'IA remplit ; Batinium l'exécute après le clic.
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

## 9. Questions à Fabrice — ses réponses du 3 novembre

| Question | Sa réponse | Dans le plan |
|---|---|---|
| Vue devis des techniciens | Sans prix. Ils font le devis sur place ; il part chez le gérant, qui voit les prix, puis l'envoie | Q2 |
| Paiement à la livraison du matériel, échéancier habituel | « Je ne sais pas, laisse l'utilisateur décider » | N5 : échéancier au choix, avec des modèles |
| Tolteck | Quinze brouillons à reprendre | D3, étape 0 |
| Point du matin : heure, appareil, lecture à voix haute | Toutes ces options | P |
| Sous-traitants : ce qu'ils voient, heures, factures | Tout comme les salariés, sauf les déclarations d'heures : ils travaillent au projet. Les heures en option | Q1, V |
| Emplacements des chantiers | Oui, tout : surface, étage, orientation, ancien équipement | R |
| Relances | À la main, par e-mail, envoi programmable, et un rappel au gérant une fois par semaine | U, D2 |
| Facture d'acompte : toute seule ou validée | « Laisse le décider dans les paramètres. Manuel par défaut. » | N2, réglages |
| Commande : dès la signature ou à l'acompte | « Laisse le décider dans les paramètres » | N3, réglages |
| Factures des sous-traitants | « Deux options : e-mail ou Batinium. Laisse le décider » | Q1, réglages |
| Paiement en ligne de l'acompte | IBAN seulement pour l'instant | D7 |
| Bons de commande (question ancienne) | Référence : nom de la rue + nom du client | N3 |
| Accès (demande nouvelle) | Régler qui a accès à quoi, sur ordinateur, par menus déroulants | V |
| Date de bascule Tolteck | « Fais en sorte que ça soit automatisé » : il fournit un document, ou un accès s'il y a une API | W |
| Numéro de chantier (demande nouvelle) | La rue du chantier et le nom du client, plus un numéro si la même personne a plusieurs chantiers | Codé le 3 novembre (SQL 40) |

**Plus aucune question ouverte** pour Fabrice sur ce plan, et la décision D1
est prise.

Deux questions du 27 octobre n'ont pas été posées : « Cerfa » dans la chaîne
(fiche fluides, formulaire de TVA, ou les deux) et « plusieurs TVA dans le
même devis », déjà possible dans Batinium. S'ajoutent les questions ouvertes
de `ETAT-DU-PROJET.md` (§ 5).

---

## 10. Ergonomie — l'état des lieux du 3 novembre, et la direction

Captures de seize écrans de la direction (ordinateur 1280 px, téléphone
390 px) et de la vue technicien, avec quelques mesures. Les données d'essai
sont minimes — un ou deux éléments par liste —, les vraies pages seront plus
longues.

| Écran | Ordinateur | Téléphone | Ce qui frappe |
|---|---|---|---|
| Accueil | 1 écran, aucune action principale | 2,5 écrans ; le premier n'est fait que de compteurs | Des listes à lire, pas des décisions |
| Fiche chantier | 1,9 écran, 10 sections, 13 boutons | 4 écrans | Tout sur une seule page |
| Entreprise (réglages) | 4,3 écrans, 49 champs, 780 mots | 8,7 écrans | Un seul formulaire géant |
| Éditeur de devis | 13 boutons, 18 champs | 3,5 écrans ; le premier n'est fait que de boutons | Quatre boutons de même poids en tête |
| Demandes | 11 boutons | Chaque carte commence par deux cases à cocher | L'essentiel (qui, quoi, rappeler) n'est pas en tête |
| Menu | 20 entrées pour la direction, 10 pour le terrain | Les mêmes, dans un tiroir | Trop pour « ne pas réfléchir » |
| Vue technicien | — | Ma journée est le meilleur écran | Mais il voit « Prononcer la réception », « Nouveau chantier », la planification |

**Les constats**

1. L'accueil montre des listes et des compteurs, pas des décisions.
2. Le menu est long, et le même pour tout le monde à quelques entrées près.
3. Pas d'action principale claire : souvent quatre boutons de même poids en
   tête d'écran, qui prennent tout le premier écran d'un téléphone.
4. Beaucoup de texte d'explication à l'écran (« La case Répondu est le cœur du
   suivi… », « Ce brouillon n'a pas de numéro… ») : utile à lire une fois,
   du bruit ensuite.
5. Des pages fleuves : la fiche chantier (dix sections) et Entreprise
   (quarante-neuf champs) tiennent chacune sur une seule page.
6. Le terrain voit des boutons de la direction. La base refusera peut-être
   l'action ; l'écran ne devrait pas la proposer.
7. Sur téléphone, les cartes tirées des tableaux ne commencent pas par
   l'essentiel.
8. Texte de base à 14 px, libellés et informations secondaires à 12 px en
   gris : lisible, mais petit pour un usage rapide.

**La direction** — celle de l'artifact de Fabrice, appliquée partout :

1. **Un accueil qui dit quoi faire** : la file « À décider » (module M), le
   rouge d'abord.
2. **Un menu court, par rôle.** Direction : Aujourd'hui, Demandes, Devis,
   Chantiers, Factures, Clients, et « Plus » pour le reste (Rentabilité,
   Dépenses, Achats, Catalogue, Équipe, Réglages…). Terrain : Ma journée, Mes
   chantiers, Mes documents, et Mes heures si l'accès est ouvert. Sur
   téléphone, une **barre d'onglets en bas**, sous le pouce, à la place du
   tiroir.
3. **Une seule action principale par écran**, toujours au même endroit : en
   haut à droite sur ordinateur, en bas de l'écran sur téléphone. Les autres
   dans un menu « ⋯ ». Plus de grand bouton « Retour » : le fil d'Ariane et le
   geste retour suffisent.
4. **Moins de texte** : les explications passent dans une bulle « ? » ; à
   l'écran ne reste que ce qui change une décision.
5. **Des pages découpées en onglets** : la fiche chantier (L'essentiel,
   Interventions, Matériel, Photos et journal, Documents) ; Entreprise
   (Société, Devis et factures, Numérotation, Automatisation, Accès, Équipe).
6. **Chacun ne voit que ses boutons** : les écrans suivent les accès du module
   V ; la base reste le vrai garde-fou (règle 4).
7. **Des cartes qui commencent par l'essentiel** : qui, quoi, combien, puis
   l'action ; le détail se déplie.
8. **Plus grand** : corps de texte et libellés agrandis, cibles de 44 px
   partout, pas seulement au doigt.

**Les références** (3 novembre) : l'artifact de Fabrice, et huit captures
d'applications retenues pour leur ergonomie. On n'en garde que l'ergonomie ;
l'apparence (couleurs, police, logo) viendra après.

| Ce qu'elles font | Ce que ça devient dans Batinium |
|---|---|
| Une barre d'onglets en bas, quatre ou cinq entrées, une action au centre | Direction : Aujourd'hui, Demandes, « + », Chantiers, Plus. Terrain : Ma journée, Mes chantiers, Mes documents, Mes heures |
| Un accueil qui salue, un chiffre clé, quelques actions | Aujourd'hui : la file « À décider » et ses compteurs. Ma journée : la grande carte de l'intervention en cours |
| Une action principale par écran, une discrète à côté | La prochaine étape de la chaîne en bas de la fiche chantier ; « Plus tard » et « Déjà traité » en simple texte |
| Des cartes qui se déplient, une frise d'étapes | Les points à vérifier, repliés ; les sept étapes du chantier, dont trois visibles |
| Une question à la fois, des réponses proposées, le fil des réponses | Le devis fait sur place : client, pièce, surface, orientation, existant, appareil, photo |
| Des pastilles de réponse rapide | Surfaces, orientations ; la suite d'une demande sur place (à facturer, SAV, nouveau devis) |
| Une feuille qui monte du bas : en cours, puis fait | Le mail exact avant l'envoi, puis « émise et envoyée » (D1) |
| Des onglets segmentés avec leur compte | Urgent, À décider, Chez le client, Fait aujourd'hui |

**Le dilemme « peu de clics, pas 4 000 informations »** : on montre la
décision, pas le dossier. Chaque écran dit d'abord quoi faire — une carte, un
bouton qui dit ce qui va se passer. Le reste existe, mais replié : les points
à vérifier, les étapes, les onglets de la fiche. Il s'ouvre d'un clic quand on
le demande. La voix sert de raccourci : dicter une pièce remplit quatre
questions, dire « relance Leroy » prépare la relance à valider.

**Les maquettes** : https://claude.ai/artifact/HT5FFCUr3Zt3PHDKSTUTQ5 (à
partager avec Fabrice depuis le menu Partager de la page). Sur téléphone :
Aujourd'hui, la fiche chantier, Ma journée, le devis fait sur place. Sur
ordinateur : Aujourd'hui et la fiche chantier. On peut cliquer dedans ; les
noms et montants sont inventés. Ce qu'elles mesurent :

| Geste | Clics |
|---|---|
| Envoyer l'acompte depuis l'accueil, sur téléphone | 2 (voir le mail, émettre et envoyer) |
| Le même, sur ordinateur | 1 (la carte et son mail sont déjà affichés) |
| Faire avancer le chantier (acompte, virement reçu, commande) | 1 par étape, 2 quand quelque chose part (le voir, puis l'envoyer) |
| Une pièce du devis fait sur place | 6 avec la dictée, 9 sans |
| Une demande sur place (à facturer, SAV, nouveau devis) | 3, plus ce qu'on dicte |

**Prochaine étape** : valider les maquettes avec Fabrice, puis coder
l'étape 1.
