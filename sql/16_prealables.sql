-- =============================================================================
-- BATINIUM — 16. Préalables modifiables, photos rattachées aux notes
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 15.
-- Rejouable.
--
-- Deux choses :
--   1. les sept préalables de chantier, jusqu'ici écrits en dur dans le code,
--      deviennent une liste que l'entreprise règle elle-même ;
--   2. une photo peut appartenir à une note de journal, pour qu'image et
--      explication ne soient plus deux choses séparées.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Les préalables de l'entreprise
--
-- Ce qu'il faut avoir obtenu avant de planifier : accord de copropriété,
-- déclaration préalable, acompte, matériel livré… La liste dépend du métier et
-- des habitudes. Sept lignes gravées dans le code convenaient à un installateur
-- de climatisation et à personne d'autre.
-- -----------------------------------------------------------------------------

create table if not exists prealable (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  -- Clé stable : c'est elle qui est cochée dans chantier.checklist. Renommer
  -- un libellé ne doit pas décocher les chantiers en cours.
  cle           text not null,
  libelle       text not null,
  aide          text,
  position      int  not null default 0,
  actif         boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (entreprise_id, cle)
);

create index if not exists prealable_ordre_idx on prealable (entreprise_id, position);

comment on table prealable is
  'Liste par défaut des préalables. Un chantier en prend une copie à sa création.';
comment on column prealable.cle is
  'Identifiant stable, coché dans chantier.checklist. Ne jamais le réécrire sur une liste en service.';


-- Tout le monde lit la liste — un technicien voit les préalables de son
-- chantier. Seule la direction la modifie : c'est une décision d'organisation,
-- pas un geste de terrain.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'prealable'
  loop
    execute format('drop policy %I on prealable', p.policyname);
  end loop;
end $$;

alter table prealable enable row level security;

create policy lecture on prealable for select to authenticated
  using (entreprise_id = mon_entreprise());

create policy administration on prealable for all to authenticated
  using (entreprise_id = mon_entreprise() and mon_role() = 'direction')
  with check (entreprise_id = mon_entreprise() and mon_role() = 'direction');


-- -----------------------------------------------------------------------------
-- 2. La liste propre à chaque chantier
--
-- Copie et non référence, volontairement. Retirer un préalable de la liste de
-- l'entreprise ne doit pas faire disparaître une case déjà cochée sur un
-- chantier en cours, ni en ajouter une non satisfaite sur un chantier prêt à
-- démarrer. La liste de l'entreprise est un point de départ, pas une autorité
-- permanente.
--
-- Nul sur les chantiers antérieurs : ils retombent alors sur la liste de
-- l'entreprise, ce qui reproduit exactement le comportement d'aujourd'hui.
-- -----------------------------------------------------------------------------

alter table chantier
  add column if not exists prealables jsonb;

comment on column chantier.prealables is
  'Copie de la liste au moment de la création : [{"cle","libelle","aide"}]. Nul = liste de l''entreprise.';


-- -----------------------------------------------------------------------------
-- 3. Amorçage : les sept préalables historiques
--
-- Chaque entreprise déjà en base récupère la liste qu'elle utilisait sans le
-- savoir, avec les mêmes clés : les cases cochées le restent.
-- -----------------------------------------------------------------------------

insert into prealable (entreprise_id, cle, libelle, position)
select e.id, v.cle, v.libelle, v.position
from entreprise e
cross join (values
  ('accord_copro',          'Accord de copropriété obtenu',        0),
  ('declaration_prealable', 'Déclaration préalable accordée',      1),
  ('acompte_encaisse',      'Acompte encaissé',                    2),
  ('materiel_commande',     'Matériel commandé',                   3),
  ('materiel_livre',        'Matériel livré',                      4),
  ('acces_confirme',        'Accès et stationnement confirmés',    5),
  ('alim_elec',             'Alimentation électrique vérifiée',    6)
) as v(cle, libelle, position)
on conflict (entreprise_id, cle) do nothing;


-- -----------------------------------------------------------------------------
-- 4. Une photo peut appartenir à une note
--
-- Jusqu'ici une photo se rattachait au chantier, et la note aussi, mais rien ne
-- les reliait : on avait vingt photos d'un côté, quinze notes de l'autre, et
-- personne pour dire laquelle expliquait quoi. Une photo déposée avec une note
-- porte désormais son identifiant.
-- -----------------------------------------------------------------------------

alter table document
  add column if not exists fil_id uuid references fil(id) on delete cascade;

create index if not exists document_fil_idx on document (entreprise_id, fil_id)
  where fil_id is not null;

-- La contrainte de rattachement doit accepter ce nouveau lien.
alter table document drop constraint if exists document_rattachement_check;
alter table document add constraint document_rattachement_check
  check (num_nonnulls(chantier_id, intervention_id, membre_id, tiers_id, devis_id, fil_id) >= 1);


-- -----------------------------------------------------------------------------
-- 5. Vérification
-- -----------------------------------------------------------------------------

do $$
declare n integer;
begin
  select count(*) into n from prealable;
  raise notice 'SQL 16 appliqué. Préalables en base : %.', n;
end $$;
