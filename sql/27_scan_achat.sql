-- =============================================================================
-- BATINIUM — 27. La pièce jointe d'une facture fournisseur
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 26.
-- Rejouable.
--
-- Une facture fournisseur saisie sans son scan oblige à retourner au classeur
-- dès qu'un montant est contesté. Et en cas de contrôle, c'est la pièce qu'on
-- demande, pas la ligne de la base.
-- =============================================================================

alter table document
  add column if not exists achat_id uuid references achat(id) on delete cascade;

create index if not exists document_achat_idx on document (entreprise_id, achat_id)
  where achat_id is not null;

comment on column document.achat_id is
  'Le scan ou la photo de la facture fournisseur. Supprimée avec elle.';

-- La contrainte de rattachement doit accepter ce nouveau lien.
alter table document drop constraint if exists document_rattachement_check;
alter table document add constraint document_rattachement_check
  check (
    portee_entreprise
    or num_nonnulls(chantier_id, intervention_id, membre_id, tiers_id, devis_id,
                    fil_id, achat_id) >= 1
  );

-- -----------------------------------------------------------------------------
-- Droits : une facture fournisseur porte des prix, son scan aussi.
--
-- La politique posée au SQL 13 ouvrait `document` à toute l'équipe pour les
-- pièces de chantier. Le scan d'une facture d'achat n'en fait pas partie : il
-- rejoint ce qui est réservé à ceux qui voient les prix.
-- -----------------------------------------------------------------------------

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'document'
  loop
    execute format('drop policy %I on document', p.policyname);
  end loop;
end $$;

create policy acces on document for all to authenticated
  using (
    entreprise_id = mon_entreprise()
    and (((chantier_id is not null or intervention_id is not null) and achat_id is null)
         or voit_les_prix())
  )
  with check (
    entreprise_id = mon_entreprise()
    and (((chantier_id is not null or intervention_id is not null) and achat_id is null)
         or voit_les_prix())
  );

do $$
begin
  raise notice 'SQL 27 appliqué. Scan de facture fournisseur possible, réservé à ceux qui voient les prix.';
end $$;
