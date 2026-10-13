-- =============================================================================
-- BATINIUM — 32. Le registre des machines
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 31.
-- Rejouable, y compris sur une base où la version livrée le 4 octobre a déjà
-- tourné : les écarts sont repris un par un.
--
-- La fiche Cerfa des fluides, le carnet de mise en service et l'entretien
-- partent tous d'une machine identifiée : marque, modèle, numéro de série,
-- fluide, charge. `equipement` existe depuis le premier script ; il lui
-- manquait ce que la réglementation demande d'en savoir.
--
-- Ce script ne recrée rien : il étend `equipement`, ajoute le référentiel des
-- fluides et les deux calculs réglementaires, et permet de rattacher la photo
-- de la plaque signalétique à la machine elle-même.
--
-- Corrigé le 13 octobre, avant toute exécution sur Supabase :
--   - les PRP sont ceux du règlement (UE) 2024/573 et non ceux recopiés des
--     documents du client (R454B 465 et non 466, R290 0,02 et non 3) ;
--   - le seuil du contrôle d'étanchéité dépend de la famille du fluide, comme
--     le dit la rubrique 7 du Cerfa 15497*04 : tonnes équivalent CO2 pour les
--     HFC, kilogrammes pour les HCFC et les HFO ;
--   - la dénomination ADR/RID est celle du déchet, que demande la rubrique 12.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Le référentiel des fluides frigorigènes
--
-- Le potentiel de réchauffement planétaire (PRP) d'un fluide sert à convertir
-- une charge en kilogrammes en tonnes équivalent CO2. Le saisir à la main sur
-- chaque machine, c'est s'exposer à un 675 tapé 765 et à une fréquence de
-- contrôle fausse.
--
-- Les valeurs sont celles du règlement (UE) 2024/573 : annexe I pour les HFC
-- (le règlement garde les PRP du quatrième rapport du GIEC, ne pas les
-- remplacer par ceux du sixième), annexe II pour les HFO, annexe VI pour les
-- mélanges, calculés au prorata de leurs composants. Le R22 est un HCFC, régi
-- par le règlement sur les substances qui appauvrissent l'ozone : son PRP
-- n'est qu'indicatif, ses seuils de contrôle sont en kilogrammes.
--
-- La famille décide de tout le reste : l'unité du seuil de contrôle, l'effet
-- d'une détection permanente, la nécessité de la signature du client. Le R290
-- et le R744 ne sont pas des gaz fluorés : ni contrôle d'étanchéité, ni fiche
-- d'intervention obligatoire.
--
-- `inflammable` choisit la rubrique déchet de la rubrique 12 du Cerfa : un
-- A2L comme le R32 est inflammable, même faiblement.
--
-- Pas de colonne entreprise_id : c'est un référentiel commun, identique pour
-- toutes les entreprises, comme une table de taux de TVA.
-- -----------------------------------------------------------------------------

create table if not exists fluide_frigorigene (
  code             text primary key,
  libelle          text not null,
  prp              numeric(10,3) not null check (prp >= 0),
  famille          text not null default 'HFC',
  inflammable      boolean not null default false,
  denomination_adr text,
  actif            boolean not null default true
);

-- La version livrée portait un PRP entier, et ni famille ni inflammabilité.
-- Un PRP entier ne peut pas dire 0,02 ni 0,501.
alter table fluide_frigorigene alter column prp type numeric(10,3);
alter table fluide_frigorigene
  add column if not exists famille     text not null default 'HFC',
  add column if not exists inflammable boolean not null default false;

alter table fluide_frigorigene drop constraint if exists fluide_frigorigene_famille_check;
alter table fluide_frigorigene add constraint fluide_frigorigene_famille_check
  check (famille in ('HFC', 'HCFC', 'HFO', 'HC', 'CO2'));

comment on table fluide_frigorigene is
  'Référentiel commun. PRP du règlement (UE) 2024/573, annexes I, II et VI.';
comment on column fluide_frigorigene.famille is
  'HFC (seuils en t éq. CO2), HCFC et HFO (seuils en kg), HC et CO2 (hors réglementation F-gaz).';
comment on column fluide_frigorigene.denomination_adr is
  'Gaz fluorés : la rubrique déchet du Cerfa 15497*04 (rubrique 12), UN 1078 non inflammable, UN 3161 inflammable.';
comment on column fluide_frigorigene.actif is
  'Faux pour un fluide interdit à la recharge (R22) : il reste lisible sur une machine ancienne.';

-- `do update` et non `do nothing` : c'est un référentiel, pas une saisie. Une
-- valeur corrigée ici doit l'emporter sur celle d'une exécution précédente,
-- sinon le R454B garderait 466 sur toute base où la version livrée a tourné.
insert into fluide_frigorigene (code, libelle, prp, famille, inflammable, denomination_adr, actif) values
  ('R32',   'R32',                          675,   'HFC',  true,
   'UN 3161, Déchet Gaz liquéfié inflammable NSA, 2.1 (B/D)', true),
  ('R410A', 'R410A',                        2088,  'HFC',  false,
   'UN 1078, Déchet Gaz frigorifique NSA (Gaz réfrigérant, NSA), 2.2 (C/E)', true),
  ('R454B', 'R454B',                        465,   'HFC',  true,
   'UN 3161, Déchet Gaz liquéfié inflammable NSA, 2.1 (B/D)', true),
  ('R134a', 'R134a',                        1430,  'HFC',  false,
   'UN 1078, Déchet Gaz frigorifique NSA (Gaz réfrigérant, NSA), 2.2 (C/E)', true),
  ('R407C', 'R407C',                        1774,  'HFC',  false,
   'UN 1078, Déchet Gaz frigorifique NSA (Gaz réfrigérant, NSA), 2.2 (C/E)', true),
  ('R290',  'R290 (propane)',               0.02,  'HC',   true,
   'UN 1978, Propane, 2.1', true),
  ('R744',  'R744 (CO2)',                   1,     'CO2',  false,
   'UN 1013, Dioxyde de carbone, 2.2', true),
  ('R22',   'R22 (interdit à la recharge)', 1810,  'HCFC', false,
   'UN 1078, Déchet Gaz frigorifique NSA (Gaz réfrigérant, NSA), 2.2 (C/E)', false)
on conflict (code) do update set
  libelle = excluded.libelle, prp = excluded.prp, famille = excluded.famille,
  inflammable = excluded.inflammable, denomination_adr = excluded.denomination_adr,
  actif = excluded.actif;

alter table fluide_frigorigene enable row level security;
drop policy if exists lecture on fluide_frigorigene;
create policy lecture on fluide_frigorigene for select to authenticated using (true);


-- -----------------------------------------------------------------------------
-- 2. Les deux calculs réglementaires
--
-- Tous deux `immutable` : ils ne dépendent que de leurs arguments, ce qui
-- permet d'utiliser le premier dans une colonne générée. Postgres refuse une
-- colonne générée appuyée sur une fonction qui ne l'est pas.
--
-- La version livrée prenait un PRP entier et ignorait la famille. La colonne
-- générée qui s'appuie sur l'ancienne fonction doit tomber avant elle ; elle
-- est recréée plus bas, à l'identique, sur la nouvelle.
-- -----------------------------------------------------------------------------

alter table equipement drop column if exists tonnage_co2;
drop function if exists tonnage_co2(numeric, integer);
drop function if exists frequence_controle(numeric, boolean, boolean);

create or replace function tonnage_co2(p_charge_kg numeric, p_prp numeric)
returns numeric language sql immutable as $$
  select case when p_charge_kg is null or p_prp is null then null
              else round(p_charge_kg * p_prp / 1000.0, 3) end
$$;

comment on function tonnage_co2(numeric, numeric) is
  'Charge (kg) × PRP ÷ 1000, en tonnes équivalent CO2. Exemple : 0,65 kg de R32 = 0,439 t.';

/*
 * Fréquence minimale du contrôle d'étanchéité périodique.
 *
 * Les rubriques 7, 8 et 9 du Cerfa 15497*04, et l'article 5 du règlement
 * (UE) 2024/573 :
 *   - HFC : soumis à partir de 5 t éq. CO2 ; 12 mois jusqu'à 50 t, 6 mois
 *     jusqu'à 500 t, 3 mois au-delà ;
 *   - HFO : les mêmes paliers en kilogrammes, 1, 10 et 100 kg ;
 *   - HCFC : 2, 30 et 300 kg ;
 *   - HC et CO2 : hors réglementation F-gaz.
 *
 * Un équipement hermétiquement scellé, et étiqueté comme tel par son
 * fabricant, échappe au contrôle sous 10 t pour les HFC et sous 2 kg pour les
 * HFO. Un split assemblé sur place ne l'est jamais : c'est la case qu'on
 * coche à tort.
 *
 * Une détection permanente allonge l'intervalle (24, 12, 6 mois) pour les
 * HFC et les HFO seulement : la rubrique 9 ne prévoit rien pour les HCFC.
 *
 * Non traitée : l'exemption des équipements hermétiques de moins de 3 kg
 * installés dans un logement. Elle ne change le résultat que pour des fluides
 * de PRP supérieur à 3 333, qu'on ne pose plus en climatisation.
 *
 * Une charge ou une famille inconnue rend NULL et non « non soumis » :
 * affirmer qu'une machine échappe au contrôle sans le savoir, c'est une erreur
 * qui se découvre lors d'une inspection.
 */
create or replace function frequence_controle(p_famille text, p_charge_kg numeric,
                                              p_tonnage numeric, p_hermetique boolean,
                                              p_detection boolean)
returns text language plpgsql immutable as $$
declare
  hermetique boolean := coalesce(p_hermetique, false);
  mois integer;
begin
  if p_famille in ('HC', 'CO2') then
    return 'non_soumis';
  elsif p_famille = 'HFC' then
    if p_tonnage is null then return null; end if;
    if p_tonnage < 5 or (hermetique and p_tonnage < 10) then return 'non_soumis'; end if;
    mois := case when p_tonnage < 50 then 12 when p_tonnage < 500 then 6 else 3 end;
  elsif p_famille = 'HFO' then
    if p_charge_kg is null then return null; end if;
    if p_charge_kg < 1 or (hermetique and p_charge_kg < 2) then return 'non_soumis'; end if;
    mois := case when p_charge_kg < 10 then 12 when p_charge_kg < 100 then 6 else 3 end;
  elsif p_famille = 'HCFC' then
    if p_charge_kg is null then return null; end if;
    if p_charge_kg < 2 then return 'non_soumis'; end if;
    return (case when p_charge_kg < 30 then 12 when p_charge_kg < 300 then 6 else 3 end) || '_mois';
  else
    return null;
  end if;

  if coalesce(p_detection, false) then
    mois := mois * 2;
  end if;
  return mois || '_mois';
end $$;

comment on function frequence_controle(text, numeric, numeric, boolean, boolean) is
  'non_soumis, 24_mois, 12_mois, 6_mois ou 3_mois. NULL si la famille ou la charge est inconnue.';


-- -----------------------------------------------------------------------------
-- 3. Ce qu'il manquait à la machine
-- -----------------------------------------------------------------------------

alter table equipement
  add column if not exists puissance_kw         numeric(6,2),
  add column if not exists hermetique           boolean not null default false,
  add column if not exists prp                  numeric(10,3),
  add column if not exists piece                text,
  add column if not exists verifie_le           timestamptz,
  add column if not exists verifie_par          uuid references membre(id) on delete set null,
  add column if not exists garantie_pieces_fin  date,
  add column if not exists detection_permanente boolean not null default false,
  add column if not exists devis_ligne_id       uuid references devis_ligne(id) on delete set null,
  add column if not exists rang                 integer not null default 1;

-- Entier dans la version livrée : même raison que pour le référentiel.
alter table equipement alter column prp type numeric(10,3);

comment on column equipement.puissance_kw is
  'Décide de l''obligation d''entretien : tous les 2 ans de 4 à 70 kW (décret 2020-912), recommandé en dessous.';
comment on column equipement.hermetique is
  'Hermétiquement scellé ET étiqueté comme tel par le fabricant. Relève le seuil de contrôle (HFC : 10 t au lieu de 5).';
comment on column equipement.prp is
  'Copié de fluide_frigorigene au moment de la vérification : la fiche doit garder la valeur qui a servi au calcul.';
comment on column equipement.piece is
  'La pièce (Cerfa, rubrique 3 « localisation ») : séjour, chambre 1. Distinct d''emplacement, plus libre.';
comment on column equipement.verifie_le is
  'Pose de la date au moment où quelqu''un a relu la plaque. La plaque fait foi sur le devis et la facture.';
comment on column equipement.garantie_pieces_fin is
  'Garantie pièces et main-d''œuvre : mise en service + la durée de parametres, deux ans par défaut.';
comment on column equipement.detection_permanente is
  'Système permanent de détection de fuite (Cerfa, rubrique 6). Double l''intervalle de contrôle des HFC et des HFO.';
comment on column equipement.devis_ligne_id is
  'La ligne de devis dont la machine est née. Avec `rang`, rend la création depuis le devis idempotente.';
comment on column equipement.rang is
  'Pour une ligne de quantité 2, la première et la seconde machine. Sans lui, impossible de savoir laquelle existe déjà.';
comment on column equipement.photo_plaque_url is
  'Conservée pour compatibilité. La photo passe désormais par document.equipement_id, dans le seau privé.';

-- La tonne équivalent CO2 se calcule, elle ne se saisit pas.
alter table equipement
  add column tonnage_co2 numeric generated always as (tonnage_co2(charge_kg, prp)) stored;

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
-- Chaque famille de fluide, chaque palier, et le tonnage éprouvé sur une
-- vraie ligne d'equipement — pas seulement sur la fonction : c'est la colonne
-- générée qui sera lue partout. Tout est annulé à la fin par l'exception
-- attrapée.
-- -----------------------------------------------------------------------------

do $$
declare
  v_ent  uuid;
  v_id   uuid;
  r      record;
  obtenu text;
begin
  -- Le référentiel : les valeurs du règlement, pas celles de la version livrée.
  if (select prp from fluide_frigorigene where code = 'R454B') <> 465
     or (select prp from fluide_frigorigene where code = 'R290') <> 0.02 then
    raise exception 'Les PRP du référentiel ne sont pas ceux du règlement (UE) 2024/573.';
  end if;

  if tonnage_co2(0.65, 675) <> 0.439 then
    raise exception 'tonnage_co2(0,65 ; 675) devrait valoir 0,439 et vaut %.', tonnage_co2(0.65, 675);
  end if;

  for r in select * from (values
    -- famille, charge, tonnage, hermétique, détection, attendu, cas
    ('HFC',  0.65, tonnage_co2(0.65, 675),  false, false, 'non_soumis', '0,65 kg de R32'),
    ('HFC',  8,    tonnage_co2(8, 675),     false, false, '12_mois',    '8 kg de R32 (5,4 t)'),
    ('HFC',  8,    tonnage_co2(8, 675),     true,  false, 'non_soumis', '8 kg de R32 hermétique (5,4 t < 10 t)'),
    ('HFC',  8,    tonnage_co2(8, 2088),    false, true,  '24_mois',    '8 kg de R410A (16,7 t) avec détection'),
    ('HFC',  30,   tonnage_co2(30, 2088),   false, false, '6_mois',     '30 kg de R410A (62,6 t)'),
    ('HCFC', 2.5,  tonnage_co2(2.5, 1810),  false, false, '12_mois',    '2,5 kg de R22 : seuil en kg, pas en tonnes'),
    ('HCFC', 2.5,  tonnage_co2(2.5, 1810),  false, true,  '12_mois',    '2,5 kg de R22 avec détection : pas d''allongement'),
    ('HCFC', 1.5,  tonnage_co2(1.5, 1810),  false, false, 'non_soumis', '1,5 kg de R22'),
    ('HFO',  1.5,  tonnage_co2(1.5, 0.501), false, false, '12_mois',    '1,5 kg de HFO'),
    ('HFO',  1.5,  tonnage_co2(1.5, 0.501), true,  false, 'non_soumis', '1,5 kg de HFO hermétique'),
    ('HFO',  12,   tonnage_co2(12, 0.501),  false, true,  '12_mois',    '12 kg de HFO avec détection'),
    ('HC',   0.3,  tonnage_co2(0.3, 0.02),  false, false, 'non_soumis', 'R290')
  ) as t(famille, charge, tonnage, hermetique, detection, attendu, cas)
  loop
    obtenu := frequence_controle(r.famille, r.charge, r.tonnage, r.hermetique, r.detection);
    if obtenu is distinct from r.attendu then
      raise exception '% : attendu %, obtenu %.', r.cas, r.attendu, obtenu;
    end if;
  end loop;

  if frequence_controle('HFC', 8, null, false, false) is not null
     or frequence_controle(null, 8, 5.4, false, false) is not null then
    raise exception 'Une charge ou une famille inconnue doit rendre NULL, pas une fréquence.';
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

  raise notice 'SQL 32 appliqué. Registre des machines, tonnage CO2 et fréquence de contrôle par famille de fluide en place.';
end $$;
