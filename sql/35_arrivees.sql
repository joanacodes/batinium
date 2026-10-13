-- =============================================================================
-- BATINIUM — 35. Heure d'arrivée et de départ sur le chantier, avec la position
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase. Rejouable.
-- Ne touche qu'aux tables du SQL 01 : indépendant des SQL 32 et 33.
--
-- Fabrice veut savoir quand ses salariés et ses sous-traitants arrivent chez
-- le client. Jusqu'ici, la seule trace était le bouton « Je commence » de Ma
-- journée, qui datait l'intervention : rien pour une journée sans intervention
-- planifiée, rien pour le départ, et une heure envoyée par le téléphone, donc
-- réglable à la main.
--
-- Une arrivée est maintenant une ligne à part, datée par le serveur, avec la
-- position du téléphone relevée UNE fois, au moment où l'on appuie. Jamais en
-- continu : la CNIL tient la géolocalisation permanente d'un salarié pour
-- disproportionnée, et une page web ne saurait d'ailleurs pas suivre quelqu'un
-- qui l'a fermée. La position sert à une chose : dire si l'arrivée a été notée
-- sur place, en la comparant à l'adresse du chantier.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Les coordonnées du site
--
-- Remplies par l'application quand une adresse est choisie dans les
-- suggestions de l'IGN, ou cherchées au premier pointage sur ce site. Sans
-- elles, l'arrivée est notée quand même, sans distance.
-- -----------------------------------------------------------------------------

alter table site
  add column if not exists latitude  double precision,
  add column if not exists longitude double precision;

alter table site drop constraint if exists site_coordonnees_check;
alter table site add constraint site_coordonnees_check
  check (latitude between -90 and 90 and longitude between -180 and 180);

comment on column site.latitude is
  'Position de l''adresse, d''après le géocodage de l''IGN. Sert à dire si une arrivée a été notée sur place.';


-- -----------------------------------------------------------------------------
-- 2. La distance entre deux points
--
-- Formule de haversine, sur une Terre sphérique : l'erreur, de l'ordre de
-- 0,5 %, est très en dessous de la précision d'un téléphone en ville.
-- -----------------------------------------------------------------------------

create or replace function distance_metres(
  p_lat1 double precision, p_lon1 double precision,
  p_lat2 double precision, p_lon2 double precision)
returns integer language sql immutable strict parallel safe as $$
  select round(2 * 6371000 * asin(sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
         + cos(radians(p_lat1)) * cos(radians(p_lat2))
           * power(sin(radians(p_lon2 - p_lon1) / 2), 2))))::integer
$$;


-- -----------------------------------------------------------------------------
-- 3. La présence
--
-- Une ligne par arrivée. Le départ la complète. `depart_auto` dit qu'un départ
-- n'a pas été noté et que la base l'a posé à l'arrivée suivante du même jour :
-- c'est une approximation, et l'écran le dit.
--
-- `sans_position` dit pourquoi une position manque : refus du téléphone, pas
-- de signal, délai dépassé. Un trou expliqué ne se lit pas comme une fraude.
-- -----------------------------------------------------------------------------

create table if not exists presence (
  id                  uuid primary key default gen_random_uuid(),
  entreprise_id       uuid not null references entreprise(id) on delete cascade,
  membre_id           uuid not null references membre(id) on delete cascade,
  chantier_id         uuid references chantier(id) on delete set null,
  intervention_id     uuid references intervention(id) on delete set null,
  arrive_le           timestamptz not null default now(),
  arrivee_latitude    double precision,
  arrivee_longitude   double precision,
  arrivee_precision_m integer check (arrivee_precision_m >= 0),
  arrivee_distance_m  integer,
  arrivee_sans_position text
                      check (arrivee_sans_position in ('refusee','indisponible','delai','non_supportee')),
  parti_le            timestamptz,
  depart_latitude     double precision,
  depart_longitude    double precision,
  depart_precision_m  integer check (depart_precision_m >= 0),
  depart_distance_m   integer,
  depart_sans_position text
                      check (depart_sans_position in ('refusee','indisponible','delai','non_supportee')),
  depart_auto         boolean not null default false,
  commentaire         text,
  created_at          timestamptz not null default now(),
  check (parti_le is null or parti_le >= arrive_le),
  check (arrivee_latitude between -90 and 90 and arrivee_longitude between -180 and 180),
  check (depart_latitude between -90 and 90 and depart_longitude between -180 and 180)
);

create index if not exists presence_jour_idx
  on presence (entreprise_id, arrive_le desc);
create index if not exists presence_membre_idx
  on presence (entreprise_id, membre_id, arrive_le desc);
create index if not exists presence_chantier_idx
  on presence (entreprise_id, chantier_id, arrive_le desc) where chantier_id is not null;

comment on table presence is
  'Arrivées et départs sur chantier, datés par le serveur. Position relevée une fois par geste, jamais en continu.';


-- -----------------------------------------------------------------------------
-- 4. Droits
--
-- Lecture : chacun voit les siennes ; la direction et les chefs de chantier
-- voient celles de tous. Les heures et la position d'un collègue ne regardent
-- pas un poseur — même règle que le pointage (SQL 19).
--
-- Écriture : aucune insertion directe. Une arrivée passe par noter_arrivee(),
-- qui prend l'heure du serveur et l'identité de la session : un téléphone à
-- l'heure trafiquée, ou un appel qui se dirait quelqu'un d'autre, n'y
-- changent rien. La direction peut seulement compléter un départ oublié et
-- commenter — l'heure d'arrivée et les positions ne se réécrivent pas. Rien
-- ne se supprime depuis l'application.
-- -----------------------------------------------------------------------------

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'presence'
  loop
    execute format('drop policy %I on presence', p.policyname);
  end loop;
end $$;

alter table presence enable row level security;

create policy lecture on presence for select to authenticated
  using (entreprise_id = mon_entreprise()
         and (voit_les_prix() or membre_id = mon_membre()));

create policy correction on presence for update to authenticated
  using (entreprise_id = mon_entreprise() and mon_role() = 'direction')
  with check (entreprise_id = mon_entreprise() and mon_role() = 'direction');

revoke all on presence from anon;
revoke insert, update, delete, truncate on presence from authenticated;
grant select on presence to authenticated;
grant update (parti_le, commentaire) on presence to authenticated;


-- -----------------------------------------------------------------------------
-- 5. Noter une arrivée
--
-- Trois précautions, toutes tirées de la revue de la phase 1 :
-- - le chantier et l'intervention doivent être de l'entreprise de la session,
--   sinon une fonction définie par son propriétaire servirait à écrire chez
--   une autre ;
-- - un double appui ne crée pas deux arrivées : la présence encore ouverte
--   sur la même intervention (ou le même chantier) ce jour-là est rendue telle
--   quelle ;
-- - une présence restée ouverte ailleurs le même jour se ferme à l'heure de
--   cette arrivée, marquée « départ automatique ». Celle d'un autre jour reste
--   ouverte : la fermer à l'heure d'aujourd'hui inventerait une journée de
--   travail de vingt-quatre heures.
--
-- L'intervention planifiée passe « en cours » : l'arrivée remplace le bouton
-- « Je commence ».
--
-- Enfin, les positions de plus d'un an sont effacées au passage. Un an, c'est
-- la durée que la CNIL admet quand la géolocalisation sert de preuve d'une
-- intervention ; les heures, elles, restent (cinq ans pour le temps de
-- travail). Purger ici évite une tâche planifiée que le projet n'a pas.
-- -----------------------------------------------------------------------------

create or replace function noter_arrivee(
  p_intervention   uuid default null,
  p_chantier       uuid default null,
  p_latitude       double precision default null,
  p_longitude      double precision default null,
  p_precision_m    integer default null,
  p_sans_position  text default null)
returns presence language plpgsql security definer set search_path = public as $$
declare
  v_entreprise uuid := mon_entreprise();
  v_membre     uuid := mon_membre();
  v_chantier   uuid := p_chantier;
  v_site       site;
  v_jour       date := (now() at time zone 'Europe/Paris')::date;
  v_presence   presence;
begin
  if v_membre is null then
    raise exception 'Aucun membre actif pour cette session.';
  end if;

  if p_intervention is not null then
    select coalesce(v_chantier, i.chantier_id) into v_chantier
      from intervention i where i.id = p_intervention and i.entreprise_id = v_entreprise;
    if not found then
      raise exception 'Intervention introuvable dans votre entreprise.';
    end if;
  end if;

  if v_chantier is not null then
    select s.* into v_site
      from chantier c
      left join site s on s.id = c.site_id and s.entreprise_id = v_entreprise
     where c.id = v_chantier and c.entreprise_id = v_entreprise;
    if not found then
      raise exception 'Chantier introuvable dans votre entreprise.';
    end if;
  end if;

  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'Une position a une latitude et une longitude, ou ni l''une ni l''autre.';
  end if;

  -- Double appui : on rend la présence déjà ouverte.
  select * into v_presence from presence
   where membre_id = v_membre and parti_le is null
     and (arrive_le at time zone 'Europe/Paris')::date = v_jour
     and coalesce(intervention_id::text, chantier_id::text, '')
       = coalesce(p_intervention::text, v_chantier::text, '')
   order by arrive_le desc limit 1;
  if found then
    return v_presence;
  end if;

  update presence set parti_le = now(), depart_auto = true
   where membre_id = v_membre and parti_le is null
     and (arrive_le at time zone 'Europe/Paris')::date = v_jour;

  insert into presence (entreprise_id, membre_id, chantier_id, intervention_id,
                        arrivee_latitude, arrivee_longitude, arrivee_precision_m,
                        arrivee_distance_m, arrivee_sans_position)
  values (v_entreprise, v_membre, v_chantier, p_intervention,
          p_latitude, p_longitude, p_precision_m,
          distance_metres(p_latitude, p_longitude, v_site.latitude, v_site.longitude),
          case when p_latitude is null then coalesce(p_sans_position, 'indisponible') end)
  returning * into v_presence;

  if p_intervention is not null then
    update intervention
       set statut = 'en_cours', debut_le = coalesce(debut_le, now())
     where id = p_intervention and entreprise_id = v_entreprise
       and statut in ('planifiee', 'reportee');
  end if;

  update presence
     set arrivee_latitude = null, arrivee_longitude = null,
         depart_latitude = null, depart_longitude = null
   where entreprise_id = v_entreprise
     and arrive_le < now() - interval '1 year'
     and (arrivee_latitude is not null or depart_latitude is not null);

  return v_presence;
end $$;


-- -----------------------------------------------------------------------------
-- 6. Noter un départ
--
-- Seulement le sien, et seulement s'il est encore ouvert. `p_terminer` clôt
-- l'intervention dans le même geste : « J'ai terminé » et « Je pars » sont le
-- plus souvent le même moment.
-- -----------------------------------------------------------------------------

create or replace function noter_depart(
  p_presence       uuid,
  p_latitude       double precision default null,
  p_longitude      double precision default null,
  p_precision_m    integer default null,
  p_sans_position  text default null,
  p_terminer       boolean default false)
returns presence language plpgsql security definer set search_path = public as $$
declare
  v_presence presence;
  v_site     site;
begin
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'Une position a une latitude et une longitude, ou ni l''une ni l''autre.';
  end if;

  select * into v_presence from presence
   where id = p_presence and membre_id = mon_membre() and entreprise_id = mon_entreprise();
  if not found then
    raise exception 'Cette arrivée n''est pas la vôtre, ou n''existe pas.';
  end if;
  if v_presence.parti_le is not null then
    raise exception 'Le départ est déjà noté, à %.',
      to_char(v_presence.parti_le at time zone 'Europe/Paris', 'HH24:MI');
  end if;

  select s.* into v_site
    from chantier c join site s on s.id = c.site_id and s.entreprise_id = c.entreprise_id
   where c.id = v_presence.chantier_id and c.entreprise_id = v_presence.entreprise_id;

  update presence
     set parti_le = now(),
         depart_latitude = p_latitude, depart_longitude = p_longitude,
         depart_precision_m = p_precision_m,
         depart_distance_m = distance_metres(p_latitude, p_longitude, v_site.latitude, v_site.longitude),
         depart_sans_position = case when p_latitude is null
                                     then coalesce(p_sans_position, 'indisponible') end
   where id = p_presence
  returning * into v_presence;

  if p_terminer and v_presence.intervention_id is not null then
    update intervention
       set statut = 'terminee', fin_le = now(), debut_le = coalesce(debut_le, v_presence.arrive_le)
     where id = v_presence.intervention_id and entreprise_id = v_presence.entreprise_id
       and statut <> 'annulee';
  end if;

  return v_presence;
end $$;

revoke all on function noter_arrivee(uuid, uuid, double precision, double precision, integer, text)
  from public, anon;
revoke all on function noter_depart(uuid, double precision, double precision, integer, text, boolean)
  from public, anon;
grant execute on function noter_arrivee(uuid, uuid, double precision, double precision, integer, text)
  to authenticated;
grant execute on function noter_depart(uuid, double precision, double precision, integer, text, boolean)
  to authenticated;


-- -----------------------------------------------------------------------------
-- 7. Vérification
--
-- Jouée pour de vrai, avec l'identité d'un membre existant, puis en rôle
-- `authenticated` pour éprouver les droits : relire la sienne, ne pas écrire
-- directement, ne pas réécrire une heure d'arrivée. Tout dans un bloc annulé
-- à la fin : aucune ligne ne reste, aucun chantier d'essai non plus.
-- -----------------------------------------------------------------------------

do $$
declare
  v_ent uuid; v_membre membre; v_tiers uuid; v_site uuid; v_chantier uuid;
  v_inter uuid; v_p presence; v_p2 presence; v_n integer; v_bloque boolean;
  v_echecs text[] := '{}';
begin
  if distance_metres(48.7702, 2.5233, 48.7702, 2.5233) <> 0
     or distance_metres(48.8566, 2.3522, 48.7702, 2.5233) not between 15000 and 16500 then
    v_echecs := array_append(v_echecs, 'distance_metres donne des distances fausses');
  end if;

  select m.* into v_membre from membre m where m.actif order by m.created_at limit 1;
  if v_membre.id is null then
    raise notice 'Aucun membre : seule la distance a été vérifiée.';
  else
    v_ent := v_membre.entreprise_id;
    begin
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_membre.user_id, 'role', 'authenticated')::text, true);

      insert into tiers (entreprise_id, nom) values (v_ent, 'Essai SQL 35') returning id into v_tiers;
      insert into site (entreprise_id, tiers_id, adresse, latitude, longitude)
      values (v_ent, v_tiers, '1 rue de l''Essai', 48.7702, 2.5233) returning id into v_site;
      insert into chantier (entreprise_id, numero, tiers_id, site_id, libelle)
      values (v_ent, 'ESSAI-35', v_tiers, v_site, 'Vérification SQL 35') returning id into v_chantier;
      insert into intervention (entreprise_id, chantier_id, type, date_prevue, membre_id)
      values (v_ent, v_chantier, 'pose', current_date, v_membre.id) returning id into v_inter;

      -- Arrivée à une vingtaine de mètres du site.
      v_p := noter_arrivee(v_inter, null, 48.7703, 2.5235, 12, null);
      if v_p.chantier_id is distinct from v_chantier then
        v_echecs := array_append(v_echecs, 'l''arrivée n''a pas pris le chantier de l''intervention');
      end if;
      if v_p.arrivee_distance_m is null or v_p.arrivee_distance_m > 40 then
        v_echecs := array_append(v_echecs, format('distance au site fausse (%s m)', v_p.arrivee_distance_m));
      end if;
      if (select statut from intervention where id = v_inter) <> 'en_cours' then
        v_echecs := array_append(v_echecs, 'l''intervention n''est pas passée en cours');
      end if;

      -- Double appui : la même présence revient.
      v_p2 := noter_arrivee(v_inter, null, 48.7703, 2.5235, 12, null);
      if v_p2.id <> v_p.id then
        v_echecs := array_append(v_echecs, 'un double appui a créé deux arrivées');
      end if;

      -- Les droits, en rôle authenticated.
      set local role authenticated;
      select count(*) into v_n from presence where id = v_p.id;
      if v_n <> 1 then
        v_echecs := array_append(v_echecs, 'un membre ne relit pas sa propre arrivée');
      end if;
      v_bloque := false;
      begin
        insert into presence (entreprise_id, membre_id) values (v_ent, v_membre.id);
      exception when insufficient_privilege then v_bloque := true;
      end;
      if not v_bloque then
        v_echecs := array_append(v_echecs, 'une arrivée a pu s''écrire sans passer par noter_arrivee');
      end if;
      v_bloque := false;
      begin
        update presence set arrive_le = arrive_le - interval '2 hours' where id = v_p.id;
      exception when insufficient_privilege then v_bloque := true;
      end;
      if not v_bloque then
        v_echecs := array_append(v_echecs, 'une heure d''arrivée a pu être réécrite');
      end if;

      -- Un poseur ne voit pas l'arrivée d'un autre, s'il y en a un pour essayer.
      perform set_config('request.jwt.claims', json_build_object('sub', m.user_id,
                         'role', 'authenticated')::text, true)
        from membre m
       where m.entreprise_id = v_ent and m.actif and m.role in ('technicien', 'sous_traitant')
         and m.id <> v_membre.id
       limit 1;
      if found then
        select count(*) into v_n from presence where id = v_p.id;
        if v_n <> 0 then
          v_echecs := array_append(v_echecs, 'un poseur voit l''arrivée d''un autre membre');
        end if;
        perform set_config('request.jwt.claims', json_build_object('sub', v_membre.user_id,
                           'role', 'authenticated')::text, true);
      end if;

      -- Départ sans position, en clôturant l'intervention.
      v_p2 := noter_depart(v_p.id, null, null, null, 'refusee', true);
      reset role;
      if v_p2.parti_le is null or v_p2.depart_sans_position <> 'refusee' then
        v_echecs := array_append(v_echecs, 'le départ ou son motif sans position n''a pas été noté');
      end if;
      if (select statut from intervention where id = v_inter) <> 'terminee' then
        v_echecs := array_append(v_echecs, 'l''intervention n''a pas été clôturée au départ');
      end if;

      -- Une arrivée ailleurs le même jour ferme la précédente, marquée automatique.
      v_p := noter_arrivee(null, v_chantier, null, null, null, 'delai');
      v_p2 := noter_arrivee(null, null, null, null, null, 'delai');
      select * into v_p from presence where id = v_p.id;
      if v_p.parti_le is null or not v_p.depart_auto then
        v_echecs := array_append(v_echecs, 'une présence ouverte n''a pas été fermée par l''arrivée suivante');
      end if;

      raise exception using errcode = 'P0001', message = '__annulation_35__';
    exception when others then
      if sqlerrm <> '__annulation_35__' then raise; end if;
    end;

    if exists (select 1 from chantier where numero = 'ESSAI-35' and entreprise_id = v_ent) then
      v_echecs := array_append(v_echecs, 'la vérification a laissé des lignes en base');
    end if;
  end if;

  if cardinality(v_echecs) > 0 then
    raise exception 'SQL 35 : vérification en échec — %', array_to_string(v_echecs, ' ; ');
  end if;
  raise notice 'SQL 35 appliqué. Arrivées et départs datés par le serveur, position relevée au geste, droits éprouvés.';
end $$;
