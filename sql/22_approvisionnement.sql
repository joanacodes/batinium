-- =============================================================================
-- BATINIUM — 22. Approvisionnement de chantier
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 21.
-- Rejouable.
--
-- Ce qui manquait entre le devis signé et le chantier : la liste de ce qu'il
-- faut commander, faire livrer et poser. Elle existait dans le devis, mais
-- sous forme de lignes de vente — et il fallait la retaper à la main pour
-- suivre les commandes.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. La liste
--
-- Une ligne par fourniture du devis. Copiée et non liée : un devis signé ne
-- bouge plus, mais un chantier vit — on commande un modèle équivalent, on
-- ajoute une pièce oubliée, on corrige une quantité. Le devis reste ce qui a
-- été vendu, l'approvisionnement devient ce qui est réellement commandé.
-- L'écart entre les deux est une information, pas une erreur à masquer.
-- -----------------------------------------------------------------------------

create table if not exists approvisionnement (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprise(id) on delete cascade,
  chantier_id   uuid not null references chantier(id) on delete cascade,
  produit_id    uuid references produit(id) on delete set null,
  devis_ligne_id uuid references devis_ligne(id) on delete set null,

  designation   text not null,
  reference     text,
  unite         text not null default 'U',
  quantite      numeric(12,3) not null default 1,

  fournisseur   text,
  commande_le   date,
  livraison_prevue_le date,
  livre_le      date,
  notes         text,
  position      int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists approvisionnement_chantier_idx
  on approvisionnement (entreprise_id, chantier_id, position);

comment on table approvisionnement is
  'Ce qu''il faut commander et faire livrer sur un chantier. Copié du devis à la signature, puis vit sa vie.';
comment on column approvisionnement.livraison_prevue_le is
  'Date annoncée par le fournisseur. C''est elle qui conditionne la date de pose.';


-- -----------------------------------------------------------------------------
-- 2. Droits
--
-- Ouvert à toute l'équipe : un poseur doit savoir si sa machine est arrivée.
-- Aucun prix n'y figure — c'est une liste de matériel, pas une commande
-- valorisée. Le jour où le module achats y ajoutera des montants, il faudra
-- resserrer, et ce commentaire est là pour qu'on y pense.
-- -----------------------------------------------------------------------------

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'approvisionnement'
  loop
    execute format('drop policy %I on approvisionnement', p.policyname);
  end loop;
end $$;

alter table approvisionnement enable row level security;

create policy acces on approvisionnement for all to authenticated
  using (entreprise_id = mon_entreprise())
  with check (entreprise_id = mon_entreprise());


-- -----------------------------------------------------------------------------
-- 3. Garde-fou : aucun prix ici
-- -----------------------------------------------------------------------------

do $$
declare fuite text;
begin
  select string_agg(column_name, ', ') into fuite
  from information_schema.columns
  where table_schema = 'public' and table_name = 'approvisionnement'
    and (column_name like '%prix%' or column_name like '%montant%'
         or column_name like '%cout%' or column_name like '%marge%');
  if fuite is not null then
    raise exception 'L''approvisionnement est lu par toute l''équipe et exposerait : %.', fuite;
  end if;
  raise notice 'SQL 22 appliqué. Approvisionnement de chantier créé, sans aucun prix.';
end $$;
