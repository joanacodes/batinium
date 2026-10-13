-- =============================================================================
-- BATINIUM — 17. Seau catalogue fermé, attestation de capacité de l'entreprise
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 16.
-- Rejouable.
--
-- Trois choses :
--   1. le seau `catalogue` passe en privé, comme `documents` ;
--   2. `document` accepte des pièces qui n'appartiennent qu'à l'entreprise ;
--   3. l'attestation de capacité fluides de l'entreprise gagne une échéance.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Le seau catalogue devient privé
--
-- À quoi ça sert, puisque ces photos partent de toute façon chez le client sur
-- son devis : un seau public expose une adresse permanente et devinable. Le
-- chemin d'une photo était `<entreprise>/<produit>.jpg` — qui connaît les deux
-- identifiants lit la photo, et rien n'empêche de remonter le catalogue entier
-- en essayant. Ce sont vos prix d'achat en images, vos fournisseurs, votre
-- gamme : ce qu'un concurrent paierait pour voir.
--
-- Une fois fermé, chaque affichage réclame un lien signé qui expire au bout
-- d'une heure. Le devis à l'écran et à l'impression continue de les afficher,
-- l'application demandant les liens avant de dessiner la page.
--
-- Conséquence à connaître pour la suite : le jour où le PDF partira en pièce
-- jointe d'un e-mail, ses images devront être incorporées au fichier et non
-- liées — un lien signé serait mort avant que le client ouvre le message.
-- C'est de toute façon la bonne façon de fabriquer un PDF.
-- -----------------------------------------------------------------------------

update storage.buckets set public = false where id = 'catalogue';

do $$
declare p text;
begin
  foreach p in array array['catalogue lecture','catalogue depot',
                           'catalogue remplacement','catalogue retrait']
  loop
    execute format('drop policy if exists %I on storage.objects', p);
  end loop;
end $$;

create policy "catalogue lecture" on storage.objects for select to authenticated
  using (bucket_id = 'catalogue'
         and (storage.foldername(name))[1] = mon_entreprise()::text);

create policy "catalogue depot" on storage.objects for insert to authenticated
  with check (bucket_id = 'catalogue'
              and (storage.foldername(name))[1] = mon_entreprise()::text);

create policy "catalogue remplacement" on storage.objects for update to authenticated
  using (bucket_id = 'catalogue'
         and (storage.foldername(name))[1] = mon_entreprise()::text);

create policy "catalogue retrait" on storage.objects for delete to authenticated
  using (bucket_id = 'catalogue'
         and (storage.foldername(name))[1] = mon_entreprise()::text);


-- -----------------------------------------------------------------------------
-- 2. Le chemin de la photo, et non plus seulement son adresse
--
-- Une URL publique ne permet pas de fabriquer un lien signé : il faut le
-- chemin dans le seau. On l'extrait des adresses existantes plutôt que de
-- redemander les photos, en retirant le paramètre anti-cache.
-- -----------------------------------------------------------------------------

alter table produit
  add column if not exists photo_chemin text;

comment on column produit.photo_chemin is
  'Chemin dans le seau `catalogue`. C''est lui qui fait foi ; photo_url n''est plus lisible depuis le SQL 17.';

update produit
   set photo_chemin = split_part(substring(photo_url from '/catalogue/(.*)$'), '?', 1)
 where photo_url is not null
   and photo_chemin is null;


-- -----------------------------------------------------------------------------
-- 3. Des documents qui n'appartiennent qu'à l'entreprise
--
-- L'attestation de capacité de Pilotech ne se rattache ni à un chantier, ni à
-- un salarié, ni à un sous-traitant : elle est à l'entreprise. La contrainte
-- posée au SQL 13 exigeait un rattachement, à juste titre — une pièce que rien
-- ne relie à rien est une pièce que personne ne retrouve. On ouvre donc une
-- porte nommée, pas une porte dérobée.
-- -----------------------------------------------------------------------------

alter table document
  add column if not exists portee_entreprise boolean not null default false;

comment on column document.portee_entreprise is
  'Vrai pour une pièce de l''entreprise elle-même : attestation de capacité, Kbis, RC pro.';

alter table document drop constraint if exists document_rattachement_check;
alter table document add constraint document_rattachement_check
  check (
    portee_entreprise
    or num_nonnulls(chantier_id, intervention_id, membre_id, tiers_id, devis_id, fil_id) >= 1
  );

create index if not exists document_entreprise_idx
  on document (entreprise_id) where portee_entreprise;


-- -----------------------------------------------------------------------------
-- 4. L'échéance de l'attestation de capacité
--
-- Cinq ans, avec un audit annuel de surveillance. Sans elle, l'entreprise ne
-- peut plus acheter de fluide frigorigène : c'est l'arrêt de l'activité, pas
-- une formalité. Elle n'était qu'une ligne de texte dans les mentions, sans
-- date et sans pièce, donc invisible de la cloche.
-- -----------------------------------------------------------------------------

alter table parametres
  add column if not exists attestation_capacite_expire_le date,
  add column if not exists attestation_capacite_organisme text;

comment on column parametres.attestation_capacite_expire_le is
  'Échéance de l''attestation de capacité fluides. Surveillée par la cloche, 90 jours avant.';


-- -----------------------------------------------------------------------------
-- 5. Vérification
-- -----------------------------------------------------------------------------

do $$
declare
  n_pol   integer;
  n_photo integer;
  ouvert  boolean;
begin
  select count(*) into n_pol from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'catalogue %';
  if n_pol <> 4 then
    raise exception 'Politiques du seau catalogue incomplètes : % sur 4.', n_pol;
  end if;

  select public into ouvert from storage.buckets where id = 'catalogue';
  if ouvert then
    raise exception 'Le seau catalogue est resté public.';
  end if;

  select count(*) into n_photo from produit where photo_url is not null and photo_chemin is null;
  if n_photo > 0 then
    raise notice 'Attention : % photo(s) sans chemin retrouvé, elles ne s''afficheront plus.', n_photo;
  end if;

  raise notice 'SQL 17 appliqué. Seau catalogue privé, 4 politiques.';
end $$;
