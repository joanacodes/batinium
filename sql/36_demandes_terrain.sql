-- =============================================================================
-- BATINIUM — 36. Ce que le client demande en plus, noté sur le chantier
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase. Rejouable.
-- Ne touche qu'aux tables du SQL 01 et à `document` : indépendant des SQL 32
-- et 33, et compatible avec eux (ils réécrivent la politique de `document`
-- sans retirer de colonne).
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
-- 3. Vérification
--
-- Rejouée en rôle `authenticated`, avec un technicien s'il y en a un : c'est
-- lui qui notera ces demandes. Il doit pouvoir créer la demande et y joindre
-- une photo ; une suite inconnue doit être refusée ; supprimer la demande doit
-- laisser la photo au chantier. Bloc annulé à la fin.
-- -----------------------------------------------------------------------------

do $$
declare
  v_membre membre; v_ent uuid; v_tiers uuid; v_chantier uuid;
  v_demande demande; v_doc uuid; v_refus boolean; v_lien uuid;
  v_echecs text[] := '{}';
begin
  select m.* into v_membre from membre m
   where m.actif
   order by (m.role in ('technicien', 'sous_traitant')) desc, m.created_at
   limit 1;
  if v_membre.id is null then
    raise notice 'Aucun membre : vérification sautée.';
    return;
  end if;
  v_ent := v_membre.entreprise_id;

  begin
    insert into tiers (entreprise_id, nom) values (v_ent, 'Essai SQL 36') returning id into v_tiers;
    insert into chantier (entreprise_id, numero, tiers_id, libelle)
    values (v_ent, 'ESSAI-36', v_tiers, 'Vérification SQL 36') returning id into v_chantier;

    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_membre.user_id, 'role', 'authenticated')::text, true);
    set local role authenticated;

    insert into demande (entreprise_id, source, tiers_id, chantier_id, suite, besoin)
    values (v_ent, 'terrain', v_tiers, v_chantier, 'a_facturer', 'Un second split dans la chambre')
    returning * into v_demande;
    if v_demande.cree_par is distinct from v_membre.id then
      v_echecs := array_append(v_echecs, 'l''auteur de la demande n''a pas été pris dans la session');
    end if;

    insert into document (entreprise_id, chantier_id, demande_id, type, nom)
    values (v_ent, v_chantier, v_demande.id, 'photo', 'essai-36.jpg')
    returning id into v_doc;

    v_refus := false;
    begin
      update demande set suite = 'cadeau' where id = v_demande.id;
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

  if cardinality(v_echecs) > 0 then
    raise exception 'SQL 36 : vérification en échec — %', array_to_string(v_echecs, ' ; ');
  end if;
  raise notice 'SQL 36 appliqué. Le terrain note ce que le client demande en plus, avec ses photos.';
end $$;
