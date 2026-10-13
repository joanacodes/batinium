-- =============================================================================
-- BATINIUM — 26. Correction de l'anonymisation
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 25.
-- Rejouable.
--
-- Le SQL 25 anonymisait toute fiche, y compris celles portant des factures
-- émises. C'était une erreur, et la bonne question était : à quoi sert de
-- garder dix ans une facture dont on ne sait plus à qui elle a été adressée ?
--
-- Réponse : à rien. Une facture doit porter l'identité et l'adresse de son
-- destinataire — c'est une mention obligatoire (article L. 441-9 du code de
-- commerce, article 242 nonies A de l'annexe II au CGI). Effacer le nom d'un
-- client facturé ne protège pas ses données : ça rend la facture non conforme,
-- et l'entreprise en défaut.
--
-- La conservation légale l'emporte sur l'effacement, et le RGPD le prévoit
-- lui-même à l'article 17.3.b. L'anonymisation devient donc conditionnelle.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Deux cas, deux comportements
--
-- Sans facture émise — un prospect, un client devisé mais jamais facturé :
-- anonymisation complète, comme prévu.
--
-- Avec facture émise : anonymisation partielle. Tout ce qui n'est pas exigé
-- par la facture s'efface — enregistrements d'appel, transcriptions, notes
-- internes, contraintes d'accès, contenu du fil. Le nom et l'adresse restent
-- jusqu'à l'expiration du délai de conservation, et la fonction dit à quelle
-- date la fiche pourra être effacée pour de bon.
--
-- Ce n'est pas un refus déguisé : c'est ce que la personne a le droit
-- d'obtenir, et rien de plus ne peut lui être promis honnêtement.
-- -----------------------------------------------------------------------------

create or replace function anonymiser_tiers(p_tiers uuid, p_motif text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_entreprise   uuid := mon_entreprise();
  v_nom          text;
  v_pseudo       text;
  n_factures     integer;
  v_derniere     date;
  v_liberation   date;
  n_devis        integer;
  n_fils         integer;
  v_compte_rendu text;
begin
  if mon_role() <> 'direction' then
    raise exception 'Seule la direction peut anonymiser une fiche.';
  end if;

  select nom into v_nom from tiers where id = p_tiers and entreprise_id = v_entreprise;
  if v_nom is null then raise exception 'Fiche introuvable.'; end if;

  select count(*), max(date_emission) into n_factures, v_derniere
    from facture where tiers_id = p_tiers and statut <> 'brouillon';
  select count(*) into n_devis from devis where tiers_id = p_tiers;

  -- Dix ans à compter de la clôture de l'exercice, approché par le 31 décembre
  -- de l'année de la dernière facture. Une approximation prudente : elle
  -- repousse la date plutôt que de l'avancer.
  v_liberation := case when v_derniere is null then null
                       else (date_trunc('year', v_derniere) + interval '11 years - 1 day')::date
                  end;

  -- Ce qui s'efface dans tous les cas : rien de tout cela ne figure sur une
  -- facture, et rien n'oblige à le conserver.
  update site set contraintes_acces = null, notes = null where tiers_id = p_tiers;

  update demande set
    transcription = null, enregistrement_url = null, resume = null, besoin = 'Contenu effacé'
  where tiers_id = p_tiers;

  update fil set contenu = null, sujet = 'Contenu effacé', metadonnees = null
  where tiers_id = p_tiers;
  get diagnostics n_fils = row_count;

  if n_factures = 0 then
    -- Aucune obligation comptable : la fiche part entièrement.
    v_pseudo := 'Client anonymisé ' || upper(substr(replace(p_tiers::text, '-', ''), 1, 4));
    update tiers set
      nom = v_pseudo, email = null, telephone = null,
      adresse = null, code_postal = null, ville = null, siret = null, notes = null
    where id = p_tiers;
    update site set adresse = 'Adresse effacée', code_postal = null, ville = null
      where tiers_id = p_tiers;
    update demande set nom = v_pseudo, email = null, telephone = null, adresse = null
      where tiers_id = p_tiers;

    v_compte_rendu := format(
      'Fiche « %s » entièrement anonymisée en « %s ». Aucune facture émise : rien '
   || 'n''obligeait à conserver son identité. Effacé : nom, coordonnées, adresses, notes, '
   || '%s entrée(s) de fil, transcriptions d''appel. %s devis conservé(s) sans identité.',
      v_nom, v_pseudo, n_fils, n_devis);
  else
    -- Facture émise : le nom et l'adresse sont une mention obligatoire de la
    -- facture. Les effacer rendrait le document non conforme.
    -- Les notes libres partent et sont remplacées par la consigne : une seule
    -- affectation, sinon Postgres refuse deux assignations d'une même colonne.
    update tiers set
      email = null, telephone = null,
      notes = format('Effacement partiel demandé le %s. Identité conservée jusqu''au %s '
                  || '(obligation comptable). Ne pas réutiliser cette fiche.',
                     to_char(current_date, 'DD/MM/YYYY'), to_char(v_liberation, 'DD/MM/YYYY'))
    where id = p_tiers;

    update demande set email = null, telephone = null where tiers_id = p_tiers;

    v_compte_rendu := format(
      'Fiche « %s » partiellement anonymisée. Effacé : e-mail, téléphone, notes libres, '
   || 'contraintes d''accès, %s entrée(s) de fil, transcriptions et enregistrements '
   || 'd''appel. Conservé : le nom et l''adresse, mentions obligatoires des %s facture(s) '
   || 'émise(s) (article L. 441-9 du code de commerce). Effacement complet possible à '
   || 'partir du %s.',
      v_nom, n_fils, n_factures, to_char(v_liberation, 'DD/MM/YYYY'));
  end if;

  insert into effacement (entreprise_id, tiers_id, nom_efface, motif, conserve, traite_par)
  values (v_entreprise, p_tiers, v_nom, p_motif,
          case when n_factures = 0
               then format('%s devis, aucune facture : identité entièrement effacée.', n_devis)
               else format('%s facture(s) émise(s) : nom et adresse conservés jusqu''au %s.',
                           n_factures, to_char(v_liberation, 'DD/MM/YYYY'))
          end,
          mon_membre());

  return v_compte_rendu;
end $$;

comment on function anonymiser_tiers(uuid, text) is
  'Efface ce qui peut l''être. Complet sans facture émise, partiel sinon : le nom et '
  'l''adresse sont des mentions obligatoires de la facture, les effacer la rendrait non conforme.';


-- -----------------------------------------------------------------------------
-- 2. Savoir à l'avance ce qui va se passer
--
-- L'écran doit pouvoir annoncer l'étendue de l'effacement avant qu'on clique,
-- pas après. Un acte irréversible dont on découvre la portée une fois fait est
-- un piège.
-- -----------------------------------------------------------------------------

create or replace function portee_effacement(p_tiers uuid)
returns table (factures integer, devis integer, liberation date)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::integer from facture
      where tiers_id = p_tiers and statut <> 'brouillon'),
    (select count(*)::integer from devis where tiers_id = p_tiers),
    (select (date_trunc('year', max(date_emission)) + interval '11 years - 1 day')::date
       from facture where tiers_id = p_tiers and statut <> 'brouillon')
$$;


-- -----------------------------------------------------------------------------
-- 3. Vérification
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'portee_effacement') then
    raise exception 'La fonction portee_effacement n''a pas été créée.';
  end if;
  raise notice 'SQL 26 appliqué. Anonymisation conditionnelle : complète sans facture, partielle sinon.';
end $$;
