-- =============================================================================
-- BATINIUM — Schéma complet
-- À exécuter en une fois dans l'éditeur SQL de Supabase.
-- Repart de zéro : supprime les tables existantes puis les recrée.
--
-- Multi-entreprises dès la conception (rubrique 3 du cahier des charges) :
-- chaque table porte entreprise_id et la RLS empêche toute fuite entre
-- entreprises. Il n'y en a qu'une aujourd'hui, mais c'est gratuit maintenant
-- et impossible à rattraper proprement plus tard.
-- =============================================================================

drop view  if exists v_fiche_pose cascade;
drop table if exists rattachement cascade;
drop table if exists document_vigilance cascade;
drop table if exists document cascade;
drop table if exists equipement cascade;
drop table if exists intervention cascade;
drop table if exists chantier cascade;
drop table if exists fil cascade;
drop table if exists devis_ligne cascade;
drop table if exists devis_lot cascade;
drop table if exists devis cascade;
drop table if exists demande cascade;
drop table if exists site cascade;
drop table if exists tiers cascade;
drop table if exists gabarit cascade;
drop table if exists produit cascade;
drop table if exists parametres cascade;
drop table if exists compteur cascade;
drop table if exists membre cascade;
drop table if exists entreprise cascade;
drop function if exists mon_entreprise() cascade;
drop function if exists mon_role() cascade;
drop function if exists voit_les_prix() cascade;
drop function if exists prochain_numero(text) cascade;

-- -----------------------------------------------------------------------------
-- 1. Entreprises, membres et rôles
-- -----------------------------------------------------------------------------

create table entreprise (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null,
  -- Code court que la direction communique à ses salariés et sous-traitants
  -- pour qu'ils rejoignent l'entreprise depuis l'écran d'inscription.
  code_invitation text not null unique
                  default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
  created_at  timestamptz not null default now()
);

create table membre (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  nom           text not null,
  role          text not null default 'direction'
                check (role in ('direction','chef_chantier','technicien','sous_traitant')),
  aptitude_fluides_num       text,
  aptitude_fluides_expire_le date,
  actif         boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (user_id, entreprise_id)
);

create index on membre (user_id);

-- Fonctions d'aide utilisées par toutes les politiques RLS.
-- SECURITY DEFINER : elles lisent `membre` sans déclencher la RLS, ce qui
-- évite une récursion infinie dans les politiques.
create or replace function mon_entreprise()
returns uuid language sql stable security definer set search_path = public as $$
  select entreprise_id from membre where user_id = auth.uid() and actif limit 1
$$;

create or replace function mon_role()
returns text language sql stable security definer set search_path = public as $$
  select role from membre where user_id = auth.uid() and actif limit 1
$$;

-- Qui a le droit de voir un prix, un coût ou une marge.
create or replace function voit_les_prix()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(mon_role() in ('direction','chef_chantier'), false)
$$;

-- -----------------------------------------------------------------------------
-- 2. Paramètres et numérotation
-- -----------------------------------------------------------------------------

create table parametres (
  entreprise_id         uuid primary key references entreprise(id) on delete cascade,
  raison_sociale        text not null default 'PILOTECH',
  forme_juridique       text default 'SASU au capital de 1 000 €',
  siret                 text default '824 603 278',
  rcs                   text default 'RCS de Créteil',
  code_ape              text default '7490B',
  tva_intracom          text default 'FR28824603278',
  adresse               text default '14 RUE DE CHAMPIGNY',
  code_postal           text default '94370',
  ville                 text default 'SUCY EN BRIE',
  telephone             text default '01 85 44 12 53',
  portable              text default '06 60 77 11 63',
  email                 text default 'fabrice.pilotech@gmail.com',
  site_web              text default 'pilotech.eu',
  iban                  text default 'FR76 1751 5900 0008 0104 8471 603',

  -- Mention décennale : incomplète sur les devis actuels
  assureur_nom          text default 'APRIL',
  assureur_adresse      text default '[À COMPLÉTER — adresse de l''assureur]',
  assureur_police       text default '20113059904',
  assureur_couverture   text default 'France métropolitaine',

  -- Mentions absentes des devis actuels
  mediateur_nom         text default '[À COMPLÉTER — médiateur de la consommation]',
  mediateur_url         text default '',
  delai_execution       text default 'Début des travaux sous 4 semaines à compter de l''encaissement de l''acompte. Durée prévisionnelle indiquée au devis, sous réserve de disponibilité du matériel.',
  mention_retractation  text default 'Contrat conclu à distance : vous disposez d''un délai de quatorze jours pour exercer votre droit de rétractation à compter de la conclusion du contrat. Le formulaire de rétractation figure en dernière page.',
  afficher_retractation boolean not null default true,

  attestation_capacite  text default '',
  rge_qualification     text default '',
  conditions_generales  text default '',
  logo_data_url         text,
  updated_at            timestamptz not null default now()
);

create table compteur (
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  type          text not null,
  annee         int  not null,
  dernier       int  not null default 0,
  primary key (entreprise_id, type, annee)
);

-- Numérotation continue et sans rupture. Pas de sequence : elle laisse des trous
-- en cas de rollback, et une facturation à numérotation discontinue est irrégulière.
create or replace function prochain_numero(p_type text)
returns text language plpgsql security definer set search_path = public as $$
declare
  e uuid := mon_entreprise();
  a int  := extract(year from current_date);
  n int;
  prefixe text := case p_type
                    when 'devis' then 'DEV'
                    when 'facture' then 'FAC'
                    when 'chantier' then 'CHA'
                    else upper(left(p_type, 3)) end;
begin
  if e is null then
    raise exception 'Aucune entreprise rattachée à cet utilisateur.';
  end if;
  insert into compteur (entreprise_id, type, annee) values (e, p_type, a)
    on conflict (entreprise_id, type, annee) do nothing;
  update compteur set dernier = dernier + 1
    where entreprise_id = e and type = p_type and annee = a
    returning dernier into n;
  return prefixe || '-' || a || '/' || lpad(extract(month from current_date)::text, 2, '0')
         || '-' || lpad(n::text, 4, '0');
end $$;

-- -----------------------------------------------------------------------------
-- 3. Catalogue et gabarits
-- -----------------------------------------------------------------------------

create table produit (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  reference     text not null,
  designation   text not null,
  description   text,
  famille       text not null,
  nature        text not null default 'fourniture'
                check (nature in ('fourniture','pose','deplacement')),
  unite         text not null default 'U',

  -- Critères d'éligibilité au taux de 5,5 %
  puissance_kw  numeric(6,2),
  classe_froid  text,
  classe_chaud  text,
  fluide        text,
  fixe          boolean,
  reversible    boolean,
  connecte      boolean,

  prix_achat_ht numeric(12,2),
  coefficient   numeric(6,3),
  prix_vente_ht numeric(12,2) not null,
  actif         boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (entreprise_id, reference)
);

create index on produit (entreprise_id, famille);

create table gabarit (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  nom           text not null,
  description   text,
  sous_lots     jsonb not null default '[]'::jsonb,
  position      int not null default 0,
  actif         boolean not null default true
);

-- -----------------------------------------------------------------------------
-- 4. Clients, sites, demandes
-- -----------------------------------------------------------------------------

create table tiers (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  type          text not null default 'particulier'
                check (type in ('particulier','professionnel')),
  categorie     text not null default 'client'
                check (categorie in ('prospect','client','fournisseur','sous_traitant')),
  nom           text not null,
  email         text,
  telephone     text,
  adresse       text,
  code_postal   text,
  ville         text,
  siret         text,
  notes         text,
  created_at    timestamptz not null default now()
);

create index on tiers (entreprise_id, telephone);
create index on tiers (entreprise_id, email);

create table site (
  id                    uuid primary key default gen_random_uuid(),
  entreprise_id         uuid not null references entreprise(id) on delete cascade,
  tiers_id              uuid not null references tiers(id) on delete cascade,
  adresse               text not null,
  code_postal           text,
  ville                 text,
  usage_local           text not null default 'habitation'
                        check (usage_local in ('habitation','mixte','professionnel')),
  annee_achevement      int,
  en_copropriete        boolean default false,
  accord_copro          boolean default false,
  declaration_prealable text default 'sans_objet'
                        check (declaration_prealable in ('sans_objet','a_deposer','deposee','accordee')),
  contraintes_acces     text,
  notes                 text,
  created_at            timestamptz not null default now()
);

create table demande (
  id                 uuid primary key default gen_random_uuid(),
  entreprise_id      uuid not null references entreprise(id) on delete cascade,
  source             text not null default 'telephone',
  source_ref         text,
  recu_le            timestamptz not null default now(),
  nom                text,
  telephone          text,
  email              text,
  adresse            text,
  besoin             text,
  resume             text,
  transcription      text,
  enregistrement_url text,
  duree_secondes     int,
  urgence            text default 'projet' check (urgence in ('panne','saison','projet')),
  necessite_visite   boolean,
  statut             text not null default 'nouvelle'
                     check (statut in ('nouvelle','a_rappeler','qualifiee','a_visiter','devisee','perdue','spam')),
  -- Le cœur du besoin CRM : à qui ai-je répondu, et qui attend encore ?
  repondu            boolean not null default false,
  repondu_le         timestamptz,
  rappeler_le        date,
  motif_perte        text,
  tiers_id           uuid references tiers(id) on delete set null,
  created_at         timestamptz not null default now()
);

-- Idempotence des webhooks : Allo rejoue ses appels, Gmail aussi.
create unique index on demande (entreprise_id, source, source_ref) where source_ref is not null;
create index on demande (entreprise_id, statut, recu_le desc);

-- -----------------------------------------------------------------------------
-- 5. Fil d'activité — le CRM
-- Appels, e-mails, notes et événements, tous rattachés au bon tiers.
-- C'est ce qui répond à « à qui ai-je répondu ? ».
-- -----------------------------------------------------------------------------

create table fil (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  tiers_id      uuid references tiers(id) on delete cascade,
  demande_id    uuid references demande(id) on delete cascade,
  chantier_id   uuid,
  devis_id      uuid,
  type          text not null check (type in ('appel_entrant','appel_manque','appel_sortant',
                'email_recu','email_envoye','sms','note','visite','devis_envoye','devis_signe',
                'relance','systeme')),
  sujet         text,
  contenu       text,
  auteur        text,
  source        text,
  source_ref    text,
  a_traiter     boolean not null default false,
  traite_le     timestamptz,
  occurred_at   timestamptz not null default now(),
  metadonnees   jsonb,
  created_at    timestamptz not null default now()
);

create unique index on fil (entreprise_id, source, source_ref) where source_ref is not null;
create index on fil (entreprise_id, tiers_id, occurred_at desc);
create index on fil (entreprise_id, occurred_at desc) where a_traiter;

-- -----------------------------------------------------------------------------
-- 6. Devis
-- -----------------------------------------------------------------------------

create table devis (
  id                uuid primary key default gen_random_uuid(),
  entreprise_id     uuid not null references entreprise(id) on delete cascade,
  numero            text not null,
  statut            text not null default 'brouillon'
                    check (statut in ('brouillon','envoye','relance','signe','refuse','expire')),
  tiers_id          uuid references tiers(id) on delete set null,
  site_id           uuid references site(id) on delete set null,
  demande_id        uuid references demande(id) on delete set null,
  date_emission     date not null default current_date,
  validite_jours    int not null default 60,
  titre             text,
  intro             text,
  resume_materiel   text,
  type_prestation   text not null default 'installation'
                    check (type_prestation in ('installation','entretien','depannage','mise_en_service')),
  entreprise_rge    boolean not null default true,
  remise_montant    numeric(12,2) default 0,
  remise_libelle    text default 'Remise exceptionnelle',
  marge_mode        text default 'aucune' check (marge_mode in ('aucune','pourcentage','montant')),
  marge_valeur      numeric(12,2) default 0,
  marge_cible_ligne uuid,
  echeancier        jsonb default '[]'::jsonb,

  -- Envoi, signature, rétractation
  envoye_le                timestamptz,
  signe_le                 timestamptz,
  mode_conclusion          text default 'distance'
                           check (mode_conclusion in ('distance','hors_etablissement','etablissement')),
  retractation_fin_le      date,
  encaissement_autorise_le date,
  relance_prochaine_le     date,

  notes_internes    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (entreprise_id, numero)
);

create table devis_lot (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  devis_id      uuid not null references devis(id) on delete cascade,
  parent_id     uuid references devis_lot(id) on delete cascade,
  position      int not null default 0,
  titre         text not null,
  created_at    timestamptz not null default now()
);

create index on devis_lot (devis_id, parent_id, position);

create table devis_ligne (
  id                uuid primary key default gen_random_uuid(),
  entreprise_id     uuid not null references entreprise(id) on delete cascade,
  devis_id          uuid not null references devis(id) on delete cascade,
  lot_id            uuid not null references devis_lot(id) on delete cascade,
  position          int not null default 0,
  produit_id        uuid references produit(id) on delete set null,
  designation       text not null,
  description       text,
  nature            text not null default 'fourniture'
                    check (nature in ('fourniture','pose','deplacement')),
  unite             text not null default 'U',
  quantite          numeric(10,3) not null default 1,
  prix_unitaire_ht  numeric(12,2) not null default 0,
  remise_pct        numeric(5,2) not null default 0,
  prix_achat_ht     numeric(12,2),
  taux_tva          numeric(5,2) not null default 20,
  taux_force        boolean not null default false,
  justification_tva jsonb,
  -- Consignes de pose : visibles des techniciens, sans les prix
  consigne_pose     text,
  emplacement       text,
  created_at        timestamptz not null default now()
);

create index on devis_ligne (devis_id, lot_id, position);

-- -----------------------------------------------------------------------------
-- 7. Chantiers, interventions, matériel
-- -----------------------------------------------------------------------------

create table chantier (
  id                 uuid primary key default gen_random_uuid(),
  entreprise_id      uuid not null references entreprise(id) on delete cascade,
  numero             text not null,
  devis_id           uuid references devis(id) on delete set null,
  tiers_id           uuid not null references tiers(id) on delete cascade,
  site_id            uuid references site(id) on delete set null,
  libelle            text not null,
  statut             text not null default 'a_planifier'
                     check (statut in ('a_planifier','bloque','planifie','en_cours','a_receptionner','receptionne','sav')),
  -- Verrous avant planification : accord copro, DP mairie, matériel, acompte…
  checklist          jsonb not null default '{}'::jsonb,
  date_debut         date,
  date_fin           date,
  date_reception     date,
  reserves           jsonb default '[]'::jsonb,
  reserves_levees_le date,
  notes              text,
  created_at         timestamptz not null default now(),
  unique (entreprise_id, numero)
);

create table intervention (
  id                  uuid primary key default gen_random_uuid(),
  entreprise_id       uuid not null references entreprise(id) on delete cascade,
  chantier_id         uuid references chantier(id) on delete cascade,
  tiers_id            uuid references tiers(id) on delete set null,
  type                text not null default 'pose'
                      check (type in ('visite_technique','pose','mise_en_service','sav','entretien','controle_etancheite')),
  date_prevue         date,
  debut_le            timestamptz,
  fin_le              timestamptz,
  membre_id           uuid references membre(id) on delete set null,
  sous_traitant_id    uuid references tiers(id) on delete set null,
  statut              text not null default 'planifiee'
                      check (statut in ('planifiee','en_cours','terminee','annulee','reportee')),
  compte_rendu        text,
  -- Fiche fluides frigorigènes : obligation réglementaire, sanctions pénales
  fluide              text,
  charge_kg           numeric(8,3),
  recuperee_kg        numeric(8,3),
  controle_etancheite boolean default false,
  resultat_etancheite text,
  created_at          timestamptz not null default now(),
  constraint un_seul_executant check (membre_id is null or sous_traitant_id is null)
);

create index on intervention (entreprise_id, date_prevue);

create table equipement (
  id                    uuid primary key default gen_random_uuid(),
  entreprise_id         uuid not null references entreprise(id) on delete cascade,
  site_id               uuid references site(id) on delete cascade,
  chantier_id           uuid references chantier(id) on delete set null,
  produit_id            uuid references produit(id) on delete set null,
  marque                text,
  modele                text,
  numero_serie          text,
  emplacement           text,
  mise_en_service_le    date,
  fluide                text,
  charge_kg             numeric(8,3),
  garantie_fin          date,
  prochain_entretien_le date,
  photo_plaque_url      text,
  statut                text not null default 'actif'
                        check (statut in ('actif','depose','remplace')),
  created_at            timestamptz not null default now()
);

create index on equipement (entreprise_id, prochain_entretien_le);

-- -----------------------------------------------------------------------------
-- 8. Documents et vigilance sous-traitants
-- -----------------------------------------------------------------------------

create table document (
  id              uuid primary key default gen_random_uuid(),
  entreprise_id   uuid not null references entreprise(id) on delete cascade,
  tiers_id        uuid references tiers(id) on delete cascade,
  chantier_id     uuid references chantier(id) on delete cascade,
  intervention_id uuid references intervention(id) on delete cascade,
  devis_id        uuid references devis(id) on delete cascade,
  type            text not null default 'autre',
  nom             text not null,
  url             text,
  dropbox_path    text,
  prise_le        timestamptz,
  latitude        double precision,
  longitude       double precision,
  created_at      timestamptz not null default now()
);

create table document_vigilance (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  tiers_id      uuid not null references tiers(id) on delete cascade,
  type          text not null check (type in ('attestation_urssaf','kbis','decennale','rc_pro',
                'attestation_capacite_fluides','liste_salaries_etrangers','rib','autre')),
  emis_le       date,
  expire_le     date,
  url           text,
  conforme      boolean default true,
  created_at    timestamptz not null default now()
);

create index on document_vigilance (entreprise_id, tiers_id, expire_le);

-- -----------------------------------------------------------------------------
-- 9. Fiche de pose : le devis sans les prix
--
-- Vue en SECURITY DEFINER : les colonnes de prix ne descendent jamais dans le
-- navigateur d'un technicien. Les masquer dans l'interface ne suffirait pas,
-- les données seraient quand même dans la base locale de son téléphone.
-- -----------------------------------------------------------------------------

create view v_fiche_pose with (security_invoker = false) as
select
  l.id, l.entreprise_id, l.devis_id, l.lot_id, l.position,
  l.designation, l.description, l.nature, l.unite, l.quantite,
  l.consigne_pose, l.emplacement,
  pr.reference
from devis_ligne l
left join produit pr on pr.id = l.produit_id
where l.entreprise_id = mon_entreprise();

-- -----------------------------------------------------------------------------
-- 10. RLS
-- -----------------------------------------------------------------------------

alter table entreprise enable row level security;
create policy acces on entreprise for select to authenticated
  using (id = mon_entreprise());

alter table membre enable row level security;
create policy lecture on membre for select to authenticated
  using (entreprise_id = mon_entreprise() or user_id = auth.uid());
create policy administration on membre for all to authenticated
  using (entreprise_id = mon_entreprise() and mon_role() = 'direction')
  with check (entreprise_id = mon_entreprise() and mon_role() = 'direction');

-- Ouvert à tous les membres de l'entreprise
do $$
declare t text;
begin
  foreach t in array array['tiers','site','demande','fil','chantier','intervention',
                           'equipement','document','produit','gabarit','compteur']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy acces on %I for all to authenticated
                    using (entreprise_id = mon_entreprise())
                    with check (entreprise_id = mon_entreprise())', t);
  end loop;
end $$;

-- Réservé à ceux qui ont le droit de voir les prix
do $$
declare t text;
begin
  foreach t in array array['devis','devis_lot','devis_ligne','parametres','document_vigilance']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy acces on %I for all to authenticated
                    using (entreprise_id = mon_entreprise() and voit_les_prix())
                    with check (entreprise_id = mon_entreprise() and voit_les_prix())', t);
  end loop;
end $$;

grant select on v_fiche_pose to authenticated;
