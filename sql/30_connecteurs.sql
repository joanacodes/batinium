-- =============================================================================
-- BATINIUM — 30. Des connecteurs réglables depuis l'application
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 29.
-- Rejouable.
--
-- Jusqu'ici, brancher Allô ou l'IA demandait d'ouvrir un terminal et de taper
-- `npx supabase secrets set`. C'est une barrière absurde pour un gérant : les
-- réglages d'un service extérieur sont des réglages, pas du déploiement.
--
-- Les secrets descendent donc en base, avec deux précautions.
--
-- Le jeton d'un webhook est lisible par la direction — il faut bien l'afficher
-- pour le recopier chez le prestataire. Une clé d'API, elle, ne se relit
-- jamais : la table qui la porte n'a aucune politique de lecture, personne ne
-- peut la ressortir depuis le navigateur. Seule la fonction serveur y accède,
-- avec la clé de service qui contourne la RLS.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Le connecteur
--
-- `jeton` est à la fois l'identifiant et le mot de passe du webhook : il vit
-- dans l'URL que le prestataire appelle. Unique sur toute la base, il désigne
-- donc l'entreprise sans qu'on ait à la nommer — ce qui règle au passage le
-- défaut de la version précédente, où un ENTREPRISE_ID en variable
-- d'environnement rendait le webhook mono-entreprise.
-- -----------------------------------------------------------------------------

create table if not exists connecteur (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  cle           text not null,
  actif         boolean not null default false,
  jeton         text unique,
  config        jsonb not null default '{}'::jsonb,
  -- Dernier échange réussi avec le service. C'est la seule preuve qu'il marche.
  vu_le         timestamptz,
  dernier_message text,
  created_at    timestamptz not null default now(),
  unique (entreprise_id, cle)
);

comment on column connecteur.jeton is
  'Identifiant secret dans l''URL du webhook. Unique sur toute la base : il désigne l''entreprise à lui seul.';
comment on column connecteur.vu_le is
  'Dernier appel reçu du service. Une configuration n''est prouvée que par un échange réel.';

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'connecteur'
  loop
    execute format('drop policy %I on connecteur', p.policyname);
  end loop;
end $$;

alter table connecteur enable row level security;

create policy acces on connecteur for all to authenticated
  using (entreprise_id = mon_entreprise() and mon_role() = 'direction')
  with check (entreprise_id = mon_entreprise() and mon_role() = 'direction');


-- -----------------------------------------------------------------------------
-- 2. Les secrets qu'on n'a pas le droit de relire
--
-- Une clé d'API se saisit une fois et ne se réaffiche jamais. Cette table n'a
-- donc AUCUNE politique de lecture : même la direction, même en interrogeant
-- la base depuis le navigateur, ne peut pas la ressortir. Seule la fonction
-- serveur y accède, avec la clé de service.
--
-- C'est le comportement de tous les services sérieux, et pour une bonne
-- raison : une clé qu'on peut réafficher est une clé qui finit dans une
-- capture d'écran.
-- -----------------------------------------------------------------------------

create table if not exists connecteur_secret (
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  cle           text not null,
  valeur        text not null,
  pose_le       timestamptz not null default now(),
  pose_par      uuid references membre(id) on delete set null,
  primary key (entreprise_id, cle)
);

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'connecteur_secret'
  loop
    execute format('drop policy %I on connecteur_secret', p.policyname);
  end loop;
end $$;

alter table connecteur_secret enable row level security;

-- Écriture seulement. Pas de politique SELECT, volontairement.
create policy pose on connecteur_secret for insert to authenticated
  with check (entreprise_id = mon_entreprise() and mon_role() = 'direction');

create policy remplacement on connecteur_secret for update to authenticated
  using (entreprise_id = mon_entreprise() and mon_role() = 'direction')
  with check (entreprise_id = mon_entreprise() and mon_role() = 'direction');

create policy retrait on connecteur_secret for delete to authenticated
  using (entreprise_id = mon_entreprise() and mon_role() = 'direction');


-- -----------------------------------------------------------------------------
-- 3. Savoir qu'un secret est posé, sans le lire
-- -----------------------------------------------------------------------------

create or replace function secret_pose(p_cle text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from connecteur_secret
     where entreprise_id = mon_entreprise() and cle = p_cle and length(valeur) > 0
  )
$$;

/** Enregistre ou remplace un secret. Rend seulement la date de pose. */
create or replace function poser_secret(p_cle text, p_valeur text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_quand timestamptz;
begin
  if mon_role() <> 'direction' then
    raise exception 'Seule la direction peut poser une clé d''API.';
  end if;
  if length(trim(p_valeur)) = 0 then
    raise exception 'La clé est vide.';
  end if;

  insert into connecteur_secret (entreprise_id, cle, valeur, pose_par)
  values (mon_entreprise(), p_cle, trim(p_valeur), mon_membre())
  on conflict (entreprise_id, cle)
  do update set valeur = excluded.valeur, pose_le = now(), pose_par = excluded.pose_par
  returning pose_le into v_quand;

  return v_quand;
end $$;


-- -----------------------------------------------------------------------------
-- 4. Fabriquer un jeton de webhook
--
-- Soixante-quatre caractères tirés au hasard. Il vit dans une URL, donc il doit
-- résister à une tentative de devinette : c'est la seule chose qui sépare
-- votre base d'un appel malveillant.
--
-- Deux uuid concaténés plutôt que gen_random_bytes : ce dernier vient de
-- pgcrypto, qui n'est pas toujours dans le chemin de recherche selon les
-- projets. gen_random_uuid est natif depuis Postgres 13 et donne déjà
-- 256 bits d'aléa pour les deux.
-- -----------------------------------------------------------------------------

create or replace function activer_connecteur(p_cle text)
returns text language plpgsql security definer set search_path = public as $$
declare v_jeton text;
begin
  if mon_role() <> 'direction' then
    raise exception 'Seule la direction peut activer un connecteur.';
  end if;

  v_jeton := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into connecteur (entreprise_id, cle, actif, jeton)
  values (mon_entreprise(), p_cle, true, v_jeton)
  on conflict (entreprise_id, cle)
  do update set actif = true, jeton = coalesce(connecteur.jeton, excluded.jeton)
  returning jeton into v_jeton;

  return v_jeton;
end $$;


-- -----------------------------------------------------------------------------
-- 5. Vérification
-- -----------------------------------------------------------------------------

do $$
declare n integer;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'connecteur_secret' and cmd = 'SELECT';
  if n > 0 then
    raise exception 'connecteur_secret ne doit avoir aucune politique de lecture : une clé posée ne se relit pas.';
  end if;
  raise notice 'SQL 30 appliqué. Connecteurs réglables depuis l''application, clés non relisibles.';
end $$;
