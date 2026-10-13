# Batinium — consignes pour Claude Code

Lis ce fichier en entier avant toute action. Puis `ETAT-DU-PROJET.md` pour l'histoire, l'état et ce qui reste. Les deux se complètent : celui-ci dit comment on travaille, l'autre dit où on en est.

## Ce que c'est

Application de gestion pour un installateur de climatisation — Pilotech, Sucy-en-Brie, un gérant (Fabrice), deux salariés, trois à cinq sous-traitants — conçue pour être revendue ensuite à d'autres entreprises du bâtiment. Elle couvre : demandes entrantes, clients, devis, factures, chantiers, interventions, heures, achats, rentabilité, documents, et une couche d'IA en lecture.

Stack : Vite + React 19 + TypeScript strict, Supabase (Postgres + RLS + Storage + Edge Functions en Deno), hébergement Vercel. Pas de backend propre. Routeur maison sur le hash (`#/section/id`, voir `src/lib/router.ts`). CSS unique dans `src/index.css`, aucun framework d'interface. Aucune dépendance npm à ajouter sans raison impérieuse.

Projet Supabase : `sryazbmnhgbtfjvyakgd`. Fonctions déployées : `ia` (passerelle IA) et `allo-webhook` (standard téléphonique).

## Les règles — sans exception

1. Tout en français : tables, colonnes, fonctions, composants, variables, textes d'interface, commentaires. `fiche_fluide`, pas `fluid_sheet`.
2. Les commentaires expliquent le pourquoi, jamais le quoi. Un commentaire qui paraphrase le code est à supprimer. Un commentaire qui dit « pourquoi cette contrainte, qu'est-ce qui casserait sans elle » est attendu sur chaque décision non évidente.
3. Une information ne se saisit qu'à un seul endroit. Si elle existe en base, on la lit. On ne ressaisit jamais.
4. La sécurité est tenue par la base, pas par l'écran. Ce qui ne doit pas descendre vers un technicien ne descend pas : RLS, vues `security definer` filtrées sur `mon_entreprise()` et `voit_les_prix()`. Un masquage à l'écran n'est pas une protection. Modèle : `v_fiche_pose` (SQL 18), avec son garde-fou qui refuse toute colonne tarifaire.
5. Un document émis est immuable, et c'est un déclencheur Postgres qui l'impose. Factures (SQL 20), fiches fluides (SQL 33). Correction par avoir ou fiche rectificative, jamais par modification.
6. Les scripts SQL sont numérotés et rejouables (`if not exists`, `drop … if exists` puis `create`, `on conflict do nothing`). Ils commencent par un en-tête qui dit ce qu'ils font et pourquoi, et finissent par un bloc `do $$ … $$` qui vérifie ce qu'ils viennent de faire et lève une exception sinon — en exécutant vraiment le cas, pas en vérifiant la présence d'un objet. Une vérification ne doit laisser aucune ligne et ne consommer aucun numéro de série réelle.
7. RLS sur chaque nouvelle table, avec `mon_entreprise()`, `mon_role()`, `mon_membre()`, `voit_les_prix()`. Lecture ouverte à l'équipe sauf si la table porte des prix ou des données RH.
8. Aucun prix dans un écran de terrain : fiche de pose, Ma journée, machines, fiches fluides, ordre d'intervention, planning.
9. Pas de `localStorage` ni `sessionStorage`.
10. Avant de rendre la main : `npx tsc -b` propre, `npx vite build` réussi, `npx oxlint` sans erreur (les avertissements existants sont connus). Un projet qui ne compile pas ne se livre pas.
11. Motifs d'interface existants : `.entete` avec `h1` et actions à droite, `FilAriane` sur les fiches de détail, `Modale` pour les formulaires, `.panneau`, `.jeton`, `.statut`, `.tableau-defilant`, `Chiffre` en tête de page. Regarde `FicheChantier.tsx` et `Facture.tsx` avant de dessiner. Documents imprimables : classes `document`, `doc-*`, `sans-impression`, PDF par `window.print()`.
12. Les fichiers vont dans le seau privé `documents` via `televerserDocument()` et s'affichent par liens signés (`lienDocument()`), jamais par URL durable.
13. Écrire ne se fait pas en silence : une erreur est affichée, un état d'installation est constaté par un test réel, jamais déduit de la présence de données.
14. Livraison : un tableau « fichier → chemin complet sous `C:\Projets\Batinium\` → nouveau / remplacé » en tête du compte rendu, la sortie de compilation, l'état d'exécution des SQL, cinq étapes de test, et les écarts entre la demande et ce qui a été trouvé dans le code.

## Décisions qu'on ne rediscute pas

* Le coût d'un sous-traitant vit dans le prix d'achat de la ligne de devis ou dans `paiement_equipe`, jamais en dépense (SQL 12).
* Le matériel d'un chantier passe par les achats, jamais par les dépenses (SQL 29). Les dépenses gardent carburant, péages, repas, véhicule, formation, certification, et le matériel d'atelier hors chantier.
* Les photos de catalogue et les documents sont dans des seaux privés.
* L'assistant IA lit avec les droits de la personne connectée (le navigateur rassemble le contexte, la RLS filtre). Il n'écrit que des notes et des brouillons de devis — jamais envoyés, signés ni facturés.
* La clé d'API du modèle est partagée (secret Supabase) avec un plafond mensuel par entreprise (`parametres.quota_ia_mensuel`). Une entreprise peut poser la sienne. Une clé posée ne se relit jamais (`connecteur_secret`, sans politique SELECT).
* Les jetons de webhook sont en base (`connecteur.jeton`), uniques, et désignent l'entreprise à eux seuls.
* L'anonymisation RGPD est conditionnelle : complète sans facture émise, partielle sinon (nom et adresse sont des mentions obligatoires de la facture, dix ans).
* La plaque signalétique fait foi pour une machine : elle l'emporte sur le devis et sur la facture.
* Une fiche fluides par machine et par intervention, numérotée à la signature du technicien (`FF-AAAA-NNNN`), figée ensuite.

## Cahier des charges en cours

`PLAN-FLUIDES-COMMANDES-PLANNING.md` (douze modules, sept phases, points légaux) et `PROMPT-PHASE-1.md` à `PROMPT-PHASE-5.md` (un prompt par phase, à exécuter dans l'ordre 1 → 2 → 3 ; 4 et 5 indépendantes). La phase 1 est codée et livrée, à intégrer avec `INTEGRATION-PHASE-1.md`.
