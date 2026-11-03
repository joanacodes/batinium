-- =============================================================================
-- BATINIUM — 36. Ce que le client demande en plus, noté sur le chantier
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase. Rejouable.
-- Ne touche qu'à `demande` (colonnes et deux politiques) et à `document` :
-- indépendant des SQL 32 et 33, et compatible avec eux (ils réécrivent la
-- politique de `document` sans retirer de colonne).
--
-- Sur place, le client — ou le client du client : l'occupant, le voisin, le
-- syndic — demande quelque chose en plus. Aujourd'hui, ça repart dans la tête
-- du technicien, au mieux dans un SMS à Fabrice. Ça doit devenir une demande,
-- dans la même liste que les appels et les e-mails, avec ce qu'il faut pour
-- y donner suite :
--
-- - la suite attendue : à facturer (fait ou à faire, dans le cadre du
--   chantier), SAV (un défaut à reprendre), nouveau devis (autre chose) ;
-- - le chantier et l'intervention d'où elle vient, pour retrouver l'adresse,
--   les machines et l'historique sans rien ressaisir ;
-- - qui l'a notée ;
-- - les photos et vidéos prises sur place.
--
-- Les coordonnées : si c'est le client du chantier, la demande pointe sa
-- fiche (`tiers_id`) et ne recopie rien. Si c'est quelqu'un d'autre, ses
-- coordonnées vont dans les champs de la demande, comme pour un appel.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. La demande, complétée
-- -----------------------------------------------------------------------------

alter table demande
  add column if not exists suite           text,
  add column if not exists chantier_id     uuid references chantier(id) on delete set null,
  add column if not exists intervention_id uuid references intervention(id) on delete set null,
  add column if not exists cree_par        uuid references membre(id) on delete set null;

alter table demande drop constraint if exists demande_suite_check;
alter table demande add constraint demande_suite_check
  check (suite in ('a_facturer', 'sav', 'nouveau_devis'));

-- L'auteur se prend dans la session, pas dans ce qu'envoie le téléphone. Le
-- webhook Allô, qui n'a pas de session, laisse le champ vide : c'est juste.
alter table demande alter column cree_par set default mon_membre();

create index if not exists demande_chantier_idx
  on demande (entreprise_id, chantier_id) where chantier_id is not null;

comment on column demande.suite is
  'Ce que la demande appelle : a_facturer, sav ou nouveau_devis. Posée par le terrain, modifiable par le bureau.';
comment on column demande.chantier_id is
  'Le chantier où la demande a été faite. Donne l''adresse, les machines et l''historique sans ressaisie.';


-- -----------------------------------------------------------------------------
-- 2. Les photos et vidéos de la demande
--
-- Elles restent des pièces du chantier (`chantier_id`) : c'est ce qui permet
-- au technicien de les déposer, la politique de `document` ouvrant les pièces
-- de chantier à toute l'équipe. `demande_id` est un rattachement de plus, pour
-- que le bureau les voie sur la demande. Supprimer la demande ne supprime pas
-- les photos : elles restent dans le journal du chantier.
-- -----------------------------------------------------------------------------

alter table document
  add column if not exists demande_id uuid references demande(id) on delete set null;

create index if not exists document_demande_idx
  on document (entreprise_id, demande_id) where demande_id is not null;


-- -----------------------------------------------------------------------------
-- 3. Ce que le terrain a le droit d'en faire
--
-- Écrit ici, et non laissé à la politique `acces` du SQL 01 : celle-ci ouvre
-- toute la table à toute l'équipe, et là où elle a été resserrée — la liste
-- des demandes, transcriptions d'appel comprises, n'a pas à descendre vers un
-- technicien — le terrain ne pourrait plus rien noter. Ces deux politiques lui
-- donnent juste ce qu'il faut : écrire une demande du terrain, à son nom, dans
-- son entreprise, et relire celles qu'il a notées (l'application relit la
-- ligne qu'elle vient d'écrire). Rien sur les appels, rien sur les demandes
-- des autres. Là où `acces` est encore ouverte, elles n'ajoutent rien.
-- -----------------------------------------------------------------------------

drop policy if exists terrain_note on demande;
create policy terrain_note on demande for insert to authenticated
  with check (entreprise_id = mon_entreprise() and source = 'terrain'
              and cree_par = mon_membre());

drop policy if exists terrain_relit on demande;
create policy terrain_relit on demande for select to authenticated
  using (entreprise_id = mon_entreprise() and source = 'terrain'
         and cree_par = mon_membre());


-- -----------------------------------------------------------------------------
-- 4. Vérification
--
-- Rejouée en rôle `authenticated`, avec un technicien s'il y en a un : c'est
-- lui qui notera ces demandes. Le compte essayé n'appartient qu'à une seule
-- entreprise : la session d'un compte inscrit dans deux entreprises n'en
-- retient qu'une, pas forcément celle de la ligne choisie, et l'essai
-- échouerait pour une raison étrangère à ce script.
--
-- Les politiques du terrain sont éprouvées seules : le temps de l'essai, les
-- autres politiques permissives de `demande` sont retirées, à commencer par
-- l'`acces` du SQL 01, qui laisserait tout passer. Les restrictives restent,
-- puisque l'application les subirait aussi. Le technicien doit pouvoir noter
-- la demande, la relire et y joindre une photo ; il ne doit ni lire un appel,
-- ni écrire une demande d'une autre source ou au nom d'un autre ; une suite
-- inconnue est refusée ; supprimer la demande laisse la photo au chantier.
-- Si la base refuse au technicien ce qu'il doit pouvoir faire, le message
-- donne les politiques qu'elle porte sur `demande`. Bloc annulé à la fin.
-- -----------------------------------------------------------------------------

do $$
declare
  v_membre membre; v_ent uuid; v_autre uuid; v_tiers uuid; v_chantier uuid;
  v_appel uuid; v_demande demande; v_doc uuid; v_lien uuid; v_n integer;
  v_refus boolean; v_politique text; v_politiques text; v_nb_politiques integer;
  v_echecs text[] := '{}';
begin
  select m.* into v_membre from membre m
   where m.actif
     and not exists (select 1 from membre x
                      where x.user_id = m.user_id and x.actif and x.id <> m.id)
   order by (m.role in ('technicien', 'sous_traitant')) desc, m.created_at
   limit 1;
  if v_membre.id is null then
    raise notice 'Aucun membre rattaché à une seule entreprise : vérification sautée.';
    return;
  end if;
  v_ent := v_membre.entreprise_id;
  select m.id into v_autre from membre m
   where m.entreprise_id = v_ent and m.id <> v_membre.id
   order by m.created_at limit 1;

  select count(*), string_agg(format('%s (%s, %s ; using %s ; check %s)', policyname, cmd,
                                     lower(permissive), coalesce(qual, '—'),
                                     coalesce(with_check, '—')), ' | ' order by policyname)
    into v_nb_politiques, v_politiques
    from pg_policies where schemaname = 'public' and tablename = 'demande';

  begin
    insert into tiers (entreprise_id, nom) values (v_ent, 'Essai SQL 36') returning id into v_tiers;
    insert into chantier (entreprise_id, numero, tiers_id, libelle)
    values (v_ent, 'ESSAI-36', v_tiers, 'Vérification SQL 36') returning id into v_chantier;
    insert into demande (entreprise_id, source, besoin)
    values (v_ent, 'telephone', 'Appel d''essai SQL 36') returning id into v_appel;

    for v_politique in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = 'demande' and permissive = 'PERMISSIVE'
         and policyname not in ('terrain_note', 'terrain_relit')
    loop
      execute format('drop policy %I on demande', v_politique);
    end loop;

    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_membre.user_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if mon_entreprise() is distinct from v_ent or mon_membre() is distinct from v_membre.id then
      raise exception 'SQL 36 : la session de « % » ne donne pas sa propre fiche membre ; mon_entreprise() ou mon_membre() ne sont plus celles des SQL 01 et 13.',
                      v_membre.nom;
    end if;

    begin
      insert into demande (entreprise_id, source, tiers_id, chantier_id, suite, besoin)
      values (v_ent, 'terrain', v_tiers, v_chantier, 'a_facturer', 'Un second split dans la chambre')
      returning * into v_demande;
    exception when insufficient_privilege then
      raise exception 'SQL 36 : la base refuse à un compte « % » de noter une demande du terrain. Politiques de demande : %',
                      v_membre.role, v_politiques;
    end;
    if v_demande.cree_par is distinct from v_membre.id then
      v_echecs := array_append(v_echecs, 'l''auteur de la demande n''a pas été pris dans la session');
    end if;

    select count(*) into v_n from demande where id = v_appel;
    if v_n <> 0 then
      v_echecs := array_append(v_echecs, 'les droits du terrain laissent lire un appel');
    end if;

    v_refus := false;
    begin
      insert into demande (entreprise_id, source, besoin) values (v_ent, 'telephone', 'Essai SQL 36');
    exception when insufficient_privilege then v_refus := true;
    end;
    if not v_refus then
      v_echecs := array_append(v_echecs, 'le terrain a pu écrire une demande d''une autre source');
    end if;

    if v_autre is not null then
      v_refus := false;
      begin
        insert into demande (entreprise_id, source, cree_par, besoin)
        values (v_ent, 'terrain', v_autre, 'Essai SQL 36');
      exception when insufficient_privilege then v_refus := true;
      end;
      if not v_refus then
        v_echecs := array_append(v_echecs, 'le terrain a pu noter une demande au nom d''un autre');
      end if;
    end if;

    insert into document (entreprise_id, chantier_id, demande_id, type, nom)
    values (v_ent, v_chantier, v_demande.id, 'photo', 'essai-36.jpg')
    returning id into v_doc;

    v_refus := false;
    begin
      insert into demande (entreprise_id, source, chantier_id, suite, besoin)
      values (v_ent, 'terrain', v_chantier, 'cadeau', 'Essai SQL 36');
    exception when check_violation then v_refus := true;
    end;
    if not v_refus then
      v_echecs := array_append(v_echecs, 'une suite inconnue a été acceptée');
    end if;

    reset role;
    delete from demande where id = v_demande.id;
    select demande_id into v_lien from document where id = v_doc;
    if not found then
      v_echecs := array_append(v_echecs, 'supprimer la demande a supprimé sa photo');
    elsif v_lien is not null then
      v_echecs := array_append(v_echecs, 'la photo pointe encore une demande supprimée');
    end if;

    raise exception using errcode = 'P0001', message = '__annulation_36__';
  exception when others then
    if sqlerrm <> '__annulation_36__' then raise; end if;
  end;

  if exists (select 1 from chantier where numero = 'ESSAI-36' and entreprise_id = v_ent) then
    v_echecs := array_append(v_echecs, 'la vérification a laissé des lignes en base');
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'demande')
     <> v_nb_politiques then
    v_echecs := array_append(v_echecs, 'la vérification n''a pas rendu les politiques de demande');
  end if;

  if cardinality(v_echecs) > 0 then
    raise exception 'SQL 36 : vérification en échec — %', array_to_string(v_echecs, ' ; ');
  end if;
  raise notice 'SQL 36 appliqué. Le terrain note ce que le client demande en plus, avec ses photos, et le pourra encore quand la liste des demandes lui sera fermée.';
end $$;
