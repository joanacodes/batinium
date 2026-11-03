-- =============================================================================
-- BATINIUM — 40. Le numéro de chantier : la rue et le client
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase. Rejouable.
-- Ne touche ni à `prochain_numero` (devis, factures) ni aux chantiers déjà
-- créés : indépendant des SQL 32 à 39.
--
-- Fabrice reconnaît un chantier à sa rue et à son client, pas à un compteur :
-- « CH-2026-0042 » ne lui dit rien, « Rue des Lilas – Freguia » tout. Il le
-- veut ainsi, avec un numéro quand la même personne a plusieurs chantiers :
-- « Rue des Lilas – Freguia 2 ». Ses bons de commande portent la même
-- référence.
--
-- Le numéro se calcule une fois, à la création, puis ne bouge plus : il sert
-- de référence sur les bons de commande, les PV, les échanges. Un client qui
-- déménage ou qu'on renomme ne renumérote pas ses chantiers.
--
-- Le compteur reste possible (Entreprise → Numérotation). `prochain_numero`
-- n'est pas modifié : sa version en base lit les préfixes réglés dans
-- Entreprise, et la redéfinir depuis ce dépôt les perdrait — c'est ce qui
-- était arrivé au SQL 33 livré.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Le réglage
-- -----------------------------------------------------------------------------

alter table parametres
  add column if not exists numerotation_chantier text not null default 'rue_client';

alter table parametres drop constraint if exists parametres_numerotation_chantier_check;
alter table parametres add constraint parametres_numerotation_chantier_check
  check (numerotation_chantier in ('rue_client', 'compteur'));

comment on column parametres.numerotation_chantier is
  'rue_client : « Rue des Lilas – Freguia », numéroté à partir du deuxième chantier du même client. compteur : prochain_numero(''chantier'').';

-- La base ferme `parametres` à qui ne voit pas les prix : lu avec les droits
-- d'un technicien, le réglage serait vide, et un chantier qu'il créerait
-- prendrait la rue et le client même si l'entreprise a choisi le compteur.
-- Cette fonction ne rend que ce réglage, et seulement celui de sa propre
-- entreprise.
create or replace function reglage_numerotation_chantier()
returns text language sql stable security definer set search_path = public as $$
  select numerotation_chantier from parametres where entreprise_id = mon_entreprise()
$$;

revoke all on function reglage_numerotation_chantier() from public, anon;
grant execute on function reglage_numerotation_chantier() to authenticated;


-- -----------------------------------------------------------------------------
-- 2. La rue, sans le numéro de la maison
--
-- « 12 bis, rue des Lilas » donne « Rue des Lilas ». Le numéro de la maison ne
-- dit rien à l'équipe, et il change d'un devis à l'autre pour la même
-- adresse ; deux chantiers de la même rue se distinguent par le client.
-- Seule la première ligne compte : la suite est un complément (bâtiment,
-- étage) qui allongerait le numéro sans aider à reconnaître le chantier.
-- -----------------------------------------------------------------------------

create or replace function rue_du_chantier(p_adresse text)
returns text language sql immutable set search_path = public as $$
  select nullif(left(upper(left(r, 1)) || substr(r, 2), 40), '')
    from (select regexp_replace(trim(split_part(coalesce(p_adresse, ''), E'\n', 1)),
                                '^\d+(\s*(bis|ter|quater|[a-d]))?\M[\s,.-]*', '', 'i') as r) as x
$$;


-- -----------------------------------------------------------------------------
-- 3. Le nom du client, tel qu'on l'appelle
--
-- « M. et Mme Freguia » donne « Freguia » : la civilité n'identifie personne.
-- « Ryan DORVILMA » donne « Dorvilma » : en France, le nom de famille s'écrit
-- en capitales, c'est lui qu'on dit sur un chantier. Une entreprise garde son
-- nom tel quel (« SCI Les Pins ») : on n'y devine pas de nom de famille.
-- -----------------------------------------------------------------------------

create or replace function nom_du_client(p_nom text, p_type text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_nom text := trim(coalesce(p_nom, ''));
  v_capitales text;
begin
  if p_type = 'professionnel' then
    return nullif(left(v_nom, 40), '');
  end if;
  v_nom := regexp_replace(v_nom,
    '^(mademoiselle|monsieur|madame|mlle|mme|mr|m)\.?\s+'
    || '((et|&)\s+(mademoiselle|monsieur|madame|mlle|mme|mr|m)\.?\s+)?', '', 'i');
  select string_agg(initcap(m[1]), ' ') into v_capitales
    from regexp_matches(v_nom, '\m([[:upper:]][[:upper:]''-]+)\M', 'g') as m;
  return nullif(left(coalesce(v_capitales, v_nom), 40), '');
end $$;


-- -----------------------------------------------------------------------------
-- 4. Le numéro d'un nouveau chantier
--
-- Appelée par l'application juste avant de créer le chantier. Avec les droits
-- de la personne connectée (pas de `security definer`) : la RLS garantit
-- qu'on ne lit que les clients, adresses et chantiers de son entreprise.
--
-- Le rang compte les chantiers du client : le premier n'a pas de numéro, le
-- deuxième porte « 2 », même dans une autre rue. Il ne garantit pas seul
-- l'unicité — un homonyme dans la même rue, un chantier supprimé — d'où la
-- boucle, qui avance jusqu'au premier numéro libre. Si deux créations pour le
-- même client se croisent à la seconde près, l'index unique
-- (entreprise_id, numero) refuse la seconde, qui se refait.
-- -----------------------------------------------------------------------------

create or replace function numero_chantier(p_tiers uuid, p_site uuid default null)
returns text language plpgsql set search_path = public as $$
declare
  v_entreprise uuid := mon_entreprise();
  v_reglage text;
  v_tiers tiers%rowtype;
  v_site site%rowtype;
  v_base text;
  v_rang int;
  v_numero text;
begin
  if v_entreprise is null then
    raise exception 'Aucune entreprise rattachée à cet utilisateur.';
  end if;
  v_reglage := reglage_numerotation_chantier();
  if coalesce(v_reglage, 'rue_client') = 'compteur' or p_tiers is null then
    return prochain_numero('chantier');
  end if;

  select * into v_tiers from tiers where id = p_tiers and entreprise_id = v_entreprise;
  if v_tiers.id is null then
    raise exception 'Client introuvable pour numéroter le chantier.';
  end if;
  if p_site is not null then
    select * into v_site from site where id = p_site and entreprise_id = v_entreprise;
  end if;

  -- La rue du chantier ; à défaut sa ville ; à défaut l'adresse du client.
  v_base := concat_ws(' – ',
    coalesce(rue_du_chantier(v_site.adresse), nullif(trim(v_site.ville), ''),
             rue_du_chantier(v_tiers.adresse), nullif(trim(v_tiers.ville), '')),
    nom_du_client(v_tiers.nom, v_tiers.type));
  if v_base = '' then
    return prochain_numero('chantier');
  end if;

  select count(*) + 1 into v_rang
    from chantier where entreprise_id = v_entreprise and tiers_id = p_tiers;
  v_numero := case when v_rang > 1 then v_base || ' ' || v_rang else v_base end;
  while exists (select 1 from chantier where entreprise_id = v_entreprise and numero = v_numero) loop
    v_rang := v_rang + 1;
    v_numero := v_base || ' ' || v_rang;
  end loop;
  return v_numero;
end $$;

revoke all on function numero_chantier(uuid, uuid) from public, anon;
grant execute on function numero_chantier(uuid, uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 5. Vérification
--
-- Rejouée en rôle `authenticated`, avec un membre de la direction : de vrais
-- clients, adresses et chantiers, créés puis annulés. Les cas : la civilité
-- retirée et le numéro de maison avec, le deuxième chantier du même client,
-- un homonyme dans la même rue, un nom de famille en capitales, une
-- entreprise sans adresse de chantier, et le réglage « compteur ». Le
-- compteur des chantiers ne doit pas avoir bougé à la fin.
-- -----------------------------------------------------------------------------

do $$
declare
  v_membre membre; v_ent uuid; v_annee int := extract(year from current_date);
  v_avant int; v_apres int;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; s1 uuid; s2 uuid; s3 uuid;
  v_num text; v_attendu text;
  v_echecs text[] := '{}';
begin
  select m.* into v_membre from membre m
   where m.actif and m.role = 'direction' order by m.created_at limit 1;
  if v_membre.id is null then
    raise notice 'Aucun membre de direction : vérification sautée.';
    return;
  end if;
  v_ent := v_membre.entreprise_id;
  select dernier into v_avant from compteur
   where entreprise_id = v_ent and type = 'chantier' and annee = v_annee;

  begin
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_membre.user_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update parametres set numerotation_chantier = 'rue_client' where entreprise_id = v_ent;

    insert into tiers (entreprise_id, type, nom) values (v_ent, 'particulier', 'M. et Mme Essaiquarante')
      returning id into t1;
    insert into site (entreprise_id, tiers_id, adresse, ville)
      values (v_ent, t1, '12 bis, rue des Essais', 'Sucy-en-Brie') returning id into s1;

    v_num := numero_chantier(t1, s1);
    v_attendu := 'Rue des Essais – Essaiquarante';
    if v_num is distinct from v_attendu then
      v_echecs := array_append(v_echecs, format('premier chantier : « %s » au lieu de « %s »', v_num, v_attendu));
    end if;
    insert into chantier (entreprise_id, numero, tiers_id, site_id, libelle)
      values (v_ent, v_num, t1, s1, 'Essai SQL 40');

    v_num := numero_chantier(t1, s1);
    v_attendu := 'Rue des Essais – Essaiquarante 2';
    if v_num is distinct from v_attendu then
      v_echecs := array_append(v_echecs, format('deuxième chantier du client : « %s » au lieu de « %s »', v_num, v_attendu));
    end if;
    insert into chantier (entreprise_id, numero, tiers_id, site_id, libelle)
      values (v_ent, v_num, t1, s1, 'Essai SQL 40');

    -- Un homonyme, dans la même rue : son premier chantier ne doit reprendre
    -- aucun des deux numéros déjà pris.
    insert into tiers (entreprise_id, type, nom) values (v_ent, 'particulier', 'Mme Essaiquarante')
      returning id into t2;
    insert into site (entreprise_id, tiers_id, adresse) values (v_ent, t2, '4 rue des Essais')
      returning id into s2;
    v_num := numero_chantier(t2, s2);
    v_attendu := 'Rue des Essais – Essaiquarante 3';
    if v_num is distinct from v_attendu then
      v_echecs := array_append(v_echecs, format('homonyme dans la même rue : « %s » au lieu de « %s »', v_num, v_attendu));
    end if;

    insert into tiers (entreprise_id, type, nom) values (v_ent, 'particulier', 'Ryan ESSAIDEUX')
      returning id into t3;
    insert into site (entreprise_id, tiers_id, adresse) values (v_ent, t3, '3 Boulevard des Tests')
      returning id into s3;
    v_num := numero_chantier(t3, s3);
    v_attendu := 'Boulevard des Tests – Essaideux';
    if v_num is distinct from v_attendu then
      v_echecs := array_append(v_echecs, format('nom en capitales : « %s » au lieu de « %s »', v_num, v_attendu));
    end if;

    insert into tiers (entreprise_id, type, nom, ville)
      values (v_ent, 'professionnel', 'SCI Les Essais', 'Boissy-Saint-Léger') returning id into t4;
    v_num := numero_chantier(t4, null);
    v_attendu := 'Boissy-Saint-Léger – SCI Les Essais';
    if v_num is distinct from v_attendu then
      v_echecs := array_append(v_echecs, format('entreprise sans adresse de chantier : « %s » au lieu de « %s »', v_num, v_attendu));
    end if;

    update parametres set numerotation_chantier = 'compteur' where entreprise_id = v_ent;
    v_num := numero_chantier(t1, s1);
    if v_num is null or v_num like '%Essai%' then
      v_echecs := array_append(v_echecs, format('réglage « compteur » ignoré : « %s »', v_num));
    end if;

    reset role;
    raise exception using errcode = 'P0001', message = '__annulation_40__';
  exception when others then
    if sqlerrm <> '__annulation_40__' then raise; end if;
  end;

  select dernier into v_apres from compteur
   where entreprise_id = v_ent and type = 'chantier' and annee = v_annee;
  if v_apres is distinct from v_avant then
    v_echecs := array_append(v_echecs, 'la vérification a consommé un numéro du compteur des chantiers');
  end if;
  if exists (select 1 from tiers where entreprise_id = v_ent and nom ilike '%essai%quarante%') then
    v_echecs := array_append(v_echecs, 'la vérification a laissé des lignes en base');
  end if;

  if cardinality(v_echecs) > 0 then
    raise exception 'SQL 40 : vérification en échec — %', array_to_string(v_echecs, ' ; ');
  end if;
  raise notice 'SQL 40 appliqué. Un nouveau chantier se numérote « Rue des Lilas – Freguia », puis « 2 » pour le deuxième du même client.';
end $$;
