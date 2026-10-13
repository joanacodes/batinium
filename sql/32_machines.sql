-- =============================================================================
-- BATINIUM — 32. Le registre des machines
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 31.
-- Rejouable.
--
-- La fiche Cerfa des fluides, le carnet de mise en service et l'entretien
-- partent tous d'une machine identifiée : marque, modèle, numéro de série,
-- fluide, charge. `equipement` existe depuis le premier script ; il lui
-- manquait ce que la réglementation demande d'en savoir.
--
-- Ce script ne recrée rien : il étend `equipement`, ajoute le référentiel des
-- fluides et les deux calculs réglementaires, et permet de rattacher la photo
-- de la plaque signalétique à la machine elle-même.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Le référentiel des fluides frigorigènes
--
-- Le potentiel de réchauffement planétaire (PRP) d'un fluide sert à convertir
-- une charge en kilogrammes en tonnes équivalent CO2 — l'unité dans laquelle
-- la réglementation fixe ses seuils. Le saisir à la main sur chaque machine,
-- c'est s'exposer à un 675 tapé 765 et à une fréquence de contrôle fausse.
--
-- Valeurs reprises des documents de Pilotech (carnet de mise en service,
-- page 2), plus R407C et R22. Elles sont celles du règlement F-gaz tel que le
-- client les cite : À CONFIRMER contre l'annexe du règlement (UE) 2024/573
-- avant mise en production.
--
-- Pas de colonne entreprise_id : c'est un référentiel commun, identique pour
-- toutes les entreprises, comme une table de taux de TVA.
-- -----------------------------------------------------------------------------

create table if not exists fluide_frigorigene (
  code             text primary key,
  libelle          text not null,
  prp              integer not null check (prp >= 0),
  denomination_adr text,
  actif            boolean not null default true
);

comment on table fluide_frigorigene is
  'Référentiel commun. PRP à confirmer contre le règlement (UE) 2024/573 avant production.';
comment on column fluide_frigorigene.denomination_adr is
  'Dénomination de transport, reprise telle quelle dans la rubrique 6 du Cerfa 15497*04.';
comment on column fluide_frigorigene.actif is
  'Faux pour un fluide interdit à la recharge (R22) : il reste lisible sur une machine ancienne.';

insert into fluide_frigorigene (code, libelle, prp, denomination_adr, actif) values
  ('R32',   'R32',   675,  'UN 3252 Difluorométhane, 2.1', true),
  ('R410A', 'R410A', 2088, 'UN 3163 Gaz liquéfié, n.s.a. (R410A), 2.2', true),
  ('R454B', 'R454B', 466,  'UN 3161 Gaz liquéfié inflammable, n.s.a. (R454B), 2.1', true),
  ('R290',  'R290 (propane)', 3, 'UN 1978 Propane, 2.1', true),
  ('R134a', 'R134a', 1430, 'UN 3159 1,1,1,2-Tétrafluoroéthane, 2.2', true),
  ('R407C', 'R407C', 1774, 'UN 3340 Gaz réfrigérant R407C, 2.2', true),
  ('R22',   'R22 (interdit à la recharge)', 1810, 'UN 1018 Chlorodifluorométhane, 2.2', false)
on conflict (code) do nothing;

alter table fluide_frigorigene enable row level security;
drop policy if exists lecture on fluide_frigorigene;
create policy lecture on fluide_frigorigene for select to authenticated using (true);


-- -----------------------------------------------------------------------------
-- 2. Les deux calculs réglementaires
--
-- Tous deux `immutable` : ils ne dépendent que de leurs arguments, ce qui
-- permet de les utiliser dans une colonne générée. Postgres refuse une colonne
-- générée appuyée sur une fonction qui ne l'est pas.
-- -----------------------------------------------------------------------------

create or replace function tonnage_co2(p_charge_kg numeric, p_prp integer)
returns numeric language sql immutable as $$
  select case when p_charge_kg is null or p_prp is null then null
              else round(p_charge_kg * p_prp / 1000.0, 3) end
$$;

comment on function tonnage_co2(numeric, integer) is
  'Charge (kg) × PRP ÷ 1000, en tonnes équivalent CO2. Exemple : 0,65 kg de R32 = 0,439 t.';

/*
 * Fréquence minimale du contrôle d'étanchéité périodique.
 *
 * Seuils du règlement F-gaz (art. 4 du règlement (UE) 517/2014, repris par le
 * règlement (UE) 2024/573) tels que les reprend le Cerfa 15497*04, rubrique 5 :
 *   - non soumis sous 5 t éq. CO2, ou sous 10 t si hermétiquement scellé ;
 *   - 12 mois de 5 à 50 t ;
 *   - 6 mois de 50 à 500 t ;
 *   - 3 mois au-delà.
 * Avec un système permanent de détection de fuite, les durées doublent.
 *
 * Une charge inconnue rend NULL et non « non soumis » : affirmer qu'une
 * machine échappe au contrôle sans connaître sa charge, c'est une erreur qui
 * se découvre lors d'une inspection.
 */
create or replace function frequence_controle(p_tonnage numeric, p_hermetique boolean,
                                              p_detection boolean)
returns text language plpgsql immutable as $$
declare
  mois integer;
begin
  if p_tonnage is null then
    return null;
  end if;
  if p_tonnage < (case when coalesce(p_hermetique, false) then 10 else 5 end) then
    return 'non_soumis';
  end if;
  mois := case when p_tonnage < 50 then 12 when p_tonnage < 500 then 6 else 3 end;
  if coalesce(p_detection, false) then
    mois := mois * 2;
  end if;
  return mois || '_mois';
end $$;

comment on function frequence_controle(numeric, boolean, boolean) is
  'non_soumis, 24_mois, 12_mois, 6_mois ou 3_mois. NULL si la charge est inconnue.';


-- -----------------------------------------------------------------------------
-- 3. Ce qu'il manquait à la machine
-- -----------------------------------------------------------------------------

alter table equipement
  add column if not exists puissance_kw         numeric(6,2),
  add column if not exists hermetique           boolean not null default false,
  add column if not exists prp                  integer,
  add column if not exists piece                text,
  add column if not exists verifie_le           timestamptz,
  add column if not exists verifie_par          uuid references membre(id) on delete set null,
  add column if not exists garantie_pieces_fin  date,
  add column if not exists detection_permanente boolean not null default false,
  add column if not exists devis_ligne_id       uuid references devis_ligne(id) on delete set null,
  add column if not exists rang                 integer not null default 1;

comment on column equipement.puissance_kw is
  'Décide de l''obligation d''entretien : tous les 2 ans de 4 à 70 kW (décret 2020-912), recommandé en dessous.';
comment on column equipement.hermetique is
  'Équipement hermétiquement scellé (Cerfa, rubrique 3). Relève le seuil de contrôle d''étanchéité de 5 à 10 t éq. CO2.';
comment on column equipement.prp is
  'Copié de fluide_frigorigene au moment de la vérification : la fiche doit garder la valeur qui a servi au calcul.';
comment on column equipement.piece is
  'La pièce (Cerfa, rubrique 3 « localisation ») : séjour, chambre 1. Distinct d''emplacement, plus libre.';
comment on column equipement.verifie_le is
  'Pose de la date au moment où quelqu''un a relu la plaque. La plaque fait foi sur le devis et la facture.';
comment on column equipement.garantie_pieces_fin is
  'Garantie pièces et main-d''œuvre : mise en service + la durée de parametres, deux ans par défaut.';
comment on column equipement.detection_permanente is
  'Système permanent de détection de fuite (Cerfa, rubrique 5). Double la périodicité du contrôle.';
comment on column equipement.devis_ligne_id is
  'La ligne de devis dont la machine est née. Avec `rang`, rend la création depuis le devis idempotente.';
comment on column equipement.rang is
  'Pour une ligne de quantité 2, la première et la seconde machine. Sans lui, impossible de savoir laquelle existe déjà.';
comment on column equipement.photo_plaque_url is
  'Conservée pour compatibilité. La photo passe désormais par document.equipement_id, dans le seau privé.';

-- La tonne équivalent CO2 se calcule, elle ne se saisit pas.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'equipement' and column_name = 'tonnage_co2') then
    alter table equipement
      add column tonnage_co2 numeric generated always as (tonnage_co2(charge_kg, prp)) stored;
  end if;
end $$;

comment on column equipement.tonnage_co2 is
  'Calculée : charge_kg × prp ÷ 1000. Ne peut pas diverger de ses deux sources.';

-- Une même ligne de devis ne donne pas deux fois la même machine.
create unique index if not exists equipement_ligne_rang_unique
  on equipement (chantier_id, devis_ligne_id, rang)
  where devis_ligne_id is not null;


-- -----------------------------------------------------------------------------
-- 4. La photo de la plaque, rattachée à la machine
--
-- La plaque fait foi : elle l'emporte sur le devis et sur la facture. Sa photo
-- doit donc vivre avec la machine, dans le seau privé, et non dans une URL
-- durable comme l'ancienne colonne photo_plaque_url.
-- -----------------------------------------------------------------------------

alter table document
  add column if not exists equipement_id uuid references equipement(id) on delete cascade;

create index if not exists document_equipement_idx on document (entreprise_id, equipement_id)
  where equipement_id is not null;

comment on column document.equipement_id is
  'Une pièce de la machine : la photo de sa plaque signalétique. Supprimée avec elle.';

-- La contrainte de rattachement doit accepter ce nouveau lien. Même liste que
-- le script 27, plus equipement_id.
alter table document drop constraint if exists document_rattachement_check;
alter table document add constraint document_rattachement_check
  check (
    portee_entreprise
    or num_nonnulls(chantier_id, intervention_id, membre_id, tiers_id, devis_id,
                    fil_id, achat_id, equipement_id) >= 1
  );


-- -----------------------------------------------------------------------------
-- 5. Droits : la photo d'une plaque est une pièce de chantier
--
-- Depuis le script 13, une pièce de chantier ou d'intervention est visible de
-- toute l'équipe, le reste monte au niveau de ceux qui voient les prix ; le
-- script 27 en a retiré le scan des factures d'achat.
--
-- Sans cette réécriture, une photo de plaque rattachée à la seule machine
-- tomberait dans « le reste » : le technicien qui vient de la prendre ne
-- pourrait plus la voir. C'est pourtant lui qui recopie le numéro de série.
-- -----------------------------------------------------------------------------

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'document'
  loop
    execute format('drop policy %I on document', p.policyname);
  end loop;
end $$;

create policy acces on document for all to authenticated
  using (
    entreprise_id = mon_entreprise()
    and (((chantier_id is not null or intervention_id is not null or equipement_id is not null)
          and achat_id is null)
         or voit_les_prix())
  )
  with check (
    entreprise_id = mon_entreprise()
    and (((chantier_id is not null or intervention_id is not null or equipement_id is not null)
          and achat_id is null)
         or voit_les_prix())
  );


-- -----------------------------------------------------------------------------
-- 6. Vérification
--
-- Les quatre cas chiffrés du cahier des charges, éprouvés sur une vraie ligne
-- d'equipement — pas seulement sur la fonction : c'est la colonne générée qui
-- sera lue partout. Tout est annulé à la fin par l'exception attrapée.
-- -----------------------------------------------------------------------------

do $$
declare
  v_ent uuid;
  v_id  uuid;
  r     record;
begin
  -- Les fonctions, seules.
  if tonnage_co2(0.65, 675) <> 0.439 then
    raise exception 'tonnage_co2(0,65 ; 675) devrait valoir 0,439 et vaut %.', tonnage_co2(0.65, 675);
  end if;
  if frequence_controle(tonnage_co2(0.65, 675), false, false) <> 'non_soumis' then
    raise exception '0,65 kg de R32 devrait être non soumis.';
  end if;
  if frequence_controle(tonnage_co2(8, 675), false, false) <> '12_mois' then
    raise exception '8 kg de R32 (5,4 t) devrait donner 12 mois.';
  end if;
  if frequence_controle(tonnage_co2(8, 675), true, false) <> 'non_soumis' then
    raise exception '8 kg de R32 hermétique (5,4 t < 10 t) devrait être non soumis.';
  end if;
  if frequence_controle(tonnage_co2(8, 2088), false, true) <> '24_mois' then
    raise exception '8 kg de R410A (16,7 t) avec détection devrait donner 24 mois.';
  end if;
  if frequence_controle(null, false, false) is not null then
    raise exception 'Une charge inconnue doit rendre NULL, pas une fréquence.';
  end if;

  -- La colonne générée, sur une vraie ligne.
  select id into v_ent from entreprise limit 1;
  if v_ent is not null then
    begin
      insert into equipement (entreprise_id, fluide, charge_kg, prp, statut)
        values (v_ent, 'R32', 0.65, 675, 'actif') returning id into v_id;
      select tonnage_co2 into r from equipement where id = v_id;
      if r.tonnage_co2 <> 0.439 then
        raise exception 'La colonne tonnage_co2 vaut % au lieu de 0,439.', r.tonnage_co2;
      end if;
      raise exception 'fin_de_verification';
    exception when raise_exception then
      if sqlerrm <> 'fin_de_verification' then raise; end if;
    end;
  end if;

  raise notice 'SQL 32 appliqué. Registre des machines, tonnage CO2 et fréquence de contrôle en place.';
end $$;
