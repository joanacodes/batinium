-- =============================================================================
-- BATINIUM — 24. Module achats
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 23.
-- Rejouable.
--
-- La seconde moitié de la marge réelle. Depuis le SQL 19, on sait ce qu'un
-- chantier a coûté en heures ; il manquait ce qu'il a coûté en matériel — le
-- vrai, celui de la facture du fournisseur, et non le prix d'achat inscrit au
-- catalogue il y a huit mois.
--
-- L'écart entre les deux est précisément ce qu'on cherche depuis le début :
-- un mono-split acheté 780 € au catalogue et facturé 845 € en juillet, sur
-- douze chantiers, fait 780 € de marge évaporée sans que rien ne le dise.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. La facture du fournisseur
--
-- Le document tel qu'il arrive : un fournisseur, un numéro, une date, des
-- lignes. Il ne se rattache pas à un chantier — une commande couvre souvent
-- deux ou trois chantiers, plus du stock. C'est ligne à ligne que le
-- rattachement se fait, et c'est tout l'intérêt du rapprochement.
-- -----------------------------------------------------------------------------

create table if not exists achat (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprise(id) on delete cascade,
  tiers_id       uuid references tiers(id) on delete set null,
  fournisseur    text not null,
  numero         text,
  date_facture   date not null default current_date,
  echeance_le    date,

  montant_ht     numeric(12,2),
  montant_tva    numeric(12,2),
  montant_ttc    numeric(12,2),

  statut         text not null default 'a_rapprocher'
                 check (statut in ('a_rapprocher','rapproche','paye','litige')),
  document_id    uuid references document(id) on delete set null,
  paye_le        date,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (entreprise_id, tiers_id, numero)
);

create index if not exists achat_date_idx on achat (entreprise_id, date_facture desc);
create index if not exists achat_statut_idx on achat (entreprise_id, statut);

comment on table achat is
  'Facture fournisseur telle qu''elle arrive. Le rattachement au chantier se fait ligne à ligne.';
comment on column achat.montant_ht is
  'Le total lu sur la facture. Sert de contrôle : la somme des lignes doit y correspondre.';


-- -----------------------------------------------------------------------------
-- 2. Les lignes, et le rapprochement
--
-- `approvisionnement_id` est le nœud du module : il relie ce qu'on avait prévu
-- de commander à ce qui a réellement été facturé. Nul quand la ligne n'était
-- pas prévue — et une ligne non prévue est justement l'information qu'on veut
-- voir, pas celle qu'on veut cacher.
-- -----------------------------------------------------------------------------

create table if not exists achat_ligne (
  id                    uuid primary key default gen_random_uuid(),
  entreprise_id         uuid not null references entreprise(id) on delete cascade,
  achat_id              uuid not null references achat(id) on delete cascade,
  chantier_id           uuid references chantier(id) on delete set null,
  produit_id            uuid references produit(id) on delete set null,
  approvisionnement_id  uuid references approvisionnement(id) on delete set null,

  position              int not null default 0,
  designation           text not null,
  reference             text,
  unite                 text not null default 'U',
  quantite              numeric(12,3) not null default 1,
  prix_unitaire_ht      numeric(12,2) not null default 0,
  taux_tva              numeric(4,1) not null default 20,
  notes                 text
);

create index if not exists achat_ligne_achat_idx    on achat_ligne (achat_id, position);
create index if not exists achat_ligne_chantier_idx on achat_ligne (entreprise_id, chantier_id)
  where chantier_id is not null;


-- -----------------------------------------------------------------------------
-- 3. Droits
--
-- Un achat porte des prix : réservé à ceux qui les voient, comme les devis.
-- -----------------------------------------------------------------------------

do $$
declare t text; p record;
begin
  foreach t in array array['achat','achat_ligne']
  loop
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
    execute format('alter table %I enable row level security', t);
    execute format('create policy acces on %I for all to authenticated
                    using (entreprise_id = mon_entreprise() and voit_les_prix())
                    with check (entreprise_id = mon_entreprise() and voit_les_prix())', t);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 4. Le coût réel d'un chantier
--
-- Matériel facturé et main-d'œuvre pointée, dans une seule vue. C'est ce
-- chiffre-là qui, comparé au prix de vente, donne enfin une marge constatée
-- au lieu d'une prévision.
--
-- En security definer comme les autres vues de coût, avec le même garde-fou :
-- filtre sur l'entreprise, filtre sur voit_les_prix(), et rien d'individuel.
-- -----------------------------------------------------------------------------

drop view if exists v_cout_reel_chantier cascade;

create view v_cout_reel_chantier with (security_invoker = false) as
select
  c.entreprise_id,
  c.id                                                   as chantier_id,
  coalesce(a.materiel, 0)                                as materiel,
  coalesce(a.lignes, 0)                                  as lignes_achat,
  coalesce(d.depenses, 0)                                as depenses,
  coalesce(m.cout, 0)                                    as main_oeuvre,
  coalesce(m.heures, 0)                                  as heures,
  coalesce(a.materiel, 0) + coalesce(d.depenses, 0) + coalesce(m.cout, 0) as total
from chantier c
left join lateral (
  select round(sum(l.quantite * l.prix_unitaire_ht), 2) as materiel, count(*) as lignes
    from achat_ligne l where l.chantier_id = c.id
) a on true
left join lateral (
  select round(sum(x.montant_ht), 2) as depenses
    from depense x where x.chantier_id = c.id
) d on true
left join lateral (
  select v.cout, v.heures from v_cout_main_oeuvre v where v.chantier_id = c.id
) m on true
where c.entreprise_id = mon_entreprise()
  and voit_les_prix();

grant select on v_cout_reel_chantier to authenticated;

comment on view v_cout_reel_chantier is
  'Coût constaté d''un chantier : matériel facturé, dépenses rattachées, main-d''œuvre pointée.';


-- -----------------------------------------------------------------------------
-- 5. Les écarts de prix d'achat
--
-- Ce que le catalogue annonce contre ce que le fournisseur facture. Une
-- référence qui dérive de 8 % depuis six mois ronge la marge de tous les
-- devis en cours, et rien aujourd'hui ne le signale.
-- -----------------------------------------------------------------------------

drop view if exists v_ecart_achat cascade;

create view v_ecart_achat with (security_invoker = false) as
select
  l.entreprise_id,
  p.id                                        as produit_id,
  p.reference,
  p.designation,
  p.prix_achat_ht                             as prix_catalogue,
  round(avg(l.prix_unitaire_ht), 2)           as prix_facture_moyen,
  max(a.date_facture)                         as dernier_achat,
  count(*)                                    as nombre_achats,
  case when p.prix_achat_ht > 0
       then round((avg(l.prix_unitaire_ht) - p.prix_achat_ht) / p.prix_achat_ht * 100, 1)
  end                                         as ecart_pct
from achat_ligne l
join achat a  on a.id = l.achat_id
join produit p on p.id = l.produit_id
where l.entreprise_id = mon_entreprise()
  and voit_les_prix()
group by l.entreprise_id, p.id, p.reference, p.designation, p.prix_achat_ht;

grant select on v_ecart_achat to authenticated;

comment on view v_ecart_achat is
  'Prix d''achat au catalogue contre prix réellement facturé. L''écart ronge la marge de tous les devis en cours.';


-- -----------------------------------------------------------------------------
-- 6. Vérification
-- -----------------------------------------------------------------------------

do $$
declare v text;
begin
  foreach v in array array['v_cout_reel_chantier', 'v_ecart_achat']
  loop
    if pg_get_viewdef(v::regclass) not like '%mon_entreprise()%'
       or pg_get_viewdef(v::regclass) not like '%voit_les_prix()%' then
      raise exception 'La vue % a perdu son cloisonnement.', v;
    end if;
  end loop;
  raise notice 'SQL 24 appliqué. Achats rapprochables ligne à ligne, coût réel et écarts de prix disponibles.';
end $$;
