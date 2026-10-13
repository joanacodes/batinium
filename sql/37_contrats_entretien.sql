-- =============================================================================
-- BATINIUM — 37. Contrats d'entretien, et le préavis de chacun
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase. Rejouable.
-- Ne touche qu'aux tables du SQL 01 : indépendant des SQL 32 et 33.
--
-- Les devis de Pilotech vendent des contrats d'entretien (485 € HT par an
-- chez Freguia, 250 € HT la visite chez Malher), et rien ne s'en souvenait.
-- Un entretien oublié, c'est une garantie constructeur qui tombe — elle est
-- presque toujours conditionnée à un entretien annuel — et un client qui
-- appelle en panne le premier jour de chaleur.
--
-- Trois choses :
--   1. le contrat, avec sa périodicité et sa prochaine échéance ;
--   2. l'échéance qui avance d'elle-même quand la visite est faite, sans que
--      personne n'ait à y penser ;
--   3. le préavis : chacun choisit combien de temps avant l'échéance il veut
--      être prévenu — Fabrice un mois pour caler la tournée, un autre une
--      semaine. La cloche lit ce réglage ; elle ne stocke rien d'autre.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Le contrat
--
-- Rattaché au client, et au site ou au chantier d'origine quand on les
-- connaît : c'est le chantier qui porte l'adresse, les machines posées et
-- l'historique, et l'entretien planifié s'y rattachera.
--
-- Il porte un prix : il n'est donc lisible que de ceux qui voient les prix
-- (règle 7). Le technicien n'en a pas besoin — il voit l'intervention
-- d'entretien qu'on lui affecte, comme toute autre.
-- -----------------------------------------------------------------------------

create table if not exists contrat_entretien (
  id                 uuid primary key default gen_random_uuid(),
  entreprise_id      uuid not null references entreprise(id) on delete cascade,
  tiers_id           uuid not null references tiers(id) on delete cascade,
  site_id            uuid references site(id) on delete set null,
  chantier_id        uuid references chantier(id) on delete set null,
  libelle            text not null default 'Entretien annuel',
  periodicite_mois   integer not null default 12 check (periodicite_mois between 1 and 60),
  prochaine_echeance date not null,
  debut_le           date not null default current_date,
  fin_le             date,
  prix_ht            numeric(10,2) check (prix_ht >= 0),
  statut             text not null default 'actif'
                     check (statut in ('actif', 'suspendu', 'resilie')),
  notes              text,
  created_at         timestamptz not null default now(),
  check (fin_le is null or fin_le >= debut_le)
);

create index if not exists contrat_entretien_echeance_idx
  on contrat_entretien (entreprise_id, prochaine_echeance) where statut = 'actif';
create index if not exists contrat_entretien_tiers_idx
  on contrat_entretien (entreprise_id, tiers_id);

comment on table contrat_entretien is
  'Contrats d''entretien vendus aux clients. L''échéance avance seule quand la visite rattachée est terminée.';

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'contrat_entretien'
  loop
    execute format('drop policy %I on contrat_entretien', p.policyname);
  end loop;
end $$;

alter table contrat_entretien enable row level security;

create policy acces on contrat_entretien for all to authenticated
  using (entreprise_id = mon_entreprise() and voit_les_prix())
  with check (entreprise_id = mon_entreprise() and voit_les_prix());


-- -----------------------------------------------------------------------------
-- 2. La visite qui honore une échéance
--
-- `echeance_honoree` garde l'échéance qu'une intervention a soldée. Elle sert
-- de verrou : une intervention repassée « en cours » puis « terminée » par
-- erreur ne fait pas sauter une année de plus.
--
-- La nouvelle échéance se compte depuis l'ancienne, de période en période,
-- jusqu'à dépasser la date de la visite :
-- - une visite faite en avance garde la date anniversaire du contrat ;
-- - une visite faite en retard ne produit pas une échéance déjà dépassée.
-- Chaque échéance se calcule depuis la même date d'origine, et non en
-- ajoutant un mois au précédent : un contrat commencé un 31 ne glisse pas
-- au 28, puis au 28 pour toujours.
--
-- La fonction est définie par son propriétaire : c'est le technicien qui
-- clôt la visite, et il n'a pas le droit de lire le contrat (il porte un
-- prix). Elle ne touche qu'au contrat que l'intervention désigne, dans la
-- même entreprise.
-- -----------------------------------------------------------------------------

alter table intervention
  add column if not exists contrat_id       uuid references contrat_entretien(id) on delete set null,
  add column if not exists echeance_honoree date;

create index if not exists intervention_contrat_idx
  on intervention (entreprise_id, contrat_id) where contrat_id is not null;

create or replace function intervention_honorer_contrat()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_contrat contrat_entretien;
  v_visite  date;
begin
  if new.contrat_id is null or new.statut <> 'terminee' or new.echeance_honoree is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.statut = 'terminee' then
    return new;
  end if;

  select * into v_contrat from contrat_entretien
   where id = new.contrat_id and entreprise_id = new.entreprise_id and statut = 'actif'
   for update;
  if not found then
    return new;
  end if;

  v_visite := coalesce((new.fin_le at time zone 'Europe/Paris')::date,
                       (now() at time zone 'Europe/Paris')::date);
  new.echeance_honoree := v_contrat.prochaine_echeance;

  update contrat_entretien
     set prochaine_echeance = (
       select (v_contrat.prochaine_echeance
               + make_interval(months => v_contrat.periodicite_mois * k))::date
         from generate_series(1, 1200) k
        where (v_contrat.prochaine_echeance
               + make_interval(months => v_contrat.periodicite_mois * k))::date > v_visite
        order by k
        limit 1)
   where id = v_contrat.id;

  return new;
end $$;

drop trigger if exists intervention_honorer_contrat_trg on intervention;
create trigger intervention_honorer_contrat_trg
  before insert or update of statut, contrat_id on intervention
  for each row execute function intervention_honorer_contrat();


-- -----------------------------------------------------------------------------
-- 3. Le préavis de chacun
--
-- En jours, de 0 à 365 ; l'écran propose des durées lisibles (une semaine,
-- un mois…). Réglable par chacun pour lui-même seulement : la table `membre`
-- n'est modifiable que par la direction, d'où la fonction.
-- -----------------------------------------------------------------------------

alter table membre
  add column if not exists preavis_entretien_jours integer not null default 30;

alter table membre drop constraint if exists membre_preavis_entretien_check;
alter table membre add constraint membre_preavis_entretien_check
  check (preavis_entretien_jours between 0 and 365);

comment on column membre.preavis_entretien_jours is
  'Combien de jours avant une échéance d''entretien ce membre veut être prévenu. Réglé par lui-même.';

create or replace function regler_preavis_entretien(p_jours integer)
returns integer language plpgsql security definer set search_path = public as $$
begin
  if p_jours is null or p_jours < 0 or p_jours > 365 then
    raise exception 'Le préavis se compte entre 0 et 365 jours.';
  end if;
  update membre set preavis_entretien_jours = p_jours
   where user_id = auth.uid() and actif;
  if not found then
    raise exception 'Aucun membre actif pour cette session.';
  end if;
  return p_jours;
end $$;

revoke all on function regler_preavis_entretien(integer) from public, anon;
grant execute on function regler_preavis_entretien(integer) to authenticated;


-- -----------------------------------------------------------------------------
-- 4. Vérification
--
-- Rejouée pour de vrai : un contrat, une visite en avance, la même visite
-- rouverte puis refermée, une visite très en retard. Puis, s'il y a un
-- technicien, les droits : il ne lit pas le contrat, mais sa clôture de
-- visite fait bien avancer l'échéance ; il règle son propre préavis. Bloc
-- annulé à la fin.
-- -----------------------------------------------------------------------------

do $$
declare
  v_direction membre; v_poseur membre; v_ent uuid; v_tiers uuid; v_chantier uuid;
  v_contrat uuid; v_inter uuid; v_due date; v_n integer; v_refus boolean;
  v_echecs text[] := '{}';
begin
  select m.* into v_direction from membre m
   where m.actif and m.role = 'direction' order by m.created_at limit 1;
  if v_direction.id is null then
    raise notice 'Aucun membre de direction : vérification sautée.';
    return;
  end if;
  v_ent := v_direction.entreprise_id;
  select m.* into v_poseur from membre m
   where m.actif and m.entreprise_id = v_ent and m.role in ('technicien', 'sous_traitant')
   order by m.created_at limit 1;

  begin
    insert into tiers (entreprise_id, nom) values (v_ent, 'Essai SQL 37') returning id into v_tiers;
    insert into chantier (entreprise_id, numero, tiers_id, libelle)
    values (v_ent, 'ESSAI-37', v_tiers, 'Vérification SQL 37') returning id into v_chantier;

    -- Visite faite dix jours avant l'échéance : on garde l'anniversaire.
    v_due := current_date + 10;
    insert into contrat_entretien (entreprise_id, tiers_id, chantier_id, prochaine_echeance, periodicite_mois)
    values (v_ent, v_tiers, v_chantier, v_due, 12) returning id into v_contrat;
    insert into intervention (entreprise_id, chantier_id, type, contrat_id, date_prevue)
    values (v_ent, v_chantier, 'entretien', v_contrat, current_date) returning id into v_inter;
    update intervention set statut = 'terminee', fin_le = now() where id = v_inter;
    if (select prochaine_echeance from contrat_entretien where id = v_contrat)
       <> (v_due + interval '12 months')::date then
      v_echecs := array_append(v_echecs, 'une visite en avance n''a pas gardé la date anniversaire');
    end if;
    if (select echeance_honoree from intervention where id = v_inter) <> v_due then
      v_echecs := array_append(v_echecs, 'l''intervention ne dit pas quelle échéance elle a soldée');
    end if;

    -- La même visite rouverte puis refermée : rien ne bouge.
    update intervention set statut = 'en_cours' where id = v_inter;
    update intervention set statut = 'terminee' where id = v_inter;
    if (select prochaine_echeance from contrat_entretien where id = v_contrat)
       <> (v_due + interval '12 months')::date then
      v_echecs := array_append(v_echecs, 'une visite refermée deux fois a fait avancer l''échéance deux fois');
    end if;

    -- Visite faite avec plus d'un an de retard : l'échéance suivante est à venir.
    update contrat_entretien set prochaine_echeance = current_date - 400 where id = v_contrat;
    insert into intervention (entreprise_id, chantier_id, type, contrat_id, statut, fin_le)
    values (v_ent, v_chantier, 'entretien', v_contrat, 'terminee', now());
    select prochaine_echeance into v_due from contrat_entretien where id = v_contrat;
    if v_due <= current_date or v_due > current_date + 365 then
      v_echecs := array_append(v_echecs, format('après une visite en retard, l''échéance est le %s', v_due));
    end if;

    if v_poseur.id is not null then
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_poseur.user_id, 'role', 'authenticated')::text, true);
      set local role authenticated;

      select count(*) into v_n from contrat_entretien where id = v_contrat;
      if v_n <> 0 then
        v_echecs := array_append(v_echecs, 'un technicien lit un contrat, prix compris');
      end if;

      insert into intervention (entreprise_id, chantier_id, type, contrat_id, date_prevue, membre_id)
      values (v_ent, v_chantier, 'entretien', v_contrat, current_date, v_poseur.id)
      returning id into v_inter;
      update intervention set statut = 'terminee', fin_le = now() where id = v_inter;

      if regler_preavis_entretien(15) <> 15 then
        v_echecs := array_append(v_echecs, 'le préavis n''a pas été réglé');
      end if;
      v_refus := false;
      begin
        perform regler_preavis_entretien(400);
      exception when raise_exception then v_refus := true;
      end;
      if not v_refus then
        v_echecs := array_append(v_echecs, 'un préavis de 400 jours a été accepté');
      end if;
      reset role;

      if (select prochaine_echeance from contrat_entretien where id = v_contrat) <= v_due then
        v_echecs := array_append(v_echecs, 'la visite close par un technicien n''a pas fait avancer l''échéance');
      end if;
      if (select preavis_entretien_jours from membre where id = v_poseur.id) <> 15 then
        v_echecs := array_append(v_echecs, 'le préavis réglé n''est pas celui du technicien');
      end if;
    else
      raise notice 'Aucun technicien : droits du terrain non éprouvés.';
    end if;

    raise exception using errcode = 'P0001', message = '__annulation_37__';
  exception when others then
    if sqlerrm <> '__annulation_37__' then raise; end if;
  end;

  if exists (select 1 from chantier where numero = 'ESSAI-37' and entreprise_id = v_ent) then
    v_echecs := array_append(v_echecs, 'la vérification a laissé des lignes en base');
  end if;

  if cardinality(v_echecs) > 0 then
    raise exception 'SQL 37 : vérification en échec — %', array_to_string(v_echecs, ' ; ');
  end if;
  raise notice 'SQL 37 appliqué. Contrats d''entretien en place, échéances qui avancent seules, préavis par personne.';
end $$;
