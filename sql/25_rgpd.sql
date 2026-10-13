-- =============================================================================
-- BATINIUM — 25. Effacement et anonymisation (RGPD)
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 24.
-- Rejouable.
--
-- Le droit à l'effacement existe, mais il n'est pas absolu : l'article 17.3.b
-- du RGPD réserve le cas d'une obligation légale, et l'article L. 123-22 du
-- code de commerce impose de conserver les pièces comptables dix ans.
--
-- Supprimer un client qui a une facture émise serait donc à la fois illégal et
-- techniquement destructeur : la facture perdrait son destinataire, et la
-- série comptable son sens. Ce qu'on fait à la place : on efface les données
-- personnelles et on garde l'écriture. Le nom devient « Client anonymisé »,
-- les coordonnées disparaissent, les montants restent.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Trace des demandes d'effacement
--
-- Un responsable de traitement doit pouvoir montrer ce qu'il a fait, quand, et
-- à la demande de qui. Une anonymisation sans registre, c'est une opération
-- qu'on ne peut ni prouver ni expliquer.
-- -----------------------------------------------------------------------------

create table if not exists effacement (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  tiers_id      uuid,
  nom_efface    text not null,
  motif         text,
  -- Ce qui a été conservé malgré la demande, et pourquoi.
  conserve      text,
  demande_le    date not null default current_date,
  traite_le     timestamptz not null default now(),
  traite_par    uuid references membre(id) on delete set null
);

create index if not exists effacement_date_idx on effacement (entreprise_id, traite_le desc);

comment on table effacement is
  'Registre des demandes d''effacement. Ce qui a été anonymisé, ce qui a été conservé, et pourquoi.';

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'effacement'
  loop
    execute format('drop policy %I on effacement', p.policyname);
  end loop;
end $$;

alter table effacement enable row level security;

create policy acces on effacement for all to authenticated
  using (entreprise_id = mon_entreprise() and mon_role() = 'direction')
  with check (entreprise_id = mon_entreprise() and mon_role() = 'direction');


-- -----------------------------------------------------------------------------
-- 2. L'anonymisation
--
-- Effacé : nom, e-mail, téléphone, adresse, SIRET, notes libres, transcriptions
-- d'appel et enregistrements — tout ce qui identifie une personne.
--
-- Conservé : les montants, les dates, les numéros de devis et de facture, les
-- lignes vendues. Aucun de ces éléments n'identifie quelqu'un une fois le nom
-- parti, et tous sont exigés par la comptabilité.
--
-- La fonction rend le compte rendu de ce qu'elle a fait : on ne demande pas à
-- quelqu'un de croire sur parole qu'un effacement a eu lieu.
-- -----------------------------------------------------------------------------

create or replace function anonymiser_tiers(p_tiers uuid, p_motif text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_entreprise uuid := mon_entreprise();
  v_nom        text;
  n_devis      integer;
  n_factures   integer;
  n_fils       integer;
  n_demandes   integer;
  v_pseudo     text;
begin
  if mon_role() <> 'direction' then
    raise exception 'Seule la direction peut anonymiser une fiche.';
  end if;

  select nom into v_nom from tiers where id = p_tiers and entreprise_id = v_entreprise;
  if v_nom is null then raise exception 'Fiche introuvable.'; end if;

  -- Un pseudonyme stable et lisible : « Client anonymisé A3F2 ». Sans lui, dix
  -- fiches anonymisées portent le même nom et plus personne ne s'y retrouve
  -- dans les archives.
  v_pseudo := 'Client anonymisé ' || upper(substr(replace(p_tiers::text, '-', ''), 1, 4));

  select count(*) into n_devis    from devis    where tiers_id = p_tiers;
  select count(*) into n_factures from facture  where tiers_id = p_tiers;
  select count(*) into n_demandes from demande  where tiers_id = p_tiers;

  update tiers set
    nom = v_pseudo,
    email = null, telephone = null,
    adresse = null, code_postal = null, ville = null,
    siret = null, notes = null
  where id = p_tiers;

  update site set
    adresse = 'Adresse effacée', code_postal = null, ville = null,
    contraintes_acces = null, notes = null
  where tiers_id = p_tiers;

  update demande set
    nom = v_pseudo, email = null, telephone = null, adresse = null,
    transcription = null, enregistrement_url = null, resume = null
  where tiers_id = p_tiers;

  -- Le fil garde ses dates et ses types : savoir qu'un appel a eu lieu le
  -- 3 mars n'identifie personne. Son contenu, lui, part.
  update fil set contenu = null, sujet = 'Contenu effacé', metadonnees = null
  where tiers_id = p_tiers;
  get diagnostics n_fils = row_count;

  insert into effacement (entreprise_id, tiers_id, nom_efface, motif, conserve, traite_par)
  values (
    v_entreprise, p_tiers, v_nom, p_motif,
    format('%s devis, %s facture(s), %s demande(s) : montants, dates et numéros conservés '
        || 'au titre de l''article L. 123-22 du code de commerce (dix ans).',
        n_devis, n_factures, n_demandes),
    mon_membre()
  );

  return format(
    'Fiche « %s » anonymisée en « %s ». Effacé : coordonnées, adresses, notes, %s entrée(s) '
 || 'de fil, transcriptions d''appel. Conservé : %s devis, %s facture(s) — montants, dates et '
 || 'numéros, obligation comptable de dix ans.',
    v_nom, v_pseudo, n_fils, n_devis, n_factures);
end $$;

comment on function anonymiser_tiers(uuid, text) is
  'Efface les données personnelles d''un tiers en conservant la trace comptable. Irréversible.';


-- -----------------------------------------------------------------------------
-- 3. Vérification
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'anonymiser_tiers'
  ) then
    raise exception 'La fonction d''anonymisation n''a pas été créée.';
  end if;
  raise notice 'SQL 25 appliqué. Anonymisation disponible, registre des effacements en place.';
end $$;
