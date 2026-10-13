-- =============================================================================
-- BATINIUM — 29. Un matériel de chantier ne se saisit qu'une fois
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 28.
-- Rejouable : la reprise ne prend que ce qui reste à prendre.
--
-- Le coût réel d'un chantier additionnait les lignes de facture fournisseur ET
-- les dépenses qui lui étaient rattachées. Un même matériel saisi des deux
-- côtés comptait deux fois, et rien ne l'empêchait.
--
-- La correction ne consiste ni à interdire ni à avertir, mais à retirer
-- l'ambiguïté : une dépense « matériel » rattachée à un chantier EST une
-- facture d'achat à une seule ligne. Deux tables décrivaient la même chose à
-- deux granularités.
--
-- Après ce script :
--   le matériel d'un chantier vient des achats, sans exception ;
--   les dépenses gardent ce qui n'est pas du matériel — carburant, péages,
--   repas, véhicule, formation — et le matériel hors chantier, qui est un
--   frais général et n'a rien à rapprocher.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Ce qui manquait à `achat` pour absorber une dépense
--
-- Un ticket de comptoir au nom d'un salarié ne permet pas de récupérer la TVA.
-- L'information vivait sur la dépense ; sans elle, la reprise la perdrait, et
-- on récupérerait une TVA qu'on n'a pas le droit de récupérer.
-- -----------------------------------------------------------------------------

alter table achat
  add column if not exists tva_recuperable boolean not null default true,
  add column if not exists membre_id uuid references membre(id) on delete set null;

comment on column achat.tva_recuperable is
  'Faux pour un ticket au nom d''un salarié : la TVA n''est alors pas récupérable.';
comment on column achat.membre_id is
  'Qui a engagé la dépense, pour un achat de comptoir.';


-- -----------------------------------------------------------------------------
-- 2. Reprise des dépenses concernées
--
-- Une facture d'achat par dépense, avec sa ligne unique déjà rattachée au
-- chantier. La provenance est inscrite dans les notes : si la reprise s'est
-- mal passée, on sait quoi chercher.
-- -----------------------------------------------------------------------------

do $$
declare
  d record;
  v_achat uuid;
  n integer := 0;
begin
  for d in
    select * from depense
     where chantier_id is not null
       and categorie in ('materiel', 'fourniture')
  loop
    insert into achat (entreprise_id, fournisseur, numero, date_facture,
                       montant_ht, statut, paye_le, tva_recuperable, membre_id, notes)
    values (
      d.entreprise_id,
      coalesce(nullif(trim(d.fournisseur), ''), 'Fournisseur non précisé'),
      coalesce(nullif(trim(d.numero_piece), ''), 'REPRIS-' || substr(d.id::text, 1, 8)),
      d.date_achat,
      d.montant_ht,
      case when d.paye_le is not null then 'paye' else 'rapproche' end,
      d.paye_le,
      d.facture_au_nom_entreprise,
      d.membre_id,
      trim(both e'\n' from coalesce(d.notes, '') || e'\n'
        || 'Repris de la dépense « ' || d.libelle || ' » lors du SQL 29.')
    )
    -- Deux dépenses sans numéro de pièce chez le même fournisseur le même
    -- jour tomberaient sur la même clé : on les laisse alors où elles sont
    -- plutôt que d'en perdre une.
    on conflict do nothing
    returning id into v_achat;

    if v_achat is not null then
      insert into achat_ligne (entreprise_id, achat_id, chantier_id, position,
                               designation, unite, quantite, prix_unitaire_ht, taux_tva)
      values (d.entreprise_id, v_achat, d.chantier_id, 0,
              d.libelle, 'lot', 1, d.montant_ht, d.taux_tva);

      delete from depense where id = d.id;
      n := n + 1;
    end if;
    v_achat := null;
  end loop;

  if n > 0 then
    raise notice 'Dépenses de matériel reprises en factures d''achat : %', n;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3. La règle, tenue par la base
--
-- Énonçable en une phrase : du matériel rattaché à un chantier passe par les
-- achats. C'est là qu'il se rapproche de ce qui était prévu, et qu'on voit ce
-- que le fournisseur a réellement facturé.
-- -----------------------------------------------------------------------------

do $$
declare n integer;
begin
  select count(*) into n from depense
   where chantier_id is not null and categorie in ('materiel', 'fourniture');
  if n > 0 then
    raise exception
      '% dépense(s) de matériel restent rattachées à un chantier : la reprise n''a pas tout pris. '
      'Vérifiez-les avant de rejouer ce script.', n;
  end if;
end $$;

alter table depense drop constraint if exists depense_materiel_hors_chantier;
alter table depense add constraint depense_materiel_hors_chantier
  check (chantier_id is null or categorie not in ('materiel', 'fourniture'));

comment on constraint depense_materiel_hors_chantier on depense is
  'Le matériel d''un chantier passe par les achats : sinon il compte deux fois dans son coût réel.';


-- -----------------------------------------------------------------------------
-- 4. Vérification
-- -----------------------------------------------------------------------------

do $$
declare v_entreprise uuid; v_chantier uuid;
begin
  select id into v_entreprise from entreprise limit 1;
  select id into v_chantier   from chantier where entreprise_id = v_entreprise limit 1;

  if v_chantier is not null then
    begin
      insert into depense (entreprise_id, libelle, categorie, montant_ht, chantier_id)
        values (v_entreprise, '__essai__', 'materiel', 10, v_chantier);
      raise exception 'ÉCHEC : une dépense de matériel sur chantier est encore acceptée.';
    exception when check_violation then
      null;
    end;

    -- Hors chantier, elle doit rester possible : c'est un frais général.
    insert into depense (entreprise_id, libelle, categorie, montant_ht)
      values (v_entreprise, '__essai__', 'materiel', 10);
    delete from depense where libelle = '__essai__';
  end if;

  raise notice 'SQL 29 appliqué. Le matériel de chantier passe par les achats, celui d''atelier reste une dépense.';
end $$;
