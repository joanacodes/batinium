-- =============================================================================
-- BATINIUM — 34. Les appels retrouvent leur client
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase. Rejouable.
-- Ne touche qu'aux tables du SQL 01 : il peut passer avant les SQL 32 et 33.
--
-- Les appels Allô arrivaient « sans nom », pour deux raisons.
--
-- La première est chez Allô : la fin d'appel ne porte que le numéro. Le nom,
-- quand Allô le connaît, se demande à part, à son carnet de contacts. C'est la
-- fonction allo-webhook qui s'en charge ; ce script n'y peut rien.
--
-- La seconde était chez nous. Le webhook comparait le numéro reçu, réduit à
-- ses chiffres (0612345678), au téléphone de la fiche client tel qu'on l'a
-- tapé (06 12 34 56 78). Une espace suffisait : un client connu arrivait comme
-- un inconnu, et « Créer le client » en fabriquait un second.
--
-- Ce script compare désormais les numéros sous une seule forme, rattache les
-- appels déjà reçus, et rattache les suivants — y compris ceux d'un client
-- dont la fiche est créée après son appel.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Une seule forme pour un numéro
--
-- La même règle que `normaliser()` dans allo-webhook, à la lettre : c'est elle
-- qui écrit `demande.telephone`. Si les deux divergeaient, un appel ne
-- retrouverait plus son client, sans erreur ni avertissement.
--
-- « (0) » est retiré d'abord : « +33 (0)6 … » est une graphie courante sur les
-- cartes de visite, et sans ce retrait elle donnerait 006….
-- -----------------------------------------------------------------------------

create or replace function normaliser_telephone(p_tel text)
returns text language sql immutable parallel safe as $$
  select nullif(case
           when n like '+33%'  then '0' || substr(n, 4)
           when n like '0033%' then '0' || substr(n, 5)
           when n like '33%' and length(n) = 11 then '0' || substr(n, 3)
           else n
         end, '')
    from (select regexp_replace(replace(coalesce(p_tel, ''), '(0)', ''),
                                '[^0-9+]', '', 'g') as n) x
$$;


-- -----------------------------------------------------------------------------
-- 2. L'index qui va avec
--
-- Reconstruit à chaque passage : si la règle du §1 change un jour, un index
-- bâti sur l'ancienne rendrait de mauvaises réponses, en silence. La table des
-- clients est petite, la reconstruction ne coûte rien.
-- -----------------------------------------------------------------------------

create index if not exists tiers_telephone_normalise_idx
  on tiers (entreprise_id, normaliser_telephone(telephone));
reindex index tiers_telephone_normalise_idx;


-- -----------------------------------------------------------------------------
-- 3. Le client d'un numéro
--
-- Rend le client seulement s'il est seul à porter ce numéro. Deux fiches pour
-- un même numéro — un couple, une société et son gérant — et on ne choisit pas
-- à leur place : l'appel reste à rattacher à la main.
--
-- Sous huit chiffres, ce n'est pas un numéro qu'on puisse attribuer à
-- quelqu'un : un poste interne, un reste de saisie.
--
-- Droits de l'appelant : la RLS de `tiers` borne déjà la recherche à son
-- entreprise. Le webhook l'appelle avec la clé de service et passe
-- l'entreprise que son jeton désigne.
-- -----------------------------------------------------------------------------

create or replace function tiers_par_telephone(p_entreprise uuid, p_telephone text)
returns uuid language sql stable as $$
  select case when count(*) = 1 then (array_agg(t.id))[1] end
    from tiers t
   where t.entreprise_id = p_entreprise
     and length(normaliser_telephone(p_telephone)) >= 8
     and normaliser_telephone(t.telephone) = normaliser_telephone(p_telephone)
$$;

revoke all on function tiers_par_telephone(uuid, text) from public, anon;
grant execute on function tiers_par_telephone(uuid, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4. Rattacher au fil de l'eau
--
-- Deux moments. À l'arrivée d'une demande, quelle que soit sa source : un
-- client connu qui rappelle doit être reconnu, pas recréé au clic sur « Créer
-- le client ». Et quand une fiche client prend un numéro — créée après
-- l'appel, ou corrigée — les appels restés orphelins la rejoignent.
--
-- On ne touche qu'aux demandes sans client : un rattachement fait à la main
-- n'est jamais défait.
-- -----------------------------------------------------------------------------

create or replace function demande_rattacher_tiers()
returns trigger language plpgsql as $$
begin
  if new.tiers_id is null and new.telephone is not null then
    new.tiers_id := tiers_par_telephone(new.entreprise_id, new.telephone);
  end if;
  return new;
end $$;

-- Avant l'insertion, et donc aussi dans l'« upsert » du webhook : Postgres
-- passe la ligne proposée par ce déclencheur avant de constater le conflit.
drop trigger if exists demande_rattacher_tiers_trg on demande;
create trigger demande_rattacher_tiers_trg
  before insert on demande
  for each row execute function demande_rattacher_tiers();

-- Définie par son propriétaire : le rattachement ne doit pas dépendre de ce
-- que la RLS laisse voir à la personne qui enregistre la fiche. Elle ne sort
-- jamais de l'entreprise de la fiche, que la RLS a vérifiée à l'écriture.
create or replace function tiers_rattacher_appels()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tiers_par_telephone(new.entreprise_id, new.telephone) is distinct from new.id then
    return null;
  end if;

  update demande set tiers_id = new.id
   where entreprise_id = new.entreprise_id
     and tiers_id is null
     and normaliser_telephone(telephone) = normaliser_telephone(new.telephone);

  -- Le fil suit la demande : c'est lui que la fiche client affiche, et un
  -- appel absent du fil est un appel que personne ne retrouvera.
  update fil f set tiers_id = new.id
    from demande d
   where d.id = f.demande_id
     and d.entreprise_id = new.entreprise_id
     and d.tiers_id = new.id
     and f.tiers_id is null;

  return null;
end $$;

drop trigger if exists tiers_rattacher_appels_trg on tiers;
create trigger tiers_rattacher_appels_trg
  after insert or update of telephone on tiers
  for each row execute function tiers_rattacher_appels();


-- -----------------------------------------------------------------------------
-- 5. Les appels déjà reçus
--
-- Même règle qu'au fil de l'eau : un seul client pour le numéro, sinon rien.
-- Le fil d'une demande déjà rattachée suit aussi : jusqu'ici, convertir une
-- demande en client laissait son appel hors de la fiche.
-- -----------------------------------------------------------------------------

do $$
declare n_dem int; n_fil int;
begin
  update demande d set tiers_id = x.tiers_id
    from (select id, tiers_par_telephone(entreprise_id, telephone) as tiers_id
            from demande
           where tiers_id is null and telephone is not null) x
   where x.id = d.id and x.tiers_id is not null;
  get diagnostics n_dem = row_count;

  update fil f set tiers_id = d.tiers_id
    from demande d
   where d.id = f.demande_id and d.tiers_id is not null and f.tiers_id is null;
  get diagnostics n_fil = row_count;

  raise notice 'Rattachés à leur client : % demande(s), % ligne(s) de fil.', n_dem, n_fil;
end $$;


-- -----------------------------------------------------------------------------
-- 6. Vérification
--
-- Jouée pour de vrai : un appel orphelin, puis la fiche client qui porte son
-- numéro sous une autre graphie, puis un second appel, puis une seconde fiche
-- au même numéro. Le tout dans un bloc annulé à la fin : rien ne reste en
-- base, et le numéro d'essai est tiré pour ne croiser aucun numéro réel.
-- -----------------------------------------------------------------------------

do $$
declare
  v_ent uuid; v_tel text; v_lu uuid;
  v_tiers uuid; v_tiers2 uuid; v_dem uuid; v_fil uuid;
  v_echecs text[] := '{}';
  c record;
begin
  for c in select * from (values
      ('06 12 34 56 78', '0612345678'),
      ('06.12.34.56.78', '0612345678'),
      ('+33 6 12 34 56 78', '0612345678'),
      ('+33 (0)6 12 34 56 78', '0612345678'),
      ('0033 6 12 34 56 78', '0612345678'),
      ('33612345678', '0612345678'),
      ('+44 20 7946 0958', '+442079460958'),
      ('inconnu', null),
      ('', null),
      (null, null)) as t(saisi, attendu)
  loop
    if normaliser_telephone(c.saisi) is distinct from c.attendu then
      v_echecs := array_append(v_echecs, format('« %s » donne « %s » au lieu de « %s »',
                  c.saisi, normaliser_telephone(c.saisi), c.attendu));
    end if;
  end loop;

  select id into v_ent from entreprise order by created_at limit 1;
  if v_ent is null then
    raise notice 'Aucune entreprise : rattachement non vérifié, normalisation seule.';
  else
    loop
      v_tel := '07' || lpad((floor(random() * 100000000))::bigint::text, 8, '0');
      exit when not exists (select 1 from tiers   where normaliser_telephone(telephone) = v_tel)
            and not exists (select 1 from demande where normaliser_telephone(telephone) = v_tel);
    end loop;

    begin
      -- L'appel arrive avant la fiche client.
      insert into demande (entreprise_id, source, telephone, besoin)
      values (v_ent, 'essai_34', v_tel, 'Vérification SQL 34')
      returning id, tiers_id into v_dem, v_lu;
      if v_lu is not null then
        v_echecs := array_append(v_echecs, 'un numéro inconnu a été rattaché à un client');
      end if;
      insert into fil (entreprise_id, demande_id, type, sujet)
      values (v_ent, v_dem, 'appel_entrant', 'Vérification SQL 34')
      returning id into v_fil;

      -- La fiche est créée ensuite, numéro tapé autrement.
      insert into tiers (entreprise_id, nom, telephone)
      values (v_ent, 'Essai SQL 34', '+33 ' || substr(v_tel, 2))
      returning id into v_tiers;

      select tiers_id into v_lu from demande where id = v_dem;
      if v_lu is distinct from v_tiers then
        v_echecs := array_append(v_echecs, 'l''appel antérieur n''a pas rejoint la fiche créée après lui');
      end if;
      select tiers_id into v_lu from fil where id = v_fil;
      if v_lu is distinct from v_tiers then
        v_echecs := array_append(v_echecs, 'le fil de l''appel n''a pas suivi sa demande');
      end if;

      -- Le client rappelle : reconnu dès l'arrivée, graphie différente encore.
      insert into demande (entreprise_id, source, telephone, besoin)
      values (v_ent, 'essai_34', regexp_replace(v_tel, '(..)', '\1 ', 'g'), 'Vérification SQL 34')
      returning tiers_id into v_lu;
      if v_lu is distinct from v_tiers then
        v_echecs := array_append(v_echecs, 'un client connu qui rappelle n''est pas reconnu');
      end if;

      -- Deux fiches au même numéro : on ne choisit pas, et on ne défait rien.
      insert into tiers (entreprise_id, nom, telephone)
      values (v_ent, 'Essai SQL 34 bis', v_tel)
      returning id into v_tiers2;
      if tiers_par_telephone(v_ent, v_tel) is not null then
        v_echecs := array_append(v_echecs, 'un numéro partagé par deux fiches a été attribué à l''une');
      end if;
      insert into demande (entreprise_id, source, telephone, besoin)
      values (v_ent, 'essai_34', v_tel, 'Vérification SQL 34')
      returning tiers_id into v_lu;
      if v_lu is not null then
        v_echecs := array_append(v_echecs, 'l''appel d''un numéro partagé a été rattaché au hasard');
      end if;
      select tiers_id into v_lu from demande where id = v_dem;
      if v_lu is distinct from v_tiers then
        v_echecs := array_append(v_echecs, 'un rattachement existant a été déplacé');
      end if;

      raise exception using errcode = 'P0001', message = '__annulation_34__';
    exception when others then
      if sqlerrm <> '__annulation_34__' then raise; end if;
    end;

    if exists (select 1 from demande where source = 'essai_34')
       or exists (select 1 from tiers where nom like 'Essai SQL 34%' and entreprise_id = v_ent) then
      v_echecs := array_append(v_echecs, 'la vérification a laissé des lignes en base');
    end if;
  end if;

  if cardinality(v_echecs) > 0 then
    raise exception 'SQL 34 : vérification en échec — %', array_to_string(v_echecs, ' ; ');
  end if;

  raise notice 'SQL 34 appliqué. Un appel retrouve son client, quelle que soit la graphie du numéro et même si la fiche vient après lui.';
end $$;
