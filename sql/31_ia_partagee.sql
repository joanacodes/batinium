-- =============================================================================
-- BATINIUM — 31. L'IA fournie à toutes les entreprises
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 30.
-- Rejouable.
--
-- Jusqu'ici, chaque entreprise devait apporter sa propre clé d'API. C'était
-- défendable pour un projet sur mesure, absurde pour un logiciel destiné à
-- être vendu : personne n'ouvre un compte chez un fournisseur de modèles pour
-- essayer un outil de gestion.
--
-- Batinium fournit donc la clé, et facture l'usage. Ce qui appelle
-- immédiatement la question suivante : combien un client peut-il consommer
-- avant que ça coûte plus que son abonnement ?
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Un plafond mensuel, par entreprise
--
-- Sans plafond, une clé partagée est une carte de crédit prêtée. Il ne s'agit
-- pas de se méfier des clients : un import de catalogue mal découpé, une boucle
-- dans un écran, et la facture du mois se voit sans que personne ait rien fait
-- de mal.
--
-- Deux millions de jetons par mois, c'est un ordre de grandeur confortable pour
-- un installateur — plusieurs centaines de questions à l'assistant, quelques
-- dizaines de tarifs lus, des devis dictés tous les jours. Le chiffre est en
-- base, donc modifiable client par client.
-- -----------------------------------------------------------------------------

alter table parametres
  add column if not exists quota_ia_mensuel bigint not null default 2000000;

comment on column parametres.quota_ia_mensuel is
  'Jetons autorisés par mois civil. Zéro coupe l''IA pour cette entreprise, négatif la rend illimitée.';


-- -----------------------------------------------------------------------------
-- 2. Ce qui a été consommé ce mois-ci
--
-- Lisible par la direction, pour qu'elle voie venir la limite au lieu de la
-- découvrir. En security definer parce que `journal_ia` ne se lit qu'en
-- lecture seule et qu'on veut un agrégat, pas les lignes.
-- -----------------------------------------------------------------------------

create or replace function consommation_ia(p_entreprise uuid default null)
returns table (jetons bigint, appels bigint, quota bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce(sum(j.jetons_entree + j.jetons_sortie), 0)::bigint,
    count(*)::bigint,
    (select p.quota_ia_mensuel from parametres p
      where p.entreprise_id = coalesce(p_entreprise, mon_entreprise()))
  from journal_ia j
  where j.entreprise_id = coalesce(p_entreprise, mon_entreprise())
    and j.created_at >= date_trunc('month', now())
    and j.erreur is null
$$;


-- -----------------------------------------------------------------------------
-- 3. Vérification
-- -----------------------------------------------------------------------------

do $$
declare v_entreprise uuid; r record;
begin
  select id into v_entreprise from entreprise limit 1;
  if v_entreprise is not null then
    select * into r from consommation_ia(v_entreprise);
    raise notice 'Consommation du mois : % jetons sur % autorisés, en % appel(s).',
      r.jetons, r.quota, r.appels;
  end if;
  raise notice 'SQL 31 appliqué. Plafond mensuel par entreprise en place.';
end $$;
