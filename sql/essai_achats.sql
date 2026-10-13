-- =============================================================================
-- BATINIUM — Jeu d'essai : factures fournisseurs
--
-- À exécuter dans l'éditeur SQL de Supabase, APRÈS le SQL 24.
-- Rejouable : il efface son propre jeu avant de le recréer.
--
-- Ce script ne sert qu'à essayer le module achats sans attendre d'avoir
-- saisi de vraies factures. Toutes les lignes qu'il crée portent un numéro
-- commençant par « ESSAI- », ce qui permet de tout retirer d'un coup :
--
--   delete from achat where numero like 'ESSAI-%';
--
-- Il s'appuie sur vos données réelles : il prend vos chantiers, vos produits
-- et vos lignes d'approvisionnement existants. Sur une base vide, il ne fait
-- rien et le dit.
-- =============================================================================

do $$
declare
  v_entreprise uuid;
  v_chantier   record;
  v_produit    record;
  v_achat      uuid;
  v_appro      uuid;
  n_chantiers  integer;
  n_produits   integer;
  i            integer := 0;
  v_prix       numeric;
  v_derive     numeric;
begin
  select id into v_entreprise from entreprise limit 1;
  if v_entreprise is null then
    raise notice 'Aucune entreprise en base : rien à faire.';
    return;
  end if;

  -- Ménage du jeu précédent.
  delete from achat where entreprise_id = v_entreprise and numero like 'ESSAI-%';

  select count(*) into n_chantiers from chantier where entreprise_id = v_entreprise;
  select count(*) into n_produits  from produit  where entreprise_id = v_entreprise
                                                    and coalesce(brouillon, false) = false;

  if n_chantiers = 0 or n_produits = 0 then
    raise notice 'Il faut au moins un chantier et un produit au catalogue. Trouvés : % chantier(s), % produit(s).',
                 n_chantiers, n_produits;
    return;
  end if;

  -- Une facture par chantier, dans la limite de quatre : de quoi voir le
  -- module vivre sans noyer les vraies données quand elles arriveront.
  for v_chantier in
    select id, numero, libelle from chantier
     where entreprise_id = v_entreprise
     order by created_at desc limit 4
  loop
    i := i + 1;

    insert into achat (entreprise_id, fournisseur, numero, date_facture, echeance_le,
                       statut, notes)
    values (
      v_entreprise,
      (array['Cedeo','Rexel','Daikin France','Frigo Diffusion'])[1 + (i - 1) % 4],
      'ESSAI-' || to_char(current_date - (i * 11), 'YYYYMM') || '-' || lpad(i::text, 3, '0'),
      current_date - (i * 11),
      current_date - (i * 11) + 30,
      case when i = 1 then 'a_rapprocher' else 'rapproche' end,
      'Jeu d''essai — à supprimer avec : delete from achat where numero like ''ESSAI-%'';'
    )
    returning id into v_achat;

    -- Trois lignes tirées du catalogue, à un prix qui dérive un peu du
    -- catalogue : c'est justement ce que l'onglet « Écarts de prix » doit
    -- montrer. Une dérive de zéro ne prouverait rien.
    for v_produit in
      select id, reference, designation, unite, prix_achat_ht
        from produit
       where entreprise_id = v_entreprise and coalesce(brouillon, false) = false
       order by md5(id::text || i::text) limit 3
    loop
      -- Entre −4 % et +12 % du prix catalogue, ou un prix plausible si le
      -- catalogue n'en porte pas.
      v_derive := 1 + ((random() * 16) - 4) / 100;
      v_prix := round(coalesce(v_produit.prix_achat_ht, 120) * v_derive, 2);

      -- Rapprochement quand une ligne d'approvisionnement correspond : c'est
      -- le cas nominal, celui qu'on veut pouvoir regarder.
      select a.id into v_appro
        from approvisionnement a
       where a.chantier_id = v_chantier.id
         and a.produit_id is not distinct from v_produit.id
       limit 1;

      insert into achat_ligne (entreprise_id, achat_id, chantier_id, produit_id,
                               approvisionnement_id, position, designation, reference,
                               unite, quantite, prix_unitaire_ht, taux_tva)
      values (v_entreprise, v_achat, v_chantier.id, v_produit.id, v_appro,
              0, v_produit.designation, v_produit.reference,
              coalesce(v_produit.unite, 'U'), 1 + floor(random() * 3), v_prix, 20);

      v_appro := null;
    end loop;

    -- Une ligne non rattachée : du consommable qui part au stock. C'est le
    -- cas qu'il faut savoir reconnaître, pas celui qu'il faut cacher.
    insert into achat_ligne (entreprise_id, achat_id, position, designation,
                             unite, quantite, prix_unitaire_ht, taux_tva)
    values (v_entreprise, v_achat, 9, 'Consommables d''atelier — stock',
            'lot', 1, round(40 + random() * 60), 20);

    -- Le total annoncé colle à la somme des lignes, sauf sur la première :
    -- un écart volontaire, pour voir le contrôle se déclencher.
    update achat set
      montant_ht = (select round(sum(l.quantite * l.prix_unitaire_ht), 2)
                      from achat_ligne l where l.achat_id = v_achat)
                   + case when i = 1 then 74.50 else 0 end,
      paye_le = case when i > 2 then current_date - (i * 5) end
    where id = v_achat;
  end loop;

  raise notice 'Jeu d''essai créé : % facture(s) fournisseur. La première porte un écart de 74,50 € voulu, pour voir le contrôle réagir.', i;
  raise notice 'Pour tout retirer : delete from achat where numero like ''ESSAI-%%'';';
end $$;
