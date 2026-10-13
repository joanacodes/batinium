# Batinium — installation des services extérieurs

Batinium fonctionne sans aucun de ces services. Chacun ajoute une capacité, et
chacun peut être installé plus tard sans rien casser : les écrans concernés
disent qu'il manque quelque chose au lieu d'échouer sans raison.

L'état de chacun se vérifie dans l'application, **Connexions**, en haut de page.
C'est la source de vérité — ce document explique comment y arriver, pas où on
en est.

---

## Avant tout : les scripts SQL

Rien de ce qui suit ne marche si les scripts n'ont pas été exécutés, **dans
l'ordre des numéros**, dans l'éditeur SQL de Supabase.

```
sql/01 … 29
```

Le dossier `sql/` n'est qu'un classeur : rien ne s'exécute tout seul. On colle
chaque fichier dans l'éditeur, on lance, on lit le message de fin. Chaque
script se termine par un `NOTICE` qui dit ce qu'il a fait, et plusieurs
refusent de s'appliquer si une vérification échoue.

Pour savoir où vous en êtes :

```sql
select tablename from pg_tables where schemaname = 'public' order by tablename;
```

`achat`, `facture`, `pointage`, `prealable`, `remuneration` et `journal_ia`
doivent y figurer.

---

## 1. Le stockage des fichiers

**Ce que ça apporte** : photos et vidéos de chantier, attestations des
sous-traitants, dossiers des salariés, scans de factures fournisseurs, photos
de catalogue.

**Installation** : rien à faire. Les scripts SQL 13 et 17 créent les deux seaux
et leurs règles d'accès.

**Vérification** : Connexions → « Stockage des fichiers » doit être *en place*.

**Si c'est en erreur.** Selon la version de Supabase, l'éditeur SQL refuse
parfois de créer des règles sur `storage.objects`. Il faut alors les poser à la
main : tableau de bord → **Storage** → **Policies**, quatre règles par seau —
lecture, dépôt, remplacement, retrait — avec la même condition :

```sql
bucket_id = 'documents'
  and (storage.foldername(name))[1] = mon_entreprise()::text
```

Puis les quatre mêmes pour `catalogue`.

**Les deux seaux sont privés.** Aucun fichier n'est accessible par une adresse
devinable : chaque affichage demande un lien signé qui expire. Une entreprise ne
peut pas lire le dossier d'une autre, même en connaissant le chemin exact.

---

## 2. La passerelle IA

**Ce que ça apporte** : l'assistant en bulle, la lecture d'un tarif en PDF ou en
photo, le devis dicté, le caviardage avant envoi.

Ce qui marche **sans** elle : la dictée (c'est le navigateur qui transcrit), la
lecture d'un CSV, et tout le reste de l'application.

### Poser la clé

La clé du modèle ne va **ni dans `.env.local`, ni sur Vercel**. Ces deux
endroits finissent dans le navigateur, et tout ce que le navigateur charge est
lisible par qui ouvre les outils de développement. Une clé extraite se facture à
l'entreprise jusqu'à ce qu'on s'en aperçoive.

Elle va dans les secrets de la fonction serveur, chez Supabase :

```bash
npx supabase login
npx supabase link --project-ref sryazbmnhgbtfjvyakgd
npx supabase functions deploy ia
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Sans `--no-verify-jwt`, contrairement au webhook Allô : un appelant anonyme n'a
rien à faire ici.

On peut aussi poser le secret depuis le tableau de bord : **Project Settings →
Edge Functions → Secrets**.

**Vérification** : Connexions → « Passerelle IA ». Le contrôle ne consomme rien,
il répond avant d'appeler le modèle — on peut le relancer autant qu'on veut.

- *pas encore* — la fonction n'est pas déployée.
- *à corriger* — elle est déployée mais la clé manque.
- *en place* — avec le nom du modèle utilisé.

### Changer de modèle

```bash
npx supabase secrets set IA_MODELE=claude-sonnet-4-6
```

### Ce que la passerelle s'interdit

Cinq règles, écrites en tête de `supabase/functions/ia/index.ts` :

1. La clé ne quitte jamais le serveur.
2. Le modèle ne reçoit que des tâches d'une liste fermée — pas de « fais ce que
   dit l'utilisateur ».
3. Il ne touche pas à la base. Il rend des propositions, l'application les
   affiche, une personne décide. Sauf pour un brouillon de devis et une note,
   qui sont inertes tant que personne n'agit dessus.
4. Chaque appel est journalisé avec son coût en jetons.
5. Le contenu envoyé s'efface au bout de trente jours, la trace reste.

### Le coût

Chaque appel est compté. Pour voir la facture arriver plutôt que la découvrir :

```sql
select date_trunc('month', created_at) as mois,
       tache,
       count(*)                        as appels,
       sum(jetons_entree)              as jetons_entree,
       sum(jetons_sortie)              as jetons_sortie
  from journal_ia
 group by 1, 2
 order by 1 desc, 3 desc;
```

Et pour purger le contenu conservé, sans perdre le comptage :

```sql
select purger_journal_ia(30);
```

---

## 3. Le webhook Allô

**Ce que ça apporte** : chaque appel devient une demande, rattachée au client si
son numéro est connu, avec sa transcription et son enregistrement.

**Préalable** : le SQL 23 doit être passé. Sans lui, le webhook échoue dès le
premier appel — les index créés au SQL 01 étaient partiels et empêchaient
l'insertion idempotente.

### Déploiement

```bash
npx supabase functions deploy allo-webhook --no-verify-jwt
npx supabase secrets set ALLO_SECRET=choisissez-un-secret-long ENTREPRISE_ID=<uuid>
```

`--no-verify-jwt` ici, et seulement ici : Allô appelle sans compte utilisateur.
C'est le paramètre `cle` qui fait l'authentification.

L'identifiant d'entreprise s'obtient dans l'éditeur SQL :

```sql
select id, nom from entreprise;
```

### Côté Allô

Pointer le webhook sur :

```
https://sryazbmnhgbtfjvyakgd.supabase.co/functions/v1/allo-webhook?cle=<ALLO_SECRET>
```

**Vérification** : Connexions → « Standard Allô » compte les demandes déjà
reçues par ce canal. Un appel de test suffit à le faire passer en *en place*.

Si rien n'arrive, les traces sont dans le tableau de bord Supabase →
**Edge Functions** → `allo-webhook` → **Logs**. Une clé qui ne correspond pas
rend un 401 sans autre explication, volontairement.

---

## 4. Google : boîte mail et agenda

**Ce que ça apporte** : lecture des e-mails et de l'agenda depuis Batinium.

**Installation** : rien à déployer. Le bouton « Connecter Google » dans
Connexions demande le consentement. Aucun mot de passe n'est conservé, aucun
message ne transite par un autre serveur.

**À savoir** : le jeton expire au bout d'une heure. Quand la boîte cesse de se
mettre à jour, il faut se reconnecter. Ce n'est pas une panne.

---

## 5. L'hébergement

Le front est un site statique. Les seules variables dont il a besoin sont
publiques par nature :

```
VITE_SUPABASE_URL=https://sryazbmnhgbtfjvyakgd.supabase.co
VITE_SUPABASE_ANON_KEY=<clé anonyme>
```

Elles vont dans les variables d'environnement de Vercel. **Rien d'autre.** La
clé anonyme n'est pas un secret : c'est la RLS qui protège les données, pas
l'obscurité de cette clé.

Construction :

```bash
npm ci
npm run build     # tsc -b && vite build
```

---

## Ordre conseillé

1. Les scripts SQL, dans l'ordre. Sans eux rien ne tient.
2. Vérifier le stockage dans Connexions — c'est gratuit et déjà fait.
3. Google, si Fabrice est sur Gmail. Un clic.
4. La passerelle IA. C'est celle qui change le plus le quotidien.
5. Le webhook Allô, quand le standard est en place.

---

## Si quelque chose ne marche pas

L'ordre des questions, de la plus fréquente à la moins :

1. **Le script SQL a-t-il été exécuté ?** Un message parlant d'une table ou
   d'une colonne introuvable veut toujours dire ça.
2. **La fonction est-elle déployée ?** Connexions le dit.
3. **Le secret est-il posé ?** `npx supabase secrets list`.
4. **Les traces.** Tableau de bord Supabase → Edge Functions → la fonction →
   Logs. Elles disent presque toujours ce qui manque.
