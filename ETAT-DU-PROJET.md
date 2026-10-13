# Batinium — état du projet au 13 octobre 2026

Ce document dit ce qu'est l'application, pour qui, ce qu'elle fait, comment
elle est construite, et exactement où le travail s'est arrêté. Il accompagne
`CLAUDE.md`, qui donne les règles de travail.

---

## 1. Ce que c'est, et pour qui

**Batinium** est une application de gestion pour une petite entreprise
d'installation de climatisation et de pompes à chaleur. Elle a été construite
pour **Pilotech** — Fabrice Gibier, gérant, à Sucy-en-Brie (94) — et conçue
dès le départ pour être **revendue** à d'autres entreprises du bâtiment :
tout est cloisonné par entreprise, rien n'est propre à Pilotech en dur.

Les utilisateurs, par rôle (`membre.role`) :

| Rôle | Qui, chez Pilotech | Ce qu'il voit |
|---|---|---|
| `direction` | Fabrice | Tout, prix compris. Seul à régler, facturer, payer, anonymiser. |
| `chef_chantier` | Yann (responsable technique) | Prix compris, pas la paie. Surveille les chantiers. |
| `technicien` | Alex, Dominique, Martin | Ses chantiers, ses heures, la fiche de pose sans prix, Ma journée. |
| `sous_traitant` | Alexander, Yvan, Romain | Comme un technicien, sur ses interventions. |

La règle la plus importante de tout le projet : **un prix ne descend jamais
vers un technicien**, et c'est la base de données qui l'impose, pas l'écran.

Deux documents de référence du client sont dans le dépôt : son planning
d'équipe (`PLANNING LES SAMOURAIS`), son bon de commande type
(`BC-20260930-0063`), et ses trois PDF remplissables (fiche Cerfa des fluides,
carnet de mise en service, carnet des fluides) que l'application doit
remplacer.

---

## 2. Comment c'est construit

- **Front** : Vite + React 19 + TypeScript strict. Un routeur maison sur le
  hash (`#/section/id`). Un seul fichier CSS. Pas de framework d'interface,
  pas de bibliothèque de composants.
- **Base et serveur** : Supabase, projet `sryazbmnhgbtfjvyakgd`. Postgres avec
  **RLS sur toutes les tables**, vues `security definer` pour les agrégats,
  deux seaux de stockage privés (`documents`, `catalogue`), deux fonctions
  serveur en Deno : `ia` et `allo-webhook`.
- **Hébergement** : Vercel pour le front. Seules variables côté front :
  `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (la clé anonyme n'est pas un
  secret ; c'est la RLS qui protège).
- **Secrets serveur** : `ANTHROPIC_API_KEY` (secret Supabase, clé partagée
  pour toutes les entreprises), `IA_MODELE` facultatif. Par entreprise, en
  base dans `connecteur_secret` (table sans aucune politique de lecture) :
  `anthropic` (clé propre, facultative) et `allo_api`. Jetons de webhook dans
  `connecteur.jeton`.

### Les fonctions de base qui tiennent la sécurité

`mon_entreprise()`, `mon_role()`, `mon_membre()`, `voit_les_prix()` (vrai
pour direction et chef de chantier). Toute politique RLS et toute vue les
utilise. `prochain_numero(type)` numérote devis, factures, chantiers et fiches
fluides sans jamais reculer (compteur par entreprise, type et année).

### Les scripts SQL

Dossier `sql/`, numérotés, rejouables, autovérifiés. **Exécutés sur Supabase :
01 à 31.** Livrés mais **pas encore exécutés : 32 et 33** (phase 1).

| Script | Ce qu'il fait |
|---|---|
| 01–03 | Base multi-entreprises, rôles, tables principales, inscription |
| 04–11 | Charges fixes, dépenses, paiements d'équipe, encaissements, etc. — **jamais rangés dans `sql/`** (voir §6) |
| 12 | Catégorie certification, périodicité personnalisée, sous-traitance retirée des dépenses, produits en brouillon |
| 13 | Seau `documents` privé, bibliothèque, `paiement_equipe` |
| 14 | Rémunérations historisées, coefficient de charges |
| 15 | Bibliothèque unique (migration des documents de vigilance) |
| 16 | Préalables de chantier modifiables |
| 17 | Catalogue privé (photos), attestation de capacité |
| 18 | `v_fiche_pose` sans prix, avec garde-fou |
| 19 | Pointage, `v_cout_main_oeuvre` |
| 20 | Facturation : factures immuables, `emettre_facture()`, avoirs |
| 21 | Réglages de facturation, `journal_ia` |
| 22 | Approvisionnement (matériel à commander par chantier) |
| 23 | Correction des index pour le webhook Allô |
| 24 | Achats : factures fournisseurs, rapprochement, `v_cout_reel_chantier`, `v_ecart_achat` |
| 25 | RGPD : registre des effacements, `anonymiser_tiers()` |
| 26 | Anonymisation conditionnelle, `portee_effacement()` |
| 27 | Scan de facture fournisseur (`document.achat_id`) |
| 28 | Écart sur le dernier prix, unicité des factures fournisseurs |
| 29 | Le matériel de chantier passe par les achats (contrainte + reprise) |
| 30 | Connecteurs : jetons et secrets en base |
| 31 | IA partagée : plafond mensuel par entreprise, `consommation_ia()` |
| **32** | **Machines : référentiel des fluides, tonnage CO2, fréquence de contrôle, photo de plaque** — à exécuter |
| **33** | **Fiche fluides Cerfa : table, numérotation `FF-AAAA-NNNN`, autocontrôles, immuabilité, rectification** — à exécuter |

Fichiers d'essai : `essai_achats.sql` (jeu de factures fournisseurs, se
retire par `delete from achat where numero like 'ESSAI-%'`).

---

## 3. Ce que l'application fait aujourd'hui

Organisation du menu, et pour chaque entrée ce qui est en place.

### Pilotage

**Aujourd'hui** (`#/bord`) — tableau de bord : compteurs, demandes sans
réponse, alertes. La cloche en haut à droite regroupe toutes les alertes
(gravité urgent / attention / information), avec onglet « Tout » et tri par
date ; chaque alerte mène à l'écran où agir et peut être masquée durablement.

**Tâches** — liste simple avec échéances et priorités.

**Calendrier** — vue basique des interventions. À refaire (phase 5).

**Rentabilité** (`#/analytique`) — marge par affaire avec filtres de période,
charges fixes proratisées au jour, et la colonne **coût réel** : matériel
facturé (achats rapprochés) + heures pointées au taux du jour travaillé, avec
la dérive en pourcentage par rapport au déboursé prévu.

**Dépenses** — charges fixes (avec périodicité personnalisée) et dépenses
ponctuelles. Le matériel rattaché à un chantier y est **interdit** depuis le
SQL 29 : il passe par les achats, sinon il compterait deux fois.

**Achats** — factures fournisseurs saisies (en-tête + lignes, ou « ticket de
comptoir » en quatre champs), rapprochées **ligne à ligne** avec le matériel
prévu du chantier ; rapprocher coche la livraison. Contrôle de la somme des
lignes contre le total annoncé. Onglet **écarts de prix** : prix catalogue
contre dernier prix facturé, rouge au-delà de 3 %, bouton « Aligner ». Scan de
la facture en pièce jointe.

### Commerce

**Demandes** — chaque appel (Allô), formulaire web (Squarespace, Wix, lus par
règles puis par IA en secours) ou saisie manuelle devient une demande : nom,
coordonnées, besoin, transcription, enregistrement écoutable sur place
(relayé par le serveur, rien n'est stocké), urgence devinée, rattachement au
client par numéro. Fusion de deux demandes, statut, date de rappel, légende
des couleurs, rafraîchissement automatique. Un bouton **Faire un devis** avec
choix au survol : *à la voix* (dicté, chiffré depuis le catalogue) ou *à la
main*.

**Clients** (`#/clients`) — tiers (prospect, client, fournisseur,
sous-traitant), sites d'intervention (un client peut en avoir plusieurs),
historique, devis, chantiers, et depuis la phase 1 la liste de ses machines.

**Boîte mail** — lecture de Gmail depuis le navigateur, avec une
autorisation d'une heure. Création d'un prospect depuis un message, corps
complet lu pour les formulaires. **Pas de synchronisation** (voir §6).

**Devis** — éditeur complet : lots, zones, lignes depuis le catalogue ou
libres, moteur de TVA (taux justifié selon le site et l'ancienneté du
logement), gabarits, variantes, duplication, import de devis existants,
notes internes, envoi par la messagerie avec **caviardage** (relecture IA qui
signale un prix d'achat ou une note interne restés dans le message), et
signature avec `mode_conclusion` (à distance, en établissement, hors
établissement → rétractation). **Signer un devis enchaîne tout** : chantier,
matériel à commander, interventions à planifier, échéances d'encaissement,
facture d'acompte, et (phase 1) les machines.

**Factures** — numérotation continue attribuée à l'émission, **immuables**
après émission (déclencheur), acomptes, soldes, avoirs, mentions légales
réglables, impression.

**Import de devis** — reprise de devis depuis d'anciens fichiers.

### Terrain

**Chantiers** — fiche avec préalables cochables (jeux par métier,
modifiables), section « À commander et faire livrer » (approvisionnement),
interventions, journal avec photos et vidéos, PV de réception, et depuis la
phase 1 les sections **Machines** et **Fiches fluides**.

**Fiche de pose** (`#/pose/:id`) — le devis vu du poseur, **sans aucun prix**
(vue `v_fiche_pose`, garantie en base).

**Heures** (`#/heures`) — pointage par intervention, valorisé au taux de
rémunération du jour travaillé ; validation par la direction.

**Ma journée** — l'écran du technicien sur téléphone : ses interventions du
jour, itinéraire, « je commence / j'ai terminé », fiche de pose, journal, et
(phase 1) le bouton « Fiches fluides ». La direction peut y voir la « vue
technicien ».

**Journal** — toutes les notes de chantier.

**Équipe** — salariés (fiche avec documents RH, rémunérations historisées,
attestation d'aptitude fluides) et sous-traitants (documents de vigilance
avec échéances et alertes), paiements d'équipe. **Batinium ne calcule pas la
paie** (pas de bulletin, pas de déclaration).

### Réglages

**Catalogue** — produits avec famille, nature (fourniture, pose,
déplacement), prix d'achat et de vente, photos privées, brouillons relus
avant publication. **Remplir le catalogue** : dépôt d'un fichier — CSV lu par
règles sur place, PDF ou photo lus par l'IA — puis relecture.

**Connexions** — une carte par service, avec état constaté par un test réel :
Allô (adresse de webhook générée, deux formes d'URL, test, déclaration
automatique chez Allô par clé d'API), Assistant IA (clé partagée, jauge de
consommation mensuelle, clé propre possible), Google (bouton de connexion),
Pennylane et Dropbox marqués « bientôt ».

**Entreprise** — raison sociale, SIRET, TVA, assurances, médiateur,
attestation de capacité fluides (numéro, organisme, échéance, et depuis la
phase 1 la catégorie), coefficient de charges, acompte par défaut, délais et
mentions de paiement, logo, conditions générales.

**Données** — export complet en JSON (paginé, rien de tronqué) et table par
table en CSV (point-virgule + BOM pour Excel français), manifeste des
fichiers joints avec liens signés de trois semaines, **anonymisation RGPD**
conditionnelle avec registre des effacements, tableau de ce que Batinium
conserve et pourquoi, purge du journal IA.

### L'IA, partout

Une passerelle serveur (`supabase/functions/ia`) avec une **liste fermée de
tâches** : `assistant`, `catalogue`, `devis`, `formulaire`, `plaque`,
`resume_appel`, `caviardage`, `traduction`. La clé ne quitte jamais le
serveur ; chaque appel est journalisé avec son coût ; le contenu s'efface au
bout de trente jours ; un plafond mensuel par entreprise coupe l'IA sans
couper le reste de l'application.

L'**assistant en bulle** (en bas à droite, sur toutes les pages) lit les
données **avec les droits de la personne connectée** — c'est le navigateur
qui rassemble le contexte, donc un technicien n'obtient rien sur les devis —
et répond avec des liens vers les pages. Il n'écrit que des notes de chantier
ou de devis (signées « assistant ») et des brouillons de devis.

La **dictée** passe par le navigateur (gratuite, sans clé). Le **devis dicté**
envoie le catalogue avec la dictée : les références reconnues arrivent avec
leur prix, leur unité et leur TVA ; les autres restent à zéro.

### Connecteurs en place

- **Allô** (standard téléphonique) : déployé et **fonctionnel**. Webhook avec
  jeton en base, enveloppe `{topic, data}` déballée, seuls `call.completed`
  et `sms.received` retenus, dédoublonnage par `webhook-id`, appels sortants
  ignorés (à rediscuter avec Fabrice si la ligne est professionnelle),
  enregistrements relayés avec la clé d'API. La signature HMAC d'Allô n'est
  **pas** vérifiée.
- **IA** : fonction écrite et à jour (tâche `plaque` comprise). Déploiement à
  vérifier dans Connexions.
- **Google** : rien de configuré. `GOOGLE.md` décrit les six étapes.
- **Pennylane, Dropbox** : prévus, non commencés (OAuth2 à faire).

---

## 4. Documents du dépôt

| Fichier | Rôle |
|---|---|
| `CLAUDE.md` | Règles de travail, lues par Claude Code à chaque session |
| `ETAT-DU-PROJET.md` | Ce document |
| `INSTALLATION.md` | Installation des services extérieurs (stockage, IA, Allô, Google, hébergement) |
| `GOOGLE.md` | Configuration OAuth Google, pas à pas |
| `PLAN-FLUIDES-COMMANDES-PLANNING.md` | Cahier des charges des douze modules à venir, sept phases, points légaux, questions à Fabrice |
| `PROMPT-PHASE-1.md` … `PROMPT-PHASE-5.md` | Un prompt détaillé par phase |
| `INTEGRATION-PHASE-1.md` | Les dix modifications de fichiers existants pour brancher la phase 1 |

---

## 5. Où le travail s'est arrêté

### Phase 1 — livrée, à intégrer

Le registre des machines et la fiche Cerfa 15497*04 sont codés, compilés et
testés sur une base locale reconstituée depuis les scripts 01 à 21. Pas
encore sur Supabase.

**Fichiers nouveaux**, à déposer tels quels :

| Fichier | Dossier |
|---|---|
| `32_machines.sql`, `33_fiche_fluide.sql` | `sql/` |
| `machines.ts`, `fichesFluide.ts`, `alertesFluides.ts` | `src/lib/` |
| `Signature.tsx`, `Machines.tsx`, `FichesFluide.tsx` | `src/components/` |
| `FicheFluide.tsx` | `src/pages/` |
| `index.ts` (passerelle IA, avec la tâche `plaque`) | `supabase/functions/ia/` — remplace |

**Fichiers existants à retoucher** (dix, décrits dans
`INTEGRATION-PHASE-1.md`) : `types.ts`, `db.ts`, `ia.ts`, `alertes.ts`,
`App.tsx`, `FicheChantier.tsx`, `FicheClient.tsx`, `MaJournee.tsx`,
`Editeur.tsx`, `Parametres.tsx`.

Ce que fait la phase 1 : à la signature d'un devis, une machine par unité
vendue ; sur place, photo de la plaque et numéro de série (la plaque fait
foi, lecture IA en simple proposition) ; fiche Cerfa préremplie par la base,
sept autocontrôles visibles, signature au doigt du technicien (numéro
`FF-2026-0001`, fiche figée) puis du client, impression, fiche rectificative,
alertes (relevé en retard, signature client manquante, brouillon sur
intervention terminée, contrôle d'étanchéité à échéance).

**Pour tester** : signer un devis avec des machines → section Machines « à
relever » → fiche machine, photo, numéro → « vérifiée » → Fiche fluides →
autocontrôles au vert → signer → numéro → faire signer le client → imprimer
→ rectifier.

### Phases 2 à 5 — prompts écrits, rien de codé

| Phase | Contenu | Dépend de |
|---|---|---|
| 2 | Carnet de mise en service (8 pages), PV de mise en service (17 contrôles), visite d'entretien (13 opérations), attestation d'entretien (décret 2020-912), carnet des fluides de l'entreprise (détecteurs, bouteilles, mouvements, bilan annuel pour SOCOTEC avant le 31 janvier) | phase 1 |
| 3 | Clôture d'intervention depuis le téléphone, compte rendu dicté dans la langue du poseur et traduit, matériel utilisé, suite (garantie / à facturer / devis), **signature sur place** avec les mentions légales hors établissement (textes provisoires à faire valider), ordre d'intervention avec code d'accès et historique complet, notifications dans l'application | phase 1 |
| 4 | Carnet fournisseurs et contacts, bons de commande numérotés `BC-…`, voyant rouge sans accusé de réception après deux jours ouvrés, relance par messagerie, consommables, réception qui coche le matériel du chantier, livraison annoncée après le démarrage signalée, consultations comparatives | rien |
| 5 | Planning d'équipe : équipes types copiées par chantier, état de planning (en cours, à finir, bloqué avec motif, en attente, décalé), vue semaine par équipe, vue liste imprimable identique au PDF de Fabrice, rendez-vous | rien (enrichie par la 4) |

Ordre : 1 → 2 → 3 ; 4 et 5 quand on veut. Chaque prompt commence par ses
prérequis et dit de s'arrêter s'ils manquent.

### Questions ouvertes pour Fabrice

1. SOCOTEC accepte-t-il une reproduction fidèle du Cerfa, ou exige-t-il le
   formulaire officiel ? (change la sortie PDF)
2. Qui signe la rubrique « détenteur » quand le client est absent ?
3. Utilise-t-il des bouteilles de récupération, et chez quel distributeur les
   retourne-t-il ?
4. Sa liste de consommables, avec les quantités par machine.
5. La note coupée : « fiche d'intervention qui garde le nom du… » — de qui ?
6. Les appels sortants sur la ligne Allô : à enregistrer ou non ?
7. Quand peut-il faire la configuration Google (`GOOGLE.md`) ?
8. Une explication des achats, promise et pas encore donnée : comment la
   contrainte du SQL 29 (matériel de chantier → achats) joue avec sa
   comptabilité.

---

## 6. Points de vigilance et dette

- **Le dépôt semblait vide le 4 octobre** (seul `.env.local` restait). Non
  élucidé. Vérifier d'abord : dossier emboîté après le renommage
  `Batinium/batinium` → `Batinium` ; `git stash list` ; `git log` ; corbeille.
  Un `git clean -fd` sur un dépôt sans commit garde exactement `.env.local`
  et `node_modules`, ce qui correspond au symptôme. Sources pour reconstruire
  si nécessaire : l'archive `Batinium (4).zip` du 8 septembre (état avant le
  lot 12), les fichiers téléchargés lot par lot depuis la conversation
  Claude, la livraison phase 1, et **la base Supabase elle-même** —
  `npx supabase db dump --schema public` rend le schéma complet, scripts 04 à
  11 compris.
- **Les scripts 04 à 11 ne sont pas dans `sql/`.** Le schéma vivant est sur
  Supabase ; un `db dump` le récupère.
- `document_vigilance_ancien` : à supprimer après vérification des
  attestations migrées (`drop table document_vigilance_ancien`).
- Dette CSS : des `!important` dans le repli mobile, parce que les grilles
  sont en style en ligne dans les pages. À résorber page par page.
- `equipement.prochain_entretien_le` : alertes implémentées, données vides
  jusqu'à la phase 2 (mise en service automatique).
- Pas de compte technicien de test : à créer pour valider les écrans de
  terrain et la RLS vue depuis ce rôle.
- La signature HMAC des webhooks Allô n'est pas vérifiée (le jeton d'URL
  protège l'accès, pas l'intégrité).
- Pas d'envoi d'e-mail automatique : tout passe par `mailto`. Les relances
  fournisseurs et les notifications par e-mail attendent Google ou un
  prestataire avec DKIM/SPF (nécessaire pour les futurs clients hors Gmail).
- La génération de PDF se fait par le navigateur ; le rangement automatique
  des PDF dans la bibliothèque attend une génération côté serveur.
- Les textes légaux de signature hors établissement (phase 3) sont
  provisoires et **doivent être validés par un juriste** avant usage.
- Les PRP des fluides (SQL 32) sont ceux cités par le client, **à confirmer**
  contre le règlement (UE) 2024/573.

---

## 7. Idées notées, pas planifiées

Page chef de chantier (travaux supplémentaires avec avenant, remontée des
remarques client, comptes rendus de réunion structurés, consignes de chantier
hors devis, validation des heures) · annulation d'envoi d'e-mail pendant
vingt secondes · traduction du devis proposée avant envoi · application
multilingue · récupération des PDF dans les e-mails entrants · suggestion de
créneau · reconnaissance des e-mails fournisseurs par domaine (exige Gmail) ·
workspaces Anthropic par client pour un plafond côté fournisseur ·
dépôt d'une copie des documents officiels dans Dropbox, dans l'arborescence
de Fabrice (`CLIENTS → AAA - CLIENTS ACCEPTES → [client] → DOCUMENTS OFFICIELS
MACHINES`).
