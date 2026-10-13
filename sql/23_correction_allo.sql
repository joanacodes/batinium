-- =============================================================================
-- BATINIUM — 23. Correction avant déploiement du webhook Allô
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 22.
-- Rejouable.
--
-- Le webhook Allô est écrit depuis le début du projet et n'a jamais été
-- déployé. En le relisant, il apparaît qu'il aurait échoué dès le premier
-- appel — c'est exactement le genre de chose qu'un code jamais exécuté
-- dissimule.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Le problème
--
-- Le webhook fait un `upsert` sur (entreprise_id, source, source_ref) pour
-- être idempotent : Allô rejoue ses webhooks, et on ne veut pas trois demandes
-- pour un seul appel.
--
-- Les index correspondants, posés au SQL 01, sont **partiels** :
--   create unique index on demande (...) where source_ref is not null;
--
-- Or Postgres ne sait inférer un index partiel dans un ON CONFLICT que si la
-- requête répète son prédicat. PostgREST, qu'utilise la fonction, n'écrit pas
-- de clause WHERE. Le premier appel d'Allô aurait donc rendu :
--
--   there is no unique or exclusion constraint matching the ON CONFLICT
--   specification
--
-- Vérifié sur un Postgres 16 : l'insertion échoue avec l'index partiel,
-- réussit avec l'index complet.
--
-- Le prédicat ne servait de toute façon à rien. Un index unique ordinaire
-- traite déjà chaque NULL comme distinct des autres : deux demandes saisies à
-- la main, toutes deux sans source_ref, cohabitent sans conflit. C'est le
-- comportement par défaut de Postgres, et c'est celui qu'on voulait.
-- -----------------------------------------------------------------------------

do $$
declare i record;
begin
  -- On retrouve les index par leur définition plutôt que par leur nom :
  -- ceux du SQL 01 ont été nommés automatiquement.
  for i in
    select c.relname as nom, t.relname as table_cible
    from pg_index x
    join pg_class c on c.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname in ('demande', 'fil')
      and x.indisunique
      and pg_get_indexdef(x.indexrelid) like '%source_ref%'
      and pg_get_indexdef(x.indexrelid) like '%WHERE%'
  loop
    execute format('drop index %I', i.nom);
    raise notice 'Index partiel retiré sur % : %', i.table_cible, i.nom;
  end loop;
end $$;

create unique index if not exists demande_source_unique
  on demande (entreprise_id, source, source_ref);

create unique index if not exists fil_source_unique
  on fil (entreprise_id, source, source_ref);

comment on index demande_source_unique is
  'Rend le webhook Allô idempotent. Ne pas remettre de prédicat : ON CONFLICT ne saurait plus l''inférer.';


-- -----------------------------------------------------------------------------
-- 2. Vérification : l'upsert du webhook doit passer
--
-- On le rejoue pour de vrai, deux fois, puis on efface. Un test qui vérifie
-- la présence d'un index ne prouve rien ; celui-ci exécute la requête que la
-- fonction enverra.
-- -----------------------------------------------------------------------------

do $$
declare v_entreprise uuid; n integer;
begin
  select id into v_entreprise from entreprise limit 1;
  if v_entreprise is null then
    raise notice 'Aucune entreprise : vérification sautée.';
    return;
  end if;

  insert into demande (entreprise_id, source, source_ref, besoin, urgence, statut)
  values (v_entreprise, 'allo', '__essai__', 'Appel de vérification', 'projet', 'nouvelle')
  on conflict (entreprise_id, source, source_ref)
  do update set besoin = excluded.besoin;

  insert into demande (entreprise_id, source, source_ref, besoin, urgence, statut)
  values (v_entreprise, 'allo', '__essai__', 'Webhook rejoué', 'projet', 'nouvelle')
  on conflict (entreprise_id, source, source_ref)
  do update set besoin = excluded.besoin;

  select count(*) into n from demande
   where entreprise_id = v_entreprise and source_ref = '__essai__';
  if n <> 1 then
    raise exception 'Le webhook créerait % demandes pour un seul appel.', n;
  end if;

  delete from demande where entreprise_id = v_entreprise and source_ref = '__essai__';
  raise notice 'SQL 23 appliqué. L''upsert du webhook Allô fonctionne et reste idempotent.';
end $$;
