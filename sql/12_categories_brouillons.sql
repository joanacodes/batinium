-- =============================================================================
-- BATINIUM — 12. Catégories, périodicité personnalisée, produits en brouillon
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 11.
-- Le script est rejouable : chaque bloc vérifie l'état avant d'agir, on peut
-- le relancer sans rien casser.
--
-- Quatre choses :
--   1. une catégorie « certification » sur les charges et sur les dépenses ;
--   2. une périodicité « personnalisée », exprimée en mois ;
--   3. la sous-traitance retirée des dépenses, pour ne plus la compter deux fois ;
--   4. des produits en brouillon, créés par import et relus avant publication.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Outil interne : retirer une contrainte CHECK sans connaître son nom
--
-- Les contraintes écrites en ligne dans 01 et 09 ont été nommées par Postgres.
-- Selon l'ordre des exécutions passées, le nom peut différer d'une base à
-- l'autre. On les retrouve donc par la colonne qu'elles contrôlent.
-- -----------------------------------------------------------------------------

create or replace function _retirer_check(p_table text, p_colonne text)
returns void language plpgsql as $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = p_table::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%' || p_colonne || '%'
  loop
    execute format('alter table %I drop constraint %I', p_table, c.conname);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 1. Charges fixes : catégorie « certification » et périodicité personnalisée
--
-- Une qualification RGE, un Qualibat, une attestation de capacité fluides se
-- renouvellent à échéance fixe et coûtent tous les ans : c'est une charge, pas
-- un achat. Elle méritait sa ligne plutôt que de finir dans « Autre », où
-- personne ne la retrouve au moment de décider si elle vaut encore son prix.
-- -----------------------------------------------------------------------------

select _retirer_check('charge_fixe', 'categorie');

alter table charge_fixe
  add constraint charge_fixe_categorie_check
  check (categorie in ('abonnement','loyer','vehicule','outillage','assurance',
                       'telephonie','banque','comptabilite','cotisation',
                       'certification','autre'));

-- Certaines charges ne tombent ni tous les mois, ni tous les ans : un contrôle
-- tous les cinq ans, une visite tous les deux ans. Le nombre de mois est saisi.
alter table charge_fixe
  add column if not exists mois_personnalises integer;

comment on column charge_fixe.mois_personnalises is
  'Nombre de mois entre deux échéances quand periodicite = personnalisee. Nul sinon.';

select _retirer_check('charge_fixe', 'periodicite');

alter table charge_fixe
  add constraint charge_fixe_periodicite_check
  check (periodicite in ('mensuelle','trimestrielle','semestrielle','annuelle','personnalisee'));

-- Le couple périodicité / nombre de mois ne peut pas être incohérent : sans
-- cette contrainte, une charge « personnalisée » sans nombre de mois serait
-- silencieusement ramenée au mois, et le coût mensuel affiché serait faux.
select _retirer_check('charge_fixe', 'mois_personnalises');

-- Écrit en CASE et non en OR : une contrainte CHECK qui vaut NULL est tenue
-- pour satisfaite par Postgres. La version en OR laissait donc passer très
-- exactement le cas qu'on voulait interdire, une périodicité personnalisée
-- sans nombre de mois, puisque « null between 1 and 240 » vaut null.
alter table charge_fixe
  add constraint charge_fixe_mois_personnalises_check
  check (
    case periodicite
      when 'personnalisee'
        then mois_personnalises is not null and mois_personnalises between 1 and 240
      else mois_personnalises is null
    end
  );


-- -----------------------------------------------------------------------------
-- 2. Dépenses : « certification » entre, « sous_traitance » sort
--
-- Le coût d'un sous-traitant est déjà saisi ailleurs : dans le prix d'achat de
-- la ligne du devis qui porte sa prestation, et, pour ce qui est réglé hors
-- devis, dans paiement_equipe. Le laisser aussi en catégorie de dépense, c'est
-- offrir un troisième endroit pour le même euro — et le compter deux fois dans
-- le coût du chantier sans que rien ne le signale.
--
-- Les lignes existantes ne sont pas supprimées : elles passent en « autre » et
-- portent la trace de leur ancienne catégorie, pour être retrouvées et
-- arbitrées à la main.
-- -----------------------------------------------------------------------------

do $$
declare n integer;
begin
  update depense
     set categorie = 'autre',
         notes = trim(both e'\n' from
                   coalesce(notes, '') || e'\n' ||
                   'Anciennement classée en sous-traitance. Vérifier qu''elle n''est pas ' ||
                   'déjà comptée dans le prix d''achat d''une ligne de devis ou dans Équipe.')
   where categorie = 'sous_traitance';
  get diagnostics n = row_count;
  if n > 0 then
    raise notice 'Dépenses reclassées de sous_traitance vers autre : %', n;
  end if;
end $$;

select _retirer_check('depense', 'categorie');

alter table depense
  add constraint depense_categorie_check
  check (categorie in ('materiel','outillage','carburant','peage','repas',
                       'fourniture','vehicule','formation','certification','autre'));


-- -----------------------------------------------------------------------------
-- 3. Coût mensuel : trois arguments, aucun par défaut
--
-- La version à deux arguments ne peut plus répondre juste depuis qu'il existe
-- une périodicité personnalisée. On ne lui ajoute pas un troisième argument
-- facultatif : un appel resté à deux arguments continuerait de compiler et
-- diviserait par un, en silence. Trois arguments obligatoires forcent chaque
-- appelant à dire ce qu'il sait, et le compilateur fait le reste.
-- -----------------------------------------------------------------------------

do $$
declare f record;
begin
  for f in
    select oid::regprocedure as signature
    from pg_proc
    where proname = 'cout_mensuel'
      and pronamespace = 'public'::regnamespace
  loop
    execute format('drop function %s', f.signature);
  end loop;
end $$;

create function cout_mensuel(p_montant numeric, p_periodicite text, p_mois integer)
returns numeric language sql immutable as $$
  select round(
    coalesce(p_montant, 0) / greatest(
      case p_periodicite
        when 'mensuelle'      then 1
        when 'trimestrielle'  then 3
        when 'semestrielle'   then 6
        when 'annuelle'       then 12
        when 'personnalisee'  then coalesce(p_mois, 1)
        else 1
      end, 1),
    2)
$$;

comment on function cout_mensuel(numeric, text, integer) is
  'Ramène un montant au mois. Le troisième argument n''a pas de valeur par défaut : '
  'une périodicité personnalisée sans nombre de mois est une erreur d''appel, pas un cas limite.';


-- -----------------------------------------------------------------------------
-- 4. Produits en brouillon
--
-- Un catalogue repris d'un ancien logiciel ou lu dans un devis arrive toujours
-- approximatif : désignations tronquées, prix d'achat absents, doublons. Le
-- publier tel quel abîme le catalogue, qui sert ensuite à chiffrer.
--
-- Un brouillon est donc un produit ordinaire, avec un drapeau : il n'apparaît
-- ni au catalogue ni dans le sélecteur de lignes de devis tant qu'il n'a pas
-- été relu. Rien de nouveau à modéliser, rien à recopier à la publication.
-- -----------------------------------------------------------------------------

alter table produit
  add column if not exists brouillon  boolean not null default false,
  add column if not exists origine    text,
  add column if not exists importe_le timestamptz;

comment on column produit.brouillon is
  'Vrai tant que la référence n''a pas été relue. Exclue du catalogue et des devis.';
comment on column produit.origine is
  'D''où vient la référence : import_csv, analyse_texte, ia… Nul si elle a été saisie à la main.';
comment on column produit.importe_le is
  'Date de l''import. Sert à retrouver un lot entier pour le corriger ou le jeter.';

-- L'écran des brouillons ne lit que le petit tas non relu, pas tout le catalogue.
create index if not exists produit_brouillon_idx
  on produit (entreprise_id, brouillon)
  where brouillon;


-- -----------------------------------------------------------------------------
-- 5. Ménage et vérification
-- -----------------------------------------------------------------------------

drop function _retirer_check(text, text);

do $$
declare
  n_charges  integer;
  n_depenses integer;
begin
  select count(*) into n_charges  from charge_fixe where periodicite = 'personnalisee';
  select count(*) into n_depenses from depense     where categorie   = 'sous_traitance';

  if n_depenses > 0 then
    raise exception 'Il reste % dépense(s) en sous_traitance : la reprise a échoué.', n_depenses;
  end if;

  raise notice 'SQL 12 appliqué. Charges en périodicité personnalisée : %.', n_charges;
end $$;
