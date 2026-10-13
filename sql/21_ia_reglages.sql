-- =============================================================================
-- BATINIUM — 21. Journal des appels à l'IA, réglages de facturation
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 20.
-- Rejouable.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Ce qui était écrit en dur dans les factures
--
-- Le pourcentage d'acompte, le délai de règlement et les mentions de retard
-- ne sont pas des constantes du métier : ils dépendent de l'entreprise, de sa
-- clientèle et de ses conditions générales. Ils vivaient dans le code, où
-- personne d'autre qu'un développeur ne pouvait les changer.
-- -----------------------------------------------------------------------------

alter table parametres
  add column if not exists acompte_defaut_pct   numeric(5,2) not null default 30,
  add column if not exists delai_paiement_jours integer      not null default 30,
  add column if not exists mentions_reglement   text,
  add column if not exists penalites_retard     text;

-- Les valeurs supplétives du code de commerce, pour que le document soit
-- conforme même si personne ne touche à ces champs.
update parametres
   set penalites_retard = coalesce(penalites_retard,
       'En cas de retard de paiement, des pénalités égales à trois fois le taux d''intérêt '
    || 'légal seront exigibles le jour suivant la date de règlement figurant sur la facture, '
    || 'sans qu''un rappel soit nécessaire. Une indemnité forfaitaire de 40 € pour frais de '
    || 'recouvrement sera due, conformément aux articles L. 441-10 et D. 441-5 du code de '
    || 'commerce. Aucun escompte n''est accordé pour paiement anticipé.');

comment on column parametres.delai_paiement_jours is
  'Délai de règlement en jours. 30 est le délai supplétif du code de commerce, 60 le maximum entre professionnels.';


-- -----------------------------------------------------------------------------
-- 2. Le journal des appels à l'IA
--
-- Trois raisons de le tenir, et aucune n'est décorative.
--
-- Le coût : un appel à un modèle se facture au jeton. Sans compteur, on
-- découvre le montant sur la facture du mois.
--
-- La confiance : quand une proposition de l'IA se révèle fausse, on doit
-- pouvoir remonter à ce qui lui a été demandé. Une boîte noire qui écrit dans
-- une base de gestion n'est pas acceptable.
--
-- Le RGPD : un devis dicté, une transcription d'appel contiennent des données
-- personnelles. Savoir ce qui est sorti, quand et pour qui, est la première
-- chose qu'on demandera le jour d'une réclamation. D'où aussi la purge : on
-- garde la trace de l'appel, pas son contenu, au-delà de quelques semaines.
-- -----------------------------------------------------------------------------

create table if not exists journal_ia (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprise(id) on delete cascade,
  membre_id      uuid references membre(id) on delete set null,
  tache          text not null,
  modele         text,
  -- Effacés par la purge, la ligne reste pour le comptage.
  entree_extrait text,
  sortie_extrait text,
  jetons_entree  integer,
  jetons_sortie  integer,
  duree_ms       integer,
  erreur         text,
  created_at     timestamptz not null default now()
);

create index if not exists journal_ia_date_idx on journal_ia (entreprise_id, created_at desc);

comment on table journal_ia is
  'Trace des appels au modèle : coût, explicabilité, RGPD. Le contenu se purge, la ligne reste.';

/**
 * Efface le contenu des appels de plus de N jours, sans supprimer les lignes.
 * À appeler à la main ou par une tâche planifiée.
 */
create or replace function purger_journal_ia(p_jours integer default 30)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update journal_ia
     set entree_extrait = null, sortie_extrait = null
   where entreprise_id = mon_entreprise()
     and created_at < now() - make_interval(days => p_jours)
     and (entree_extrait is not null or sortie_extrait is not null);
  get diagnostics n = row_count;
  return n;
end $$;


-- -----------------------------------------------------------------------------
-- 3. Droits
--
-- Écriture réservée au serveur : la fonction Edge écrit avec la clé de
-- service et contourne la RLS. Aucune politique d'insertion n'est donc
-- ouverte au navigateur — sans quoi n'importe qui pourrait fabriquer de
-- fausses traces, et un journal falsifiable ne vaut rien.
-- -----------------------------------------------------------------------------

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'journal_ia'
  loop
    execute format('drop policy %I on journal_ia', p.policyname);
  end loop;
end $$;

alter table journal_ia enable row level security;

create policy lecture on journal_ia for select to authenticated
  using (entreprise_id = mon_entreprise() and voit_les_prix());


-- -----------------------------------------------------------------------------
-- 4. Vérification
-- -----------------------------------------------------------------------------

do $$
declare n integer;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'journal_ia' and cmd <> 'SELECT';
  if n > 0 then
    raise exception 'Le journal IA doit être en lecture seule côté navigateur.';
  end if;
  raise notice 'SQL 21 appliqué. Journal IA en lecture seule, réglages de facturation sortis du code.';
end $$;
