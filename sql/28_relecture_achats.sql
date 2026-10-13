-- =============================================================================
-- BATINIUM — 28. Relecture du module achats
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 27.
-- Rejouable.
--
-- Deux défauts trouvés en relisant ce qui a été livré au SQL 24.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. L'écart calculé sur une moyenne noyait la dérive récente
--
-- `v_ecart_achat` comparait le prix catalogue à la moyenne de tous les achats
-- passés. Une référence achetée douze fois à 780 € puis deux fois à 845 €
-- affichait un écart de 1,5 % : rassurant, et faux. Ce qui compte pour les
-- devis à venir, c'est le dernier prix payé, pas la moyenne d'une histoire.
--
-- La vue rend donc les deux, et l'écart se calcule sur le dernier prix. La
-- moyenne reste affichée : un dernier prix isolé peut être une erreur de
-- saisie, et les voir côte à côte permet de trancher.
-- -----------------------------------------------------------------------------

drop view if exists v_ecart_achat cascade;

create view v_ecart_achat with (security_invoker = false) as
select
  l.entreprise_id,
  p.id                                          as produit_id,
  p.reference,
  p.designation,
  p.prix_achat_ht                               as prix_catalogue,
  round(avg(l.prix_unitaire_ht), 2)             as prix_facture_moyen,
  -- Le prix de la facture la plus récente, celui qui vaudra demain.
  (array_agg(l.prix_unitaire_ht order by a.date_facture desc, a.created_at desc))[1]
                                                as prix_facture_dernier,
  max(a.date_facture)                           as dernier_achat,
  count(*)                                      as nombre_achats,
  case when p.prix_achat_ht > 0 then
    round((
      (array_agg(l.prix_unitaire_ht order by a.date_facture desc, a.created_at desc))[1]
      - p.prix_achat_ht) / p.prix_achat_ht * 100, 1)
  end                                           as ecart_pct
from achat_ligne l
join achat   a on a.id = l.achat_id
join produit p on p.id = l.produit_id
where l.entreprise_id = mon_entreprise()
  and voit_les_prix()
group by l.entreprise_id, p.id, p.reference, p.designation, p.prix_achat_ht;

grant select on v_ecart_achat to authenticated;

comment on view v_ecart_achat is
  'Prix catalogue contre prix facturé. L''écart porte sur le DERNIER prix : c''est celui qui vaudra sur le prochain devis.';


-- -----------------------------------------------------------------------------
-- 2. Deux fois la même facture pouvaient entrer
--
-- L'unicité portait sur (entreprise_id, tiers_id, numero). Or `tiers_id` reste
-- presque toujours nul — c'est le champ texte `fournisseur` qui est rempli —
-- et Postgres tient deux NULL pour distincts. Deux saisies de la facture
-- FA-88214 de Cedeo passaient donc sans un mot, et le coût du chantier
-- doublait.
-- -----------------------------------------------------------------------------

alter table achat drop constraint if exists achat_entreprise_id_tiers_id_numero_key;

create unique index if not exists achat_reference_unique
  on achat (entreprise_id, lower(fournisseur), numero);

comment on index achat_reference_unique is
  'Empêche la double saisie d''une même facture. Sans numéro, la contrainte ne joue pas : deux NULL restent distincts.';


-- -----------------------------------------------------------------------------
-- 3. Vérification
-- -----------------------------------------------------------------------------

do $$
declare v_entreprise uuid; n integer;
begin
  if pg_get_viewdef('v_ecart_achat'::regclass) not like '%mon_entreprise()%' then
    raise exception 'La vue des écarts a perdu son cloisonnement.';
  end if;

  select id into v_entreprise from entreprise limit 1;
  if v_entreprise is not null then
    -- On tente vraiment la double saisie : une contrainte qu'on n'a pas
    -- éprouvée est une contrainte dont on ignore si elle sert.
    begin
      insert into achat (entreprise_id, fournisseur, numero, date_facture)
        values (v_entreprise, 'Vérification', '__doublon__', current_date),
               (v_entreprise, 'vérification', '__doublon__', current_date);
      raise exception 'ÉCHEC : la double saisie est encore acceptée.';
    exception when unique_violation then
      null;
    end;
    delete from achat where numero = '__doublon__';
    select count(*) into n from achat where numero = '__doublon__';
    if n > 0 then raise exception 'Nettoyage de la vérification incomplet.'; end if;
  end if;

  raise notice 'SQL 28 appliqué. Écart calculé sur le dernier prix, double saisie d''une facture refusée.';
end $$;
