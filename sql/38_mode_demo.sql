-- =============================================================================
-- BATINIUM — 38. Mode démonstration : voir Batinium avec les droits d'un autre rôle
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase. Rejouable.
-- Ne touche qu'à `membre` et à mon_role() : indépendant des SQL 32 et 33.
--
-- TEMPORAIRE. Utile tant que l'application se construit, à retirer avant la
-- mise en service chez d'autres entreprises. Pour le retirer :
--   drop function if exists entrer_apercu(text);
--   drop function if exists quitter_apercu();
--   puis recréer mon_role() dans sa version du SQL 01 (sans apercu_role),
--   et enfin : alter table membre drop column if exists apercu_role;
--
-- Pourquoi en base et pas seulement à l'écran : la sécurité est tenue par la
-- base (règle 4). Un aperçu qui changerait seulement les menus montrerait au
-- gérant des données qu'un technicien ne reçoit jamais — et cacherait
-- précisément les défauts qu'on veut voir, comme un écran qui lit une table
-- que la RLS ferme au terrain. Ici, mon_role() rend le rôle de l'aperçu :
-- toutes les politiques, voit_les_prix() compris, se comportent comme pour un
-- vrai technicien ou sous-traitant.
--
-- Ce qui ne change pas : l'identité. On voit l'application d'un technicien,
-- avec ses propres interventions à soi ; on ne se fait pas passer pour Alex.
-- Ce qu'on fait pendant l'aperçu est réellement enregistré, à son propre nom.
-- Se faire passer pour quelqu'un d'autre permettrait de signer une fiche
-- fluides ou de noter une arrivée à sa place : hors de question.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Le rôle de l'aperçu
--
-- Seulement des rôles en dessous de la direction : l'aperçu ne peut que
-- retirer des droits, jamais en donner.
-- -----------------------------------------------------------------------------

alter table membre add column if not exists apercu_role text;

alter table membre drop constraint if exists membre_apercu_role_check;
alter table membre add constraint membre_apercu_role_check
  check (apercu_role in ('chef_chantier', 'technicien', 'sous_traitant'));

comment on column membre.apercu_role is
  'Mode démonstration : le rôle dont la direction emprunte les droits. Vide hors démonstration.';


-- -----------------------------------------------------------------------------
-- 2. mon_role(), qui le lit
--
-- L'aperçu n'est honoré que pour la direction. Un apercu_role resté sur un
-- membre rétrogradé, ou posé à la main sur un technicien, ne peut donc pas lui
-- donner le rôle de chef de chantier.
-- -----------------------------------------------------------------------------

create or replace function mon_role()
returns text language sql stable security definer set search_path = public as $$
  select case when role = 'direction' then coalesce(apercu_role, role) else role end
    from membre where user_id = auth.uid() and actif limit 1
$$;


-- -----------------------------------------------------------------------------
-- 3. Entrer et sortir
--
-- Par fonctions, parce qu'en aperçu on n'a justement plus le droit de
-- modifier sa propre ligne `membre` : sans elles, on resterait coincé dans le
-- rôle de technicien. La sortie est ouverte à tous et ne touche qu'à soi.
-- -----------------------------------------------------------------------------

create or replace function entrer_apercu(p_role text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if p_role is null or p_role not in ('chef_chantier', 'technicien', 'sous_traitant') then
    raise exception 'Rôle de démonstration inconnu : %.', p_role;
  end if;
  update membre set apercu_role = p_role
   where user_id = auth.uid() and actif and role = 'direction';
  if not found then
    raise exception 'Le mode démonstration est réservé à la direction.';
  end if;
  return p_role;
end $$;

create or replace function quitter_apercu()
returns void language sql security definer set search_path = public as $$
  update membre set apercu_role = null where user_id = auth.uid()
$$;

revoke all on function entrer_apercu(text) from public, anon;
revoke all on function quitter_apercu() from public, anon;
grant execute on function entrer_apercu(text) to authenticated;
grant execute on function quitter_apercu() to authenticated;


-- -----------------------------------------------------------------------------
-- 4. Vérification
--
-- La direction entre en aperçu technicien : mon_role() et voit_les_prix()
-- doivent changer, et une table réservée aux prix doit se fermer pour de vrai.
-- Puis elle sort. Un technicien, s'il y en a un, ne doit ni entrer en aperçu
-- ni profiter d'un apercu_role posé à la main. Bloc annulé à la fin.
-- -----------------------------------------------------------------------------

do $$
declare
  v_direction membre; v_poseur membre; v_n integer; v_refus boolean;
  v_echecs text[] := '{}';
begin
  select m.* into v_direction from membre m
   where m.actif and m.role = 'direction' order by m.created_at limit 1;
  if v_direction.id is null then
    raise notice 'Aucun membre de direction : vérification sautée.';
    return;
  end if;
  select m.* into v_poseur from membre m
   where m.actif and m.entreprise_id = v_direction.entreprise_id
     and m.role in ('technicien', 'sous_traitant')
   order by m.created_at limit 1;

  begin
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_direction.user_id, 'role', 'authenticated')::text, true);
    set local role authenticated;

    if mon_role() <> 'direction' or not voit_les_prix() then
      v_echecs := array_append(v_echecs, 'la direction n''est pas direction avant l''aperçu');
    end if;

    perform entrer_apercu('technicien');
    if mon_role() <> 'technicien' or voit_les_prix() then
      v_echecs := array_append(v_echecs, 'l''aperçu technicien ne change pas les droits');
    end if;
    select count(*) into v_n from parametres;
    if v_n <> 0 then
      v_echecs := array_append(v_echecs, 'en aperçu technicien, les paramètres (et leurs prix) restent lisibles');
    end if;

    perform quitter_apercu();
    if mon_role() <> 'direction' then
      v_echecs := array_append(v_echecs, 'la sortie de l''aperçu ne rend pas le rôle de direction');
    end if;

    v_refus := false;
    begin
      perform entrer_apercu('direction');
    exception when raise_exception then v_refus := true;
    end;
    if not v_refus then
      v_echecs := array_append(v_echecs, 'un aperçu « direction » a été accepté');
    end if;

    if v_poseur.id is not null then
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_poseur.user_id, 'role', 'authenticated')::text, true);
      v_refus := false;
      begin
        perform entrer_apercu('chef_chantier');
      exception when raise_exception then v_refus := true;
      end;
      if not v_refus then
        v_echecs := array_append(v_echecs, 'un technicien a pu se donner le rôle de chef de chantier');
      end if;

      reset role;
      update membre set apercu_role = 'chef_chantier' where id = v_poseur.id;
      set local role authenticated;
      if mon_role() <> v_poseur.role then
        v_echecs := array_append(v_echecs, 'un apercu_role posé sur un technicien change ses droits');
      end if;
    else
      raise notice 'Aucun technicien : le refus d''élévation n''a pas été éprouvé.';
    end if;
    reset role;

    raise exception using errcode = 'P0001', message = '__annulation_38__';
  exception when others then
    if sqlerrm <> '__annulation_38__' then raise; end if;
  end;

  if exists (select 1 from membre where apercu_role is not null and id in (v_direction.id, v_poseur.id)) then
    v_echecs := array_append(v_echecs, 'la vérification a laissé un aperçu en place');
  end if;

  if cardinality(v_echecs) > 0 then
    raise exception 'SQL 38 : vérification en échec — %', array_to_string(v_echecs, ' ; ');
  end if;
  raise notice 'SQL 38 appliqué. La direction peut voir Batinium avec les droits d''un chef de chantier, d''un technicien ou d''un sous-traitant.';
end $$;
