-- =============================================================================
-- BATINIUM — 13. Paie de l'équipe et pièces jointes
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 12.
-- Rejouable : chaque bloc vérifie l'état avant d'agir.
--
-- Trois choses :
--   1. un vrai stockage de fichiers, privé, cloisonné par entreprise ;
--   2. la table `document` complétée pour porter une pièce jointe et son
--      bénéficiaire, avec des droits qui distinguent une photo de chantier
--      d'un RIB de sous-traitant ;
--   3. les règles d'accès à `paiement_equipe`, jusqu'ici sans interface.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Qui suis-je, en tant que membre
--
-- mon_entreprise() et mon_role() existent depuis 01. Il manquait l'identifiant
-- de la ligne membre elle-même, pour qu'un salarié puisse lire sa propre paie
-- sans lire celle des autres.
-- -----------------------------------------------------------------------------

create or replace function mon_membre()
returns uuid language sql stable security definer set search_path = public as $$
  select id from membre where user_id = auth.uid() and actif limit 1
$$;


-- -----------------------------------------------------------------------------
-- 2. Le seau de fichiers
--
-- Privé, contrairement au seau `catalogue` : une photo de catalogue part sur le
-- devis d'un client, une attestation URSSAF ou une photo prise chez un
-- particulier n'ont rien à faire sur une URL publique devinable. La lecture
-- passera donc par des URL signées, valables quelques minutes.
--
-- Le cloisonnement tient au chemin : `<entreprise_id>/<dossier>/<fichier>`.
-- Les politiques comparent le premier segment à mon_entreprise(), ce qui
-- interdit à une entreprise de lire le seau d'une autre même en devinant le
-- chemin exact.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit;

do $$
declare p text;
begin
  foreach p in array array['documents lecture','documents depot',
                           'documents remplacement','documents retrait']
  loop
    execute format('drop policy if exists %I on storage.objects', p);
  end loop;
end $$;

create policy "documents lecture" on storage.objects for select to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[1] = mon_entreprise()::text);

create policy "documents depot" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
              and (storage.foldername(name))[1] = mon_entreprise()::text);

create policy "documents remplacement" on storage.objects for update to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[1] = mon_entreprise()::text);

create policy "documents retrait" on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[1] = mon_entreprise()::text);


-- -----------------------------------------------------------------------------
-- 3. La table document, complétée
--
-- Elle existait depuis 01 avec ses rattachements et ses coordonnées GPS, mais
-- sans rien pour désigner le fichier réel ni le salarié concerné.
-- -----------------------------------------------------------------------------

alter table document
  add column if not exists membre_id     uuid references membre(id) on delete cascade,
  add column if not exists chemin        text,
  add column if not exists type_mime     text,
  add column if not exists taille_octets bigint,
  add column if not exists legende       text,
  add column if not exists depose_par    uuid references membre(id) on delete set null;

comment on column document.chemin is
  'Chemin dans le seau `documents`. C''est lui qui fait foi ; `url` ne sert qu''aux liens externes.';
comment on column document.legende is
  'Ce que la photo montre. Sans légende, une photo de chantier redevient illisible en trois mois.';

create index if not exists document_chantier_idx on document (entreprise_id, chantier_id)
  where chantier_id is not null;
create index if not exists document_membre_idx   on document (entreprise_id, membre_id)
  where membre_id is not null;
create index if not exists document_tiers_idx    on document (entreprise_id, tiers_id)
  where tiers_id is not null;

-- Une pièce doit être rattachée à quelque chose, sinon personne ne la retrouve.
do $$
declare n integer;
begin
  select count(*) into n from document
   where chantier_id is null and intervention_id is null and membre_id is null
     and tiers_id is null and devis_id is null;
  if n > 0 then
    raise notice 'Attention : % document(s) sans rattachement, contrainte non posée.', n;
  else
    alter table document drop constraint if exists document_rattachement_check;
    alter table document add constraint document_rattachement_check
      check (num_nonnulls(chantier_id, intervention_id, membre_id, tiers_id, devis_id) >= 1);
  end if;
end $$;

-- Les documents de vigilance porteront eux aussi un vrai fichier : jusqu'ici on
-- suivait des dates d'expiration sans pouvoir produire la pièce en cas de
-- contrôle, ce qui est exactement ce que le contrôle demande.
alter table document_vigilance
  add column if not exists chemin    text,
  add column if not exists type_mime text;


-- -----------------------------------------------------------------------------
-- 4. Droits sur les documents
--
-- La politique de 01 ouvrait `document` à tous les membres, ce qui convenait
-- tant que la table était vide. Elle va maintenant porter des bulletins, des
-- RIB et des attestations : une photo de chantier reste visible de toute
-- l'équipe, le reste monte au niveau de ceux qui voient déjà les prix.
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

alter table document enable row level security;

create policy acces on document for all to authenticated
  using (
    entreprise_id = mon_entreprise()
    and (chantier_id is not null or intervention_id is not null or voit_les_prix())
  )
  with check (
    entreprise_id = mon_entreprise()
    and (chantier_id is not null or intervention_id is not null or voit_les_prix())
  );


-- -----------------------------------------------------------------------------
-- 5. Paiements de l'équipe
--
-- Un paiement va à un salarié ou à un sous-traitant, jamais aux deux : sans
-- cette contrainte, une ligne à double bénéficiaire serait comptée deux fois
-- dans Rentabilité, exactement le doublon que 12 venait de supprimer.
-- -----------------------------------------------------------------------------

do $$
declare n integer;
begin
  select count(*) into n from paiement_equipe
   where num_nonnulls(membre_id, tiers_id) <> 1;
  if n > 0 then
    raise exception '% paiement(s) sans bénéficiaire unique : à corriger avant de rejouer.', n;
  end if;
end $$;

alter table paiement_equipe drop constraint if exists paiement_un_beneficiaire;
alter table paiement_equipe add constraint paiement_un_beneficiaire
  check (num_nonnulls(membre_id, tiers_id) = 1);

create index if not exists paiement_equipe_du_idx
  on paiement_equipe (entreprise_id, du_le);
create index if not exists paiement_equipe_membre_idx
  on paiement_equipe (entreprise_id, membre_id) where membre_id is not null;
create index if not exists paiement_equipe_tiers_idx
  on paiement_equipe (entreprise_id, tiers_id) where tiers_id is not null;

-- Lecture pour ceux qui voient les prix, plus chacun sur sa propre paie.
-- Écriture réservée à la direction.
--
-- La lecture s'arrête volontairement à voit_les_prix() et non à la seule
-- direction : Rentabilité lit cette table pour sa ligne de sous-traitance, et
-- un chef de chantier qui n'y aurait pas droit verrait un zéro silencieux à la
-- place du vrai montant. Si vous voulez masquer les salaires à un chef de
-- chantier, c'est ici que ça se change — mais il faudra alors que Rentabilité
-- dise qu'elle ne sait pas, au lieu d'afficher zéro.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'paiement_equipe'
  loop
    execute format('drop policy %I on paiement_equipe', p.policyname);
  end loop;
end $$;

alter table paiement_equipe enable row level security;

create policy lecture on paiement_equipe for select to authenticated
  using (entreprise_id = mon_entreprise()
         and (voit_les_prix() or membre_id = mon_membre()));

create policy administration on paiement_equipe for all to authenticated
  using (entreprise_id = mon_entreprise() and mon_role() = 'direction')
  with check (entreprise_id = mon_entreprise() and mon_role() = 'direction');


-- -----------------------------------------------------------------------------
-- 6. Vérification
-- -----------------------------------------------------------------------------

do $$
declare n_pol integer;
begin
  select count(*) into n_pol from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'documents %';
  if n_pol <> 4 then
    raise exception 'Politiques de stockage incomplètes : % sur 4.', n_pol;
  end if;
  raise notice 'SQL 13 appliqué. Seau `documents` privé, 4 politiques, paie cloisonnée.';
end $$;
