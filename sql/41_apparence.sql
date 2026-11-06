-- =============================================================================
-- BATINIUM — 41. L'apparence : le thème de l'entreprise, le ton de chacun
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase. Rejouable.
-- Ne touche qu'à `entreprise` et à `membre`, une colonne chacune, et ajoute
-- deux fonctions : indépendant des SQL 32 à 40. Le mode démonstration (SQL 38)
-- n'est pas requis ; s'il est en place, la vérification s'en sert.
--
-- Deux réglages, qui ne se décident pas au même niveau :
--   1. le thème — citron, cobalt ou minuit — appartient à l'entreprise : la
--      direction le choisit une fois, et toute l'équipe voit la même
--      application ;
--   2. le ton — clair, sombre, ou auto, qui laisse l'appareil décider —
--      appartient à chacun : on ne lit pas un écran de la même façon sur un
--      toit en plein soleil et le soir au bureau.
--
-- En base, et non dans le navigateur : la règle 9 exclut localStorage, et un
-- réglage gardé par le navigateur ne suivrait pas la personne du téléphone de
-- chantier à l'ordinateur du bureau.
--
-- L'écriture passe par deux fonctions, parce qu'aucune des deux tables ne
-- s'écrit directement depuis l'application : `entreprise` n'a aucune
-- politique d'écriture (SQL 01), pas même pour la direction ; `membre` ne
-- s'écrit que par la direction, si bien qu'un technicien ne pourrait pas
-- régler son propre ton, ni la direction le sien pendant un aperçu (SQL 38).
--
-- La lecture n'appelle aucune politique nouvelle. Les politiques du SQL 01
-- portent sur des lignes, et les droits que Supabase accorde à
-- `authenticated` sur des tables entières : les colonnes ajoutées suivent.
-- `acces` ouvre à tout membre actif la ligne de son entreprise, quel que soit
-- son rôle ; `lecture` ouvre à chacun les membres de son entreprise et, en
-- tout cas, sa propre ligne. Ni le thème ni le ton ne portent de prix ni de
-- donnée RH (règle 7) : il n'y a rien à fermer. La vérification le constate
-- en lisant pour de vrai, avec la session de la direction et avec une session
-- hors direction.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Le thème de l'entreprise
--
-- Réservé à la direction, telle que la voit mon_role(). En démonstration
-- (SQL 38), mon_role() rend le rôle emprunté : la direction qui regarde
-- Batinium en technicien est refusée comme un technicien. C'est voulu —
-- l'aperçu doit montrer ce que le terrain peut faire, et le terrain ne change
-- pas l'apparence de toute l'entreprise. Il suffit de quitter l'aperçu.
--
-- La liste des thèmes est écrite deux fois : la contrainte tient la table face
-- à toute écriture, la fonction refuse avant elle, avec un message qu'on peut
-- afficher tel quel.
-- -----------------------------------------------------------------------------

alter table entreprise
  add column if not exists theme text not null default 'citron';

alter table entreprise drop constraint if exists entreprise_theme_check;
alter table entreprise add constraint entreprise_theme_check
  check (theme in ('citron', 'cobalt', 'minuit'));

comment on column entreprise.theme is
  'Thème de l''application pour toute l''équipe : citron, cobalt ou minuit. Choisi par la direction (choisir_theme).';

create or replace function choisir_theme(p_theme text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if mon_role() is distinct from 'direction' then
    raise exception 'Seule la direction choisit le thème de l''entreprise.';
  end if;
  if p_theme is null or p_theme not in ('citron', 'cobalt', 'minuit') then
    raise exception 'Thème inconnu%. Choisir citron, cobalt ou minuit.',
      coalesce(' : « ' || p_theme || ' »', '');
  end if;
  update entreprise set theme = p_theme where id = mon_entreprise();
  if not found then
    raise exception 'Aucune entreprise rattachée à cette session.';
  end if;
  return p_theme;
end $$;

revoke all on function choisir_theme(text) from public, anon;
grant execute on function choisir_theme(text) to authenticated;


-- -----------------------------------------------------------------------------
-- 2. Le ton de chacun
--
-- Ouvert à tout membre actif, aperçu compris, mais pour soi seulement, comme
-- le préavis du SQL 37. Toutes les lignes actives de la personne, et non la
-- seule ligne de mon_membre() : le ton est celui de la personne, pas de son
-- rattachement. Un compte inscrit dans deux entreprises le garde dans les
-- deux, quand mon_membre() n'en retiendrait qu'une, sans ordre.
-- -----------------------------------------------------------------------------

alter table membre
  add column if not exists ton text not null default 'auto';

alter table membre drop constraint if exists membre_ton_check;
alter table membre add constraint membre_ton_check
  check (ton in ('auto', 'clair', 'sombre'));

comment on column membre.ton is
  'Clair, sombre, ou auto qui suit le réglage de l''appareil. Choisi par chacun pour lui-même (choisir_ton).';

create or replace function choisir_ton(p_ton text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if p_ton is null or p_ton not in ('auto', 'clair', 'sombre') then
    raise exception 'Ton inconnu%. Choisir auto, clair ou sombre.',
      coalesce(' : « ' || p_ton || ' »', '');
  end if;
  update membre set ton = p_ton
   where user_id = auth.uid() and actif;
  if not found then
    raise exception 'Aucun membre actif pour cette session.';
  end if;
  return p_ton;
end $$;

revoke all on function choisir_ton(text) from public, anon;
grant execute on function choisir_ton(text) to authenticated;


-- -----------------------------------------------------------------------------
-- 3. Vérification
--
-- Rejouée en rôle `authenticated`, avec des membres qui ont un compte et un
-- seul rattachement : une fiche sans compte ne donne aucune session, et la
-- session d'un compte inscrit dans deux entreprises n'en retient qu'une, pas
-- forcément celle de la ligne choisie. L'essai échouerait pour une raison
-- étrangère à ce script.
--
-- Les cas :
--   - les valeurs par défaut, exécutées : une entreprise neuve prend
--     « citron », un ton remis à son défaut vaut « auto » ;
--   - la direction choisit chacun des trois thèmes et des trois tons, et les
--     relit par sa session ; « rose », « violet » et le vide sont refusés par
--     la fonction, avec son message, et non par la seule contrainte ;
--   - une entreprise témoin garde son thème, les autres membres leur ton ;
--   - hors direction, le thème est refusé, se relit, et le ton reste libre :
--     la direction en aperçu dans chacun des trois rôles, si le SQL 38 est en
--     place et que mon_role() l'honore — le chef de chantier compris, qui
--     voit les prix sans pour autant choisir le thème — puis un vrai membre
--     du terrain, s'il en existe un avec un compte ;
--   - une session sans fiche membre est refusée des deux côtés, par une
--     erreur : un réglage qui n'écrit rien ne doit pas se taire (règle 13).
-- Bloc annulé à la fin : aucune ligne ne reste, rien n'a changé dans
-- `entreprise` ni dans `membre`.
-- -----------------------------------------------------------------------------

do $$
declare
  v_direction membre; v_terrain membre; v_ent uuid; v_temoin uuid;
  v_apercu boolean; v_essai record; v_valeur text; v_lu text;
  v_autres integer; v_n integer; v_entreprises text; v_membres text;
  v_eprouve text[] := '{}'; v_non_eprouve text[] := '{}';
  v_echecs text[] := '{}';
begin
  select m.* into v_direction from membre m
   where m.actif and m.role = 'direction' and m.user_id is not null
     and not exists (select 1 from membre x
                      where x.user_id = m.user_id and x.actif and x.id <> m.id)
   order by m.created_at limit 1;
  if v_direction.id is null then
    raise notice 'Aucun membre de direction avec un compte, rattaché à une seule entreprise : vérification sautée.';
    return;
  end if;
  v_ent := v_direction.entreprise_id;
  select m.* into v_terrain from membre m
   where m.actif and m.entreprise_id = v_ent and m.role <> 'direction'
     and m.user_id is not null
     and not exists (select 1 from membre x
                      where x.user_id = m.user_id and x.actif and x.id <> m.id)
   order by (m.role in ('technicien', 'sous_traitant')) desc, m.created_at limit 1;
  v_apercu := exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'membre'
                         and column_name = 'apercu_role');

  select md5(string_agg(to_jsonb(e)::text, ',' order by e.id)) into v_entreprises from entreprise e;
  select md5(string_agg(to_jsonb(m)::text, ',' order by m.id)) into v_membres from membre m;

  begin
    insert into entreprise (nom) values ('Essai SQL 41') returning id, theme into v_temoin, v_lu;
    if v_lu is distinct from 'citron' then
      v_echecs := array_append(v_echecs, format('une entreprise neuve prend le thème « %s » et non « citron »', v_lu));
    end if;
    update membre set ton = default where id = v_direction.id returning ton into v_lu;
    if v_lu is distinct from 'auto' then
      v_echecs := array_append(v_echecs, format('le ton par défaut vaut « %s » et non « auto »', v_lu));
    end if;

    -- La direction peut être en aperçu au moment où le script tourne : elle
    -- se verrait refuser son propre thème.
    if v_apercu then
      execute 'update membre set apercu_role = null where id = $1' using v_direction.id;
    end if;

    -- Les autres membres passent à « auto », et chaque essai finit sur un
    -- autre ton : si l'un d'eux change, une session a écrit chez un autre.
    update membre set ton = 'auto' where entreprise_id = v_ent and id <> v_direction.id;
    get diagnostics v_autres = row_count;

    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_direction.user_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if mon_role() is distinct from 'direction' or mon_entreprise() is distinct from v_ent then
      raise exception 'SQL 41 : la session de « % » ne rend pas son rôle de direction et son entreprise ; mon_role() ou mon_entreprise() ne sont plus celles des SQL 01 et 38.',
                      v_direction.nom;
    end if;

    -- Chaque thème, puis chaque ton : la fonction et la contrainte doivent
    -- accepter les mêmes. Le thème finit sur cobalt, que les sessions hors
    -- direction relisent plus bas.
    foreach v_valeur in array array['minuit', 'citron', 'cobalt'] loop
      if choisir_theme(v_valeur) is distinct from v_valeur then
        v_echecs := array_append(v_echecs, format('choisir_theme ne rend pas « %s »', v_valeur));
      end if;
      select theme into v_lu from entreprise where id = mon_entreprise();
      if v_lu is distinct from v_valeur then
        v_echecs := array_append(v_echecs, format('la direction a choisi le thème « %s » et relit « %s »',
                                                  v_valeur, coalesce(v_lu, 'rien')));
      end if;
    end loop;
    foreach v_valeur in array array['clair', 'auto', 'sombre'] loop
      if choisir_ton(v_valeur) is distinct from v_valeur then
        v_echecs := array_append(v_echecs, format('choisir_ton ne rend pas « %s »', v_valeur));
      end if;
      select ton into v_lu from membre where user_id = auth.uid() and actif;
      if v_lu is distinct from v_valeur then
        v_echecs := array_append(v_echecs, format('la direction a choisi le ton « %s » et relit « %s »',
                                                  v_valeur, coalesce(v_lu, 'rien')));
      end if;
    end loop;

    foreach v_valeur in array array['rose', null]::text[] loop
      begin
        perform choisir_theme(v_valeur);
        v_echecs := array_append(v_echecs, format('le thème %s a été accepté',
                                                  coalesce('« ' || v_valeur || ' »', 'vide')));
      exception
        when raise_exception then null;
        when check_violation or not_null_violation then
          v_echecs := array_append(v_echecs, format('le thème %s n''est refusé que par la contrainte, sans message lisible',
                                                    coalesce('« ' || v_valeur || ' »', 'vide')));
      end;
    end loop;
    foreach v_valeur in array array['violet', null]::text[] loop
      begin
        perform choisir_ton(v_valeur);
        v_echecs := array_append(v_echecs, format('le ton %s a été accepté',
                                                  coalesce('« ' || v_valeur || ' »', 'vide')));
      exception
        when raise_exception then null;
        when check_violation or not_null_violation then
          v_echecs := array_append(v_echecs, format('le ton %s n''est refusé que par la contrainte, sans message lisible',
                                                    coalesce('« ' || v_valeur || ' »', 'vide')));
      end;
    end loop;
    reset role;

    if (select theme from entreprise where id = v_temoin) is distinct from 'citron' then
      v_echecs := array_append(v_echecs, 'le thème choisi par la direction a débordé sur une autre entreprise');
    end if;
    select count(*) into v_n from membre
     where entreprise_id = v_ent and id <> v_direction.id and ton <> 'auto';
    if v_n > 0 then
      v_echecs := array_append(v_echecs, format('le ton choisi par la direction a changé celui de %s autre(s) membre(s)', v_n));
    end if;

    -- Hors direction. La direction en aperçu d'abord, dans chacun des trois
    -- rôles : le chef de chantier voit les prix, il ne choisit pas pour
    -- autant le thème. Puis un vrai membre du terrain. Un rôle que la session
    -- ne rend pas ne prouverait rien : on le constate avant de s'en servir.
    for v_essai in
      select format('la direction en aperçu %s', r) as libelle, v_direction.id as membre_id,
             v_direction.user_id as sub, r as apercu, r as role_attendu
        from unnest(array['chef_chantier', 'technicien', 'sous_traitant']) as r
       where v_apercu
      union all
      select format('un membre %s', v_terrain.role), v_terrain.id, v_terrain.user_id,
             null, v_terrain.role
       where v_terrain.id is not null
    loop
      if v_apercu then
        execute 'update membre set apercu_role = $1 where id = $2' using v_essai.apercu, v_direction.id;
      end if;
      update membre set ton = 'auto' where entreprise_id = v_ent;
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_essai.sub, 'role', 'authenticated')::text, true);
      set local role authenticated;
      v_lu := mon_role();
      if v_lu is distinct from v_essai.role_attendu or mon_entreprise() is distinct from v_ent then
        reset role;
        v_non_eprouve := array_append(v_non_eprouve, format('%s : la session rend le rôle « %s », essai sauté',
                                                            v_essai.libelle, coalesce(v_lu, 'aucun')));
        continue;
      end if;

      begin
        perform choisir_theme('minuit');
        v_echecs := array_append(v_echecs, format('%s a pu choisir le thème de l''entreprise', v_essai.libelle));
      exception when raise_exception then null;
      end;
      select theme into v_lu from entreprise where id = mon_entreprise();
      if v_lu is distinct from 'cobalt' then
        v_echecs := array_append(v_echecs, format('%s relit le thème « %s » et non « cobalt »',
                                                  v_essai.libelle, coalesce(v_lu, 'rien')));
      end if;

      begin
        perform choisir_ton('clair');
      exception when raise_exception then
        v_echecs := array_append(v_echecs, format('%s ne peut pas régler son ton : %s', v_essai.libelle, sqlerrm));
      end;
      select ton into v_lu from membre where user_id = auth.uid() and actif;
      if v_lu is distinct from 'clair' then
        v_echecs := array_append(v_echecs, format('%s a choisi le ton « clair » et relit « %s »',
                                                  v_essai.libelle, coalesce(v_lu, 'rien')));
      end if;
      reset role;

      select count(*) into v_n from membre
       where entreprise_id = v_ent and id <> v_essai.membre_id and ton <> 'auto';
      if v_n > 0 then
        v_echecs := array_append(v_echecs, format('le ton choisi par %s a changé celui de %s autre(s) membre(s)',
                                                  v_essai.libelle, v_n));
      end if;
      v_eprouve := array_append(v_eprouve, v_essai.libelle);
    end loop;

    perform set_config('request.jwt.claims',
                       json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform choisir_theme('cobalt');
      v_echecs := array_append(v_echecs, 'une session sans fiche membre a pu choisir un thème');
    exception when raise_exception then null;
    end;
    begin
      perform choisir_ton('sombre');
      v_echecs := array_append(v_echecs, 'une session sans fiche membre règle un ton sans erreur, alors que rien n''est écrit');
    exception when raise_exception then null;
    end;
    reset role;

    raise exception using errcode = 'P0001', message = '__annulation_41__';
  exception when others then
    if sqlerrm <> '__annulation_41__' then raise; end if;
  end;

  if (select md5(string_agg(to_jsonb(e)::text, ',' order by e.id)) from entreprise e) is distinct from v_entreprises
     or (select md5(string_agg(to_jsonb(m)::text, ',' order by m.id)) from membre m) is distinct from v_membres then
    v_echecs := array_append(v_echecs, 'la vérification a laissé une trace dans entreprise ou dans membre');
  end if;

  if cardinality(v_echecs) > 0 then
    raise exception 'SQL 41 : vérification en échec — %', array_to_string(v_echecs, ' ; ');
  end if;

  if v_autres = 0 then
    v_non_eprouve := array_append(v_non_eprouve,
      'aucun autre membre dans l''entreprise : que choisir_ton n''écrive que chez soi n''a pas été éprouvé');
  end if;
  if cardinality(v_eprouve) = 0 then
    v_non_eprouve := array_append(v_non_eprouve,
      'ni aperçu (SQL 38) ni membre du terrain avec un compte : le refus hors direction n''a pas été éprouvé');
  end if;
  foreach v_lu in array v_non_eprouve loop
    raise notice 'SQL 41 : %.', v_lu;
  end loop;
  raise notice 'SQL 41 appliqué. La direction choisit le thème de l''entreprise, chacun son ton.%',
    case when cardinality(v_eprouve) > 0
         then ' Hors direction, refus du thème et ton libre éprouvés avec : ' || array_to_string(v_eprouve, ', ') || '.'
         else '' end;
end $$;
