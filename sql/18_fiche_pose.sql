-- =============================================================================
-- BATINIUM — 18. La fiche de pose
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 17.
-- Rejouable : la vue est remplacée, rien n'est détruit.
--
-- `v_fiche_pose` existe depuis le SQL 01 et n'a jamais été lue par personne.
-- Elle donnait les lignes d'un devis sans les prix, mais pas les titres de
-- lots : or ces titres sont dans `devis_lot`, table réservée à ceux qui voient
-- les prix. Un technicien recevait donc une liste plate de vingt lignes sans
-- savoir laquelle allait dans quelle pièce.
--
-- On la refait avec l'arborescence, toujours sans un seul prix.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. La vue
--
-- `security_invoker = false` : la vue s'exécute avec les droits de son
-- propriétaire et contourne la RLS des tables sous-jacentes. C'est
-- exactement ce qu'on veut — et c'est aussi pourquoi elle ne doit exposer
-- aucune colonne de prix. Le filtre sur mon_entreprise() reste le seul
-- rempart entre deux entreprises : il n'est pas décoratif.
--
-- Ce qui n'y figure pas, et n'y figurera jamais : prix_unitaire_ht,
-- prix_achat_ht, remise_pct, taux_tva. Les masquer à l'écran ne suffirait
-- pas, ils seraient dans la mémoire du téléphone du poseur.
-- -----------------------------------------------------------------------------

drop view if exists v_fiche_pose cascade;

create view v_fiche_pose with (security_invoker = false) as
select
  l.id,
  l.entreprise_id,
  l.devis_id,
  l.lot_id,
  l.position,
  l.designation,
  l.description,
  l.nature,
  l.unite,
  l.quantite,
  l.consigne_pose,
  l.emplacement,
  pr.reference,
  -- L'arborescence, aplatie en deux niveaux : une zone et son sous-lot.
  -- C'est la profondeur réelle des devis Pilotech, et deux colonnes se
  -- regroupent en mémoire sans requête récursive.
  coalesce(parent.titre, lot.titre)                    as zone,
  case when parent.id is null then null else lot.titre end as sous_lot,
  coalesce(parent.position, lot.position)              as zone_position,
  lot.position                                         as lot_position
from devis_ligne l
left join produit   pr     on pr.id     = l.produit_id
left join devis_lot lot    on lot.id    = l.lot_id
left join devis_lot parent on parent.id = lot.parent_id
where l.entreprise_id = mon_entreprise();

grant select on v_fiche_pose to authenticated;

comment on view v_fiche_pose is
  'Le devis sans aucun prix, pour le terrain. Ne jamais y ajouter de colonne tarifaire.';


-- -----------------------------------------------------------------------------
-- 2. Vérification : aucun prix ne doit pouvoir en sortir
--
-- Un garde-fou plutôt qu'un commentaire : si quelqu'un ajoute un jour une
-- colonne de prix à la vue, l'exécution de ce script échouera bruyamment.
-- -----------------------------------------------------------------------------

do $$
declare fuite text;
begin
  select string_agg(column_name, ', ') into fuite
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'v_fiche_pose'
    and (column_name like '%prix%' or column_name like '%remise%'
         or column_name like '%tva%'  or column_name like '%marge%'
         or column_name like '%coef%');

  if fuite is not null then
    raise exception 'La fiche de pose exposerait : %. Retirez ces colonnes.', fuite;
  end if;

  raise notice 'SQL 18 appliqué. Fiche de pose reconstruite, aucune colonne tarifaire.';
end $$;
