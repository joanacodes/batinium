-- =============================================================================
-- BATINIUM — 14. Rémunérations
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 13.
-- Rejouable.
--
-- Le salaire des salariés, pour le prévisionnel : ce que l'entreprise verse et
-- ce qu'elle paie vraiment, charges comprises.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Pourquoi une table à part, et pas trois colonnes sur `membre`
--
-- La politique de lecture de `membre`, posée au SQL 01, laisse tout membre de
-- l'entreprise lire toutes les fiches — c'est ce qui permet au planning
-- d'afficher des noms. Or la RLS de Postgres filtre des lignes, pas des
-- colonnes : un salaire posé sur `membre` serait lisible par n'importe quel
-- technicien, quoi qu'affiche l'interface.
--
-- Même raisonnement qu'au SQL 01 pour les prix, qui ont leur vue dédiée plutôt
-- qu'un masquage à l'écran : ce qui ne doit pas descendre ne descend pas.
--
-- Une ligne par changement, datée. Une augmentation n'écrase pas l'ancien
-- montant, elle en ajoute un nouveau : sans historique, un prévisionnel sur
-- douze mois appliquerait le salaire d'aujourd'hui à janvier dernier.
-- -----------------------------------------------------------------------------

create table if not exists remuneration (
  id                     uuid primary key default gen_random_uuid(),
  entreprise_id          uuid not null references entreprise(id) on delete cascade,
  membre_id              uuid not null references membre(id) on delete cascade,
  depuis_le              date not null default current_date,

  brut_mensuel           numeric(12,2) not null,
  -- Renseigné quand le comptable a donné le chiffre exact. Nul sinon :
  -- l'application l'estime alors avec le coefficient de l'entreprise, et le
  -- dit, plutôt que d'afficher une estimation sous les traits d'un fait.
  cout_employeur_mensuel numeric(12,2),
  taux_horaire_brut      numeric(8,2),
  heures_hebdo           numeric(5,2) not null default 35,

  notes                  text,
  created_at             timestamptz not null default now(),
  unique (membre_id, depuis_le)
);

comment on table remuneration is
  'Rémunérations successives d''un salarié. Lecture réservée à la direction, et à chacun sur la sienne.';
comment on column remuneration.depuis_le is
  'Date de prise d''effet. La rémunération courante est la plus récente dont la date est passée.';
comment on column remuneration.cout_employeur_mensuel is
  'Coût réel, charges patronales comprises. Nul = à estimer depuis parametres.coefficient_charges.';

create index if not exists remuneration_membre_idx
  on remuneration (entreprise_id, membre_id, depuis_le desc);


-- -----------------------------------------------------------------------------
-- 2. Droits
--
-- Écriture et lecture générale pour la direction seule. Un salarié lit la
-- sienne, ce qui n'apprend rien à personne : c'est son bulletin.
--
-- Volontairement plus strict que `paiement_equipe`, qui s'arrête à
-- voit_les_prix() parce que Rentabilité en a besoin. Aucun écran partagé ne
-- lit cette table-ci : rien n'oblige à l'ouvrir plus large.
-- -----------------------------------------------------------------------------

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'remuneration'
  loop
    execute format('drop policy %I on remuneration', p.policyname);
  end loop;
end $$;

alter table remuneration enable row level security;

create policy lecture on remuneration for select to authenticated
  using (entreprise_id = mon_entreprise()
         and (mon_role() = 'direction' or membre_id = mon_membre()));

create policy administration on remuneration for all to authenticated
  using (entreprise_id = mon_entreprise() and mon_role() = 'direction')
  with check (entreprise_id = mon_entreprise() and mon_role() = 'direction');


-- -----------------------------------------------------------------------------
-- 3. Le coefficient de charges
--
-- Environ 1,42 pour un non-cadre au régime général : 1 000 € de brut coûtent
-- à peu près 1 420 € à l'entreprise. C'est un ordre de grandeur, pas un
-- calcul de paie — allègements, taille de l'entreprise et convention
-- collective le font bouger. D'où un chiffre modifiable, que le comptable
-- pourra corriger, et non une constante cachée dans le code.
-- -----------------------------------------------------------------------------

alter table parametres
  add column if not exists coefficient_charges numeric(5,3) not null default 1.42;

comment on column parametres.coefficient_charges is
  'Multiplicateur brut → coût employeur, pour le prévisionnel. Estimation, jamais un bulletin.';

do $$
begin
  raise notice 'SQL 14 appliqué. Table remuneration créée, coefficient de charges par défaut 1,42.';
end $$;
