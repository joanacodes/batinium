-- =============================================================================
-- BATINIUM — 20. Facturation
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 19.
-- Rejouable.
--
-- Le plus gros trou du projet. Jusqu'ici : demande, devis, chantier,
-- procès-verbal, échéances d'encaissement — et aucune facture émise nulle
-- part. Une échéance n'est pas une facture : elle ne porte ni numéro, ni
-- mentions légales, ni TVA collectée, et ne se remet pas au client.
--
-- Deux règles de droit commandent tout le reste :
--   la numérotation est continue et chronologique, sans trou ;
--   une facture émise ne se modifie plus, elle s'annule par un avoir.
-- Elles sont tenues par la base, pas par l'interface.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. La facture
--
-- `numero` est nul tant que la facture est un brouillon, et c'est délibéré.
-- Si un brouillon prenait un numéro puis était supprimé, la série aurait un
-- trou — exactement ce que l'administration regarde. Le numéro s'attribue
-- donc à l'émission, en une seule opération, et jamais avant.
-- -----------------------------------------------------------------------------

create table if not exists facture (
  id                  uuid primary key default gen_random_uuid(),
  entreprise_id       uuid not null references entreprise(id) on delete cascade,
  numero              text,
  type                text not null default 'facture'
                      check (type in ('acompte','situation','solde','facture','avoir')),
  statut              text not null default 'brouillon'
                      check (statut in ('brouillon','emise','payee','annulee')),

  devis_id            uuid references devis(id) on delete set null,
  chantier_id         uuid references chantier(id) on delete set null,
  tiers_id            uuid references tiers(id) on delete set null,
  site_id             uuid references site(id) on delete set null,
  -- Un avoir désigne la facture qu'il corrige. Sans ce lien, un avoir est un
  -- document isolé que personne ne sait rattacher.
  facture_origine_id  uuid references facture(id) on delete set null,

  titre               text,
  intro               text,
  date_emission       date not null default current_date,
  echeance_le         date,
  remise_montant      numeric(12,2) not null default 0,
  remise_libelle      text,
  -- Ce qui a déjà été facturé en acompte et se déduit du solde.
  acompte_deduit      numeric(12,2) not null default 0,

  notes_internes      text,
  emise_le            timestamptz,
  payee_le            date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (entreprise_id, numero)
);

create index if not exists facture_chantier_idx on facture (entreprise_id, chantier_id);
create index if not exists facture_tiers_idx    on facture (entreprise_id, tiers_id);
create index if not exists facture_date_idx     on facture (entreprise_id, date_emission desc);

comment on column facture.numero is
  'Nul tant que brouillon. Attribué à l''émission pour que la série reste continue.';

create table if not exists facture_ligne (
  id                uuid primary key default gen_random_uuid(),
  entreprise_id     uuid not null references entreprise(id) on delete cascade,
  facture_id        uuid not null references facture(id) on delete cascade,
  position          int  not null default 0,
  produit_id        uuid references produit(id) on delete set null,
  devis_ligne_id    uuid references devis_ligne(id) on delete set null,
  designation       text not null,
  description       text,
  unite             text not null default 'U',
  quantite          numeric(12,3) not null default 1,
  prix_unitaire_ht  numeric(12,2) not null default 0,
  remise_pct        numeric(5,2)  not null default 0,
  taux_tva          numeric(4,1)  not null default 20,
  -- La justification du moteur de TVA, recopiée du devis et figée : le taux
  -- appliqué doit rester explicable des années plus tard, même si la règle
  -- ou le catalogue ont changé depuis.
  justification_tva jsonb
);

create index if not exists facture_ligne_idx on facture_ligne (facture_id, position);


-- -----------------------------------------------------------------------------
-- 2. Le lien avec les encaissements
--
-- Les échéances existent déjà et sont rattachées au devis. Elles pointent
-- maintenant aussi vers la facture qui les appelle : c'est ce qui permet de
-- dire « cette facture est payée » sans ressaisir un montant.
-- -----------------------------------------------------------------------------

alter table encaissement
  add column if not exists facture_id uuid references facture(id) on delete set null;

create index if not exists encaissement_facture_idx on encaissement (facture_id)
  where facture_id is not null;


-- -----------------------------------------------------------------------------
-- 3. Une facture émise ne bouge plus
--
-- Écrit en trigger et non en politique : la RLS dit qui a le droit d'écrire,
-- pas ce qui a le droit de changer. Seuls le règlement et l'annulation
-- comptable restent modifiables après émission — le reste est figé, y compris
-- pour la direction, y compris depuis l'éditeur SQL de Supabase.
-- -----------------------------------------------------------------------------

create or replace function facture_verrou()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.statut <> 'brouillon' then
      raise exception
        'La facture % est émise : elle ne se supprime pas. Émettez un avoir.', old.numero;
    end if;
    return old;
  end if;

  if old.statut <> 'brouillon' then
    if (new.numero, new.type, new.date_emission, new.tiers_id, new.site_id,
        new.titre, new.intro, new.remise_montant, new.remise_libelle,
        new.acompte_deduit, new.devis_id, new.chantier_id)
       is distinct from
       (old.numero, old.type, old.date_emission, old.tiers_id, old.site_id,
        old.titre, old.intro, old.remise_montant, old.remise_libelle,
        old.acompte_deduit, old.devis_id, old.chantier_id)
    then
      raise exception
        'La facture % est émise : son contenu ne peut plus changer. Émettez un avoir.',
        old.numero;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists facture_verrou_trg on facture;
create trigger facture_verrou_trg
  before update or delete on facture
  for each row execute function facture_verrou();

-- Les lignes suivent le sort de leur facture.
create or replace function facture_ligne_verrou()
returns trigger language plpgsql as $$
declare v_statut text; v_numero text;
begin
  select statut, numero into v_statut, v_numero
    from facture where id = coalesce(new.facture_id, old.facture_id);
  if v_statut is distinct from 'brouillon' then
    raise exception
      'La facture % est émise : ses lignes ne peuvent plus changer.', coalesce(v_numero, '(sans numéro)');
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists facture_ligne_verrou_trg on facture_ligne;
create trigger facture_ligne_verrou_trg
  before insert or update or delete on facture_ligne
  for each row execute function facture_ligne_verrou();


-- -----------------------------------------------------------------------------
-- 4. L'émission
--
-- Numéro et changement d'état en une seule opération, côté serveur. Deux
-- personnes qui cliquent en même temps ne peuvent pas obtenir le même numéro :
-- c'est `prochain_numero` qui tranche, et il ne recule jamais.
-- -----------------------------------------------------------------------------

create or replace function emettre_facture(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_statut text; v_numero text; v_lignes int;
begin
  select statut into v_statut
    from facture where id = p_id and entreprise_id = mon_entreprise();
  if v_statut is null then raise exception 'Facture introuvable.'; end if;
  if v_statut <> 'brouillon' then raise exception 'Cette facture est déjà émise.'; end if;

  select count(*) into v_lignes from facture_ligne where facture_id = p_id;
  if v_lignes = 0 then raise exception 'Une facture sans ligne ne s''émet pas.'; end if;

  v_numero := prochain_numero('facture');
  update facture
     set numero = v_numero, statut = 'emise', emise_le = now()
   where id = p_id;
  return v_numero;
end $$;


-- -----------------------------------------------------------------------------
-- 5. Droits : comme le devis, réservé à qui voit les prix
-- -----------------------------------------------------------------------------

do $$
declare t text; p record;
begin
  foreach t in array array['facture','facture_ligne']
  loop
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
    execute format('alter table %I enable row level security', t);
    execute format('create policy acces on %I for all to authenticated
                    using (entreprise_id = mon_entreprise() and voit_les_prix())
                    with check (entreprise_id = mon_entreprise() and voit_les_prix())', t);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 6. Vérification
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'facture_verrou_trg') then
    raise exception 'Le verrou des factures n''est pas posé.';
  end if;
  raise notice 'SQL 20 appliqué. Facturation créée, numérotation à l''émission, factures émises verrouillées.';
end $$;
