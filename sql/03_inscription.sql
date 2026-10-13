-- =============================================================================
-- BATINIUM — Inscription et rattachement
-- À exécuter APRÈS 01_batinium.sql. Peut être exécuté avant ou après 02.
--
-- Deux parcours :
--   1. Le tout premier compte crée l'entreprise et devient direction.
--   2. Les suivants demandent à rejoindre avec le code d'invitation, et la
--      direction leur attribue un rôle. Personne n'entre sans validation.
-- =============================================================================

drop table if exists rattachement cascade;
drop function if exists creer_entreprise(text, text) cascade;
drop function if exists demander_rattachement(text, text) cascade;
drop function if exists approuver_rattachement(uuid, text) cascade;
drop function if exists refuser_rattachement(uuid) cascade;
drop function if exists mon_rattachement() cascade;

-- Rattrapage : la colonne code_invitation est normalement créée par
-- 01_batinium.sql. Ce bloc ne sert qu'aux bases montées avant cette version.
alter table entreprise add column if not exists code_invitation text;

alter table entreprise
  alter column code_invitation
  set default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

update entreprise
   set code_invitation = upper(substr(md5(random()::text || id::text), 1, 6))
 where code_invitation is null;

alter table entreprise alter column code_invitation set not null;
create unique index if not exists entreprise_code_invitation_idx on entreprise (code_invitation);

-- -----------------------------------------------------------------------------
-- Demandes de rattachement
-- -----------------------------------------------------------------------------

create table rattachement (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  email         text,
  nom           text not null,
  statut        text not null default 'en_attente'
                check (statut in ('en_attente','accepte','refuse')),
  created_at    timestamptz not null default now(),
  traite_le     timestamptz,
  unique (user_id, entreprise_id)
);

create index on rattachement (entreprise_id, statut);

-- -----------------------------------------------------------------------------
-- 1. Créer son entreprise — réservé à un compte qui n'appartient à aucune
-- -----------------------------------------------------------------------------

create or replace function creer_entreprise(p_nom text, p_nom_membre text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e uuid;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;
  if exists (select 1 from membre where user_id = auth.uid()) then
    raise exception 'Ce compte appartient déjà à une entreprise.';
  end if;
  if coalesce(trim(p_nom), '') = '' then
    raise exception 'Le nom de l''entreprise est obligatoire.';
  end if;

  insert into entreprise (nom, code_invitation)
  values (trim(p_nom), upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)))
  returning id into e;

  insert into membre (entreprise_id, user_id, nom, role)
  values (e, auth.uid(), coalesce(nullif(trim(p_nom_membre), ''), 'Direction'), 'direction');

  insert into parametres (entreprise_id, raison_sociale) values (e, trim(p_nom))
  on conflict (entreprise_id) do nothing;

  return e;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Demander à rejoindre une entreprise, avec son code
-- -----------------------------------------------------------------------------

create or replace function demander_rattachement(p_nom text, p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e uuid;
  r uuid;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;
  if exists (select 1 from membre where user_id = auth.uid()) then
    raise exception 'Ce compte appartient déjà à une entreprise.';
  end if;

  select id into e from entreprise
   where upper(code_invitation) = upper(trim(coalesce(p_code, '')));
  if e is null then
    raise exception 'Code d''invitation inconnu.';
  end if;

  insert into rattachement (user_id, entreprise_id, email, nom)
  values (auth.uid(), e,
          (select email from auth.users where id = auth.uid()),
          coalesce(nullif(trim(p_nom), ''), 'Sans nom'))
  on conflict (user_id, entreprise_id)
    do update set nom = excluded.nom, statut = 'en_attente', traite_le = null
  returning id into r;

  return r;
end $$;

-- Où en est ma demande ? Lisible par le demandeur, qui n'est membre de rien.
create or replace function mon_rattachement()
returns table (statut text, entreprise text)
language sql stable security definer set search_path = public as $$
  select r.statut, e.nom
    from rattachement r
    join entreprise e on e.id = r.entreprise_id
   where r.user_id = auth.uid()
   order by r.created_at desc
   limit 1
$$;

-- -----------------------------------------------------------------------------
-- 3. Accepter ou refuser — direction uniquement
-- -----------------------------------------------------------------------------

create or replace function approuver_rattachement(p_id uuid, p_role text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  d rattachement%rowtype;
  m uuid;
begin
  if mon_role() is distinct from 'direction' then
    raise exception 'Seule la direction peut accepter un membre.';
  end if;
  if p_role not in ('direction','chef_chantier','technicien','sous_traitant') then
    raise exception 'Rôle inconnu : %', p_role;
  end if;

  select * into d from rattachement
   where id = p_id and entreprise_id = mon_entreprise() and statut = 'en_attente';
  if not found then
    raise exception 'Demande introuvable ou déjà traitée.';
  end if;

  insert into membre (entreprise_id, user_id, nom, role)
  values (d.entreprise_id, d.user_id, d.nom, p_role)
  on conflict (user_id, entreprise_id) do update set role = excluded.role, actif = true
  returning id into m;

  update rattachement set statut = 'accepte', traite_le = now() where id = p_id;
  return m;
end $$;

create or replace function refuser_rattachement(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if mon_role() is distinct from 'direction' then
    raise exception 'Seule la direction peut refuser un membre.';
  end if;
  update rattachement set statut = 'refuse', traite_le = now()
   where id = p_id and entreprise_id = mon_entreprise();
end $$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table rattachement enable row level security;

create policy lecture_demandeur on rattachement for select to authenticated
  using (user_id = auth.uid());

create policy lecture_direction on rattachement for select to authenticated
  using (entreprise_id = mon_entreprise() and mon_role() = 'direction');
