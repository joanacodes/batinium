-- =============================================================================
-- BATINIUM — 15. Une seule bibliothèque de documents
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 14.
-- Rejouable : la reprise ne s'exécute qu'une fois, les blocs suivants sont
-- neutres si l'ancienne table a déjà été renommée.
--
-- Il existait deux endroits pour ranger un papier : `document_vigilance`, avec
-- ses dates d'expiration et ses alertes, réservé aux sous-traitants ; et
-- `document`, ouvert depuis le SQL 13, sans nature ni échéance.
--
-- Deux tables pour la même chose, c'est une saisie possible à deux endroits,
-- et à terme deux vérités. On garde `document`, on lui donne ce qui manquait —
-- une nature, une date d'émission, une date d'expiration — et on y verse
-- l'ancienne table.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Ce qui manquait à `document`
-- -----------------------------------------------------------------------------

alter table document
  add column if not exists emis_le   date,
  add column if not exists expire_le date,
  -- Nul pour un document sans enjeu de conformité, une photo par exemple.
  add column if not exists conforme  boolean;

comment on column document.type is
  'Nature de la pièce : contrat, attestation_urssaf, decennale, rib, permis… Le vocabulaire vit dans lib/types.ts.';
comment on column document.expire_le is
  'Échéance, quand la pièce en a une. C''est elle que surveille la cloche.';

-- L'index sert la cloche, qui balaie les échéances à chaque chargement.
create index if not exists document_expiration_idx
  on document (entreprise_id, expire_le)
  where expire_le is not null;


-- -----------------------------------------------------------------------------
-- 2. Reprise de l'ancienne table
--
-- Chaque attestation de vigilance devient un document ordinaire, de même
-- nature, avec ses dates et son fichier. Rien n'est perdu, rien n'est
-- recalculé : les identifiants changent, mais aucune autre table ne pointait
-- vers `document_vigilance`.
-- -----------------------------------------------------------------------------

do $$
declare n integer;
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'document_vigilance'
  ) then
    raise notice 'Reprise déjà faite, rien à verser.';
    return;
  end if;

  insert into document (
    entreprise_id, tiers_id, type, nom, url, chemin, type_mime,
    emis_le, expire_le, conforme
  )
  select
    v.entreprise_id, v.tiers_id, v.type,
    case v.type
      when 'attestation_urssaf'            then 'Attestation de vigilance URSSAF'
      when 'kbis'                          then 'Extrait Kbis'
      when 'decennale'                     then 'Assurance décennale'
      when 'rc_pro'                        then 'Responsabilité civile professionnelle'
      when 'attestation_capacite_fluides'  then 'Attestation de capacité fluides'
      when 'liste_salaries_etrangers'      then 'Liste des salariés étrangers'
      when 'rib'                           then 'RIB'
      else 'Document'
    end,
    v.url, v.chemin, v.type_mime, v.emis_le, v.expire_le, v.conforme
  from document_vigilance v
  -- Garde-fou de rejeu : si la ligne a déjà été versée, on ne la double pas.
  where not exists (
    select 1 from document d
     where d.tiers_id = v.tiers_id
       and d.type     = v.type
       and d.emis_le is not distinct from v.emis_le
  );

  get diagnostics n = row_count;
  raise notice 'Documents de vigilance versés dans la bibliothèque : %', n;

  -- Renommée et non supprimée : si la reprise s'est mal passée, tout est
  -- encore là. À supprimer à la main dans quelques semaines, une fois sûr.
  alter table document_vigilance rename to document_vigilance_ancien;
end $$;


-- -----------------------------------------------------------------------------
-- 3. Vérification
-- -----------------------------------------------------------------------------

do $$
declare n_avec_echeance integer;
begin
  select count(*) into n_avec_echeance from document where expire_le is not null;
  raise notice 'SQL 15 appliqué. Documents à échéance dans la bibliothèque : %.', n_avec_echeance;
end $$;
