-- =============================================================================
-- BATINIUM — 33. La fiche d'intervention fluides (Cerfa 15497*04)
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 32.
-- Rejouable.
--
-- Toute opération sur le fluide d'un équipement — assemblage, mise en
-- service, maintenance, contrôle, démantèlement — donne lieu à une fiche
-- conforme au Cerfa 15497*04 (art. R.543-82 du Code de l'environnement, arrêté
-- du 29 février 2016). Une fiche par équipement, en deux exemplaires, signée
-- par l'opérateur et par le détenteur, conservée cinq ans par chacun.
--
-- Trois choses font de cette table autre chose qu'un formulaire :
--   - le numéro ne s'attribue qu'à la signature du technicien ;
--   - la signature exige sept autocontrôles, vérifiés ici, pas seulement à
--     l'écran ;
--   - une fiche signée ne bouge plus. On la corrige par une fiche
--     rectificative, et les deux restent.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. La catégorie de l'attestation de capacité
--
-- La fiche de Pilotech l'imprime (« Catégorie I ») et elle conditionne ce que
-- l'entreprise a le droit de faire. Elle manquait aux paramètres.
-- -----------------------------------------------------------------------------

alter table parametres
  add column if not exists attestation_capacite_categorie text;

comment on column parametres.attestation_capacite_categorie is
  'Catégorie de l''attestation de capacité (I à V). Reprise dans la rubrique 1 de chaque fiche fluides.';


-- -----------------------------------------------------------------------------
-- 1. La fiche
--
-- Les rubriques 1, 2 et 3 du Cerfa sont des copies, figées à la signature, de
-- ce que la base sait de l'opérateur, du détenteur et de la machine. Une fiche
-- de 2026 doit encore dire l'attestation de 2026 quand on la relit en 2030,
-- même si l'entreprise a changé d'organisme entre-temps — d'où des copies et
-- non des liens.
-- -----------------------------------------------------------------------------

create table if not exists fiche_fluide (
  id              uuid primary key default gen_random_uuid(),
  entreprise_id   uuid not null references entreprise(id) on delete cascade,
  numero          text,
  statut          text not null default 'brouillon'
                  check (statut in ('brouillon','signee_operateur','signee','rectifiee')),
  rectifie_id     uuid references fiche_fluide(id),

  equipement_id   uuid not null references equipement(id) on delete restrict,
  intervention_id uuid references intervention(id) on delete set null,
  chantier_id     uuid references chantier(id) on delete set null,
  tiers_id        uuid references tiers(id) on delete set null,
  site_id         uuid references site(id) on delete set null,
  technicien_id   uuid references membre(id) on delete set null,

  -- Rubriques 1, 2, 3 : copies figées à la signature.
  operateur       jsonb not null default '{}'::jsonb,
  detenteur       jsonb not null default '{}'::jsonb,
  equipement      jsonb not null default '{}'::jsonb,

  -- Rubrique 4 : plusieurs cases possibles.
  nature          text[] not null default '{}'
                  check (nature <@ array['assemblage','mise_en_service','modification',
                                         'maintenance','controle_periodique',
                                         'controle_non_periodique','demantelement','autre']),
  nature_autre    text,

  -- Rubrique 5 : contrôle d'étanchéité.
  detecteur_identification text,
  detecteur_controle_le    date,
  detection_permanente     boolean,
  frequence_applicable     text,
  fuites_constatees        boolean,
  fuites                   jsonb not null default '[]'::jsonb,

  -- Rubrique 6 : manipulation du fluide, en kilogrammes.
  charge_vierge       numeric(8,3) not null default 0 check (charge_vierge >= 0),        -- B
  charge_recyclee     numeric(8,3) not null default 0 check (charge_recyclee >= 0),      -- C
  charge_regeneree    numeric(8,3) not null default 0 check (charge_regeneree >= 0),     -- D
  recup_traitement    numeric(8,3) not null default 0 check (recup_traitement >= 0),     -- F
  recup_reutilisation numeric(8,3) not null default 0 check (recup_reutilisation >= 0),  -- G
  contenants          text,
  denomination_adr    text,
  destination         text,
  bsff                text,

  -- Rubrique 7.
  observations    text,

  -- Rubrique 8 : les images de signature sont des documents de type
  -- « signature », rattachés à la fiche, leur légende disant qui a signé.
  signature_operateur_le  timestamptz,
  signature_operateur_nom text,
  signature_detenteur_le  timestamptz,
  signature_detenteur_nom text,

  date_intervention date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entreprise_id, numero)
);

-- A = B + C + D et E = F + G : calculés, ils ne peuvent pas contredire leurs
-- parties. Une fiche où le total chargé n'égale pas la somme de ses origines
-- serait refusée par n'importe quel contrôleur.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'fiche_fluide' and column_name = 'charge_totale') then
    alter table fiche_fluide add column charge_totale numeric(8,3)
      generated always as (charge_vierge + charge_recyclee + charge_regeneree) stored;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'fiche_fluide' and column_name = 'recup_totale') then
    alter table fiche_fluide add column recup_totale numeric(8,3)
      generated always as (recup_traitement + recup_reutilisation) stored;
  end if;
end $$;

create index if not exists fiche_fluide_equipement_idx on fiche_fluide (entreprise_id, equipement_id);
create index if not exists fiche_fluide_chantier_idx   on fiche_fluide (entreprise_id, chantier_id);
create index if not exists fiche_fluide_date_idx       on fiche_fluide (entreprise_id, date_intervention);

comment on table fiche_fluide is
  'Cerfa 15497*04. Une fiche par machine et par intervention sur le fluide. Immuable une fois signée.';
comment on column fiche_fluide.rectifie_id is
  'La fiche que celle-ci corrige. L''originale passe en « rectifiée » et garde son numéro.';
comment on column fiche_fluide.fuites is
  'Tableau [{localisation, reparation_faite, reparation_a_faire}] — rubrique 5, une ligne par fuite.';


-- -----------------------------------------------------------------------------
-- 2. Pièces jointes : la signature et, plus tard, le PDF
-- -----------------------------------------------------------------------------

alter table document
  add column if not exists fiche_fluide_id uuid references fiche_fluide(id) on delete cascade;

create index if not exists document_fiche_fluide_idx on document (entreprise_id, fiche_fluide_id)
  where fiche_fluide_id is not null;

alter table document drop constraint if exists document_rattachement_check;
alter table document add constraint document_rattachement_check
  check (
    portee_entreprise
    or num_nonnulls(chantier_id, intervention_id, membre_id, tiers_id, devis_id,
                    fil_id, achat_id, equipement_id, fiche_fluide_id) >= 1
  );

-- Une signature est une pièce de terrain : le technicien qui vient de signer
-- doit pouvoir la revoir. Même règle que le script 32, élargie à la fiche.
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
    and (((chantier_id is not null or intervention_id is not null
           or equipement_id is not null or fiche_fluide_id is not null)
          and achat_id is null)
         or voit_les_prix())
  )
  with check (
    entreprise_id = mon_entreprise()
    and (((chantier_id is not null or intervention_id is not null
           or equipement_id is not null or fiche_fluide_id is not null)
          and achat_id is null)
         or voit_les_prix())
  );


-- -----------------------------------------------------------------------------
-- 3. Droits sur les fiches
--
-- Lecture et écriture ouvertes à toute l'équipe : c'est le technicien qui
-- remplit la fiche, sur place, et il doit pouvoir relire celle qu'il a
-- signée. Aucun prix n'y figure. Ce qui doit être protégé — le numéro, l'état,
-- le contenu une fois signé — l'est par le déclencheur, pas par ces règles.
-- -----------------------------------------------------------------------------

alter table fiche_fluide enable row level security;
drop policy if exists acces on fiche_fluide;
create policy acces on fiche_fluide for all to authenticated
  using (entreprise_id = mon_entreprise())
  with check (entreprise_id = mon_entreprise());


-- -----------------------------------------------------------------------------
-- 4. La numérotation
--
-- `prochain_numero` compte déjà par année — le compteur porte l'année dans sa
-- clé —, mais rendait un seul format, `PFX-AAAA/MM-NNNN`. Une fiche fluides se
-- numérote `FF-2026-0001` : on ajoute un format par type, sans toucher à ceux
-- des devis, factures et chantiers. Changer leur format en cours d'année
-- casserait la continuité visible de la série.
-- -----------------------------------------------------------------------------

create or replace function prochain_numero(p_type text)
returns text language plpgsql security definer set search_path = public as $$
declare
  e uuid := mon_entreprise();
  a int  := extract(year from current_date);
  n int;
  prefixe text := case p_type
                    when 'devis' then 'DEV'
                    when 'facture' then 'FAC'
                    when 'chantier' then 'CHA'
                    when 'fiche' then 'FF'
                    else upper(left(p_type, 3)) end;
begin
  if e is null then
    raise exception 'Aucune entreprise rattachée à cet utilisateur.';
  end if;
  insert into compteur (entreprise_id, type, annee) values (e, p_type, a)
    on conflict (entreprise_id, type, annee) do nothing;
  update compteur set dernier = dernier + 1
    where entreprise_id = e and type = p_type and annee = a
    returning dernier into n;

  if p_type = 'fiche' then
    return prefixe || '-' || a || '-' || lpad(n::text, 4, '0');
  end if;
  return prefixe || '-' || a || '/' || lpad(extract(month from current_date)::text, 2, '0')
         || '-' || lpad(n::text, 4, '0');
end $$;


-- -----------------------------------------------------------------------------
-- 5. Les copies figées : opérateur, détenteur, équipement
--
-- Tant que la fiche est en brouillon, elles suivent la base : une machine
-- vérifiée après la création de la fiche doit y apparaître. À la signature du
-- technicien, elles sont recalculées une dernière fois, puis ne bougent plus.
-- -----------------------------------------------------------------------------

create or replace function instantane_fiche_fluide(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  f  fiche_fluide;
  m  equipement;
  pa parametres;
  t  membre;
  ti tiers;
  si site;
  ff fluide_frigorigene;
begin
  select * into f from fiche_fluide where id = p_id and entreprise_id = mon_entreprise();
  if not found then raise exception 'Fiche introuvable.'; end if;
  if f.statut <> 'brouillon' then return; end if;

  select * into m  from equipement where id = f.equipement_id;
  select * into pa from parametres where entreprise_id = f.entreprise_id;
  select * into t  from membre     where id = f.technicien_id;
  select * into ff from fluide_frigorigene where code = m.fluide;

  -- Le client et le site se retrouvent par la machine, à défaut par la fiche.
  select * into si from site  where id = coalesce(m.site_id, f.site_id);
  select * into ti from tiers where id = coalesce(f.tiers_id, si.tiers_id,
                                                  (select c.tiers_id from chantier c
                                                    where c.id = coalesce(m.chantier_id, f.chantier_id)));

  perform set_config('batinium.fiche_fluide', 'oui', true);
  update fiche_fluide set
    chantier_id = coalesce(m.chantier_id, f.chantier_id),
    site_id     = coalesce(si.id, f.site_id),
    tiers_id    = coalesce(ti.id, f.tiers_id),
    operateur = jsonb_build_object(
      'raison_sociale', pa.raison_sociale,
      'adresse',        concat_ws(', ', pa.adresse, nullif(concat_ws(' ', pa.code_postal, pa.ville), '')),
      'siret',          pa.siret,
      'telephone',      pa.telephone,
      'portable',       pa.portable,
      'attestation_capacite',           pa.attestation_capacite,
      'attestation_capacite_organisme', pa.attestation_capacite_organisme,
      'attestation_capacite_categorie', pa.attestation_capacite_categorie,
      'attestation_capacite_expire_le', pa.attestation_capacite_expire_le,
      'technicien', jsonb_build_object(
        'nom', t.nom,
        'aptitude_fluides_num', t.aptitude_fluides_num,
        'aptitude_fluides_expire_le', t.aptitude_fluides_expire_le)),
    detenteur = jsonb_build_object(
      'nom',       ti.nom,
      'siret',     ti.siret,
      'telephone', ti.telephone,
      'adresse',   concat_ws(', ', si.adresse, nullif(concat_ws(' ', si.code_postal, si.ville), ''))),
    equipement = jsonb_build_object(
      'marque',        m.marque,
      'modele',        m.modele,
      'numero_serie',  m.numero_serie,
      'piece',         coalesce(m.piece, m.emplacement),
      'fluide',        m.fluide,
      'prp',           coalesce(m.prp, ff.prp),
      'charge_kg',     m.charge_kg,
      'tonnage_co2',   tonnage_co2(m.charge_kg, coalesce(m.prp, ff.prp)),
      'hermetique',    m.hermetique,
      'puissance_kw',  m.puissance_kw),
    detection_permanente = coalesce(f.detection_permanente, m.detection_permanente),
    frequence_applicable = frequence_controle(tonnage_co2(m.charge_kg, coalesce(m.prp, ff.prp)),
                                              m.hermetique,
                                              coalesce(f.detection_permanente, m.detection_permanente)),
    denomination_adr = coalesce(f.denomination_adr, ff.denomination_adr)
  where id = p_id;
end $$;


-- -----------------------------------------------------------------------------
-- 6. Les autocontrôles
--
-- La même liste que l'écran, vérifiée ici pour que l'écran ne soit pas la
-- seule barrière : une fiche sans attestation valide ne doit pas pouvoir être
-- signée, même par un appel direct à la base.
--
-- Rend la liste de ce qui manque, vide quand tout est en ordre.
-- -----------------------------------------------------------------------------

create or replace function manques_fiche_fluide(p_id uuid, p_pour text default 'operateur')
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  f  fiche_fluide;
  m  equipement;
  t  membre;
  pa parametres;
  manques text[] := '{}';
begin
  select * into f from fiche_fluide where id = p_id and entreprise_id = mon_entreprise();
  if not found then raise exception 'Fiche introuvable.'; end if;

  if p_pour = 'detenteur' then
    if not exists (select 1 from document where fiche_fluide_id = p_id
                    and type = 'signature' and legende = 'detenteur') then
      manques := manques || 'Signature du client';
    end if;
    return manques;
  end if;

  select * into m  from equipement where id = f.equipement_id;
  select * into t  from membre     where id = f.technicien_id;
  select * into pa from parametres where entreprise_id = f.entreprise_id;

  -- 1. La plaque fait foi : sans sa photo et son numéro, la machine n'est
  --    pas identifiée, et la fiche ne dit rien de vérifiable.
  if coalesce(trim(m.numero_serie), '') = ''
     or not exists (select 1 from document where equipement_id = m.id
                     and type = 'plaque_signaletique') then
    manques := manques || 'Machine non vérifiée : photo de la plaque et numéro de série requis';
  end if;

  -- 2. et 3. Une attestation périmée interdit l'intervention elle-même.
  if t.id is null or coalesce(trim(t.aptitude_fluides_num), '') = ''
     or (t.aptitude_fluides_expire_le is not null and t.aptitude_fluides_expire_le < f.date_intervention) then
    manques := manques || 'Technicien sans attestation d''aptitude valide';
  end if;
  if coalesce(trim(pa.attestation_capacite), '') = ''
     or (pa.attestation_capacite_expire_le is not null
         and pa.attestation_capacite_expire_le < f.date_intervention) then
    manques := manques || 'Entreprise sans attestation de capacité valide';
  end if;

  -- 4.
  if cardinality(f.nature) = 0 then
    manques := manques || 'Nature de l''intervention à cocher';
  end if;

  -- 5. Un fluide chargé vient d'un contenant identifié ; un fluide récupéré
  --    part quelque part, avec un bordereau.
  if f.charge_totale > 0 and coalesce(trim(f.contenants), '') = '' then
    manques := manques || 'Contenant du fluide chargé à identifier';
  end if;
  if f.recup_totale > 0
     and (coalesce(trim(f.destination), '') = '' or coalesce(trim(f.bsff), '') = '') then
    manques := manques || 'Destination et n° de BSFF du fluide récupéré à renseigner';
  end if;

  -- 6.
  if (f.nature && array['controle_periodique','controle_non_periodique'])
     or coalesce(f.frequence_applicable, 'non_soumis') <> 'non_soumis' then
    if coalesce(trim(f.detecteur_identification), '') = ''
       or f.detecteur_controle_le is null or f.fuites_constatees is null then
      manques := manques || 'Contrôle d''étanchéité incomplet : détecteur, date de son contrôle, fuites constatées';
    end if;
  end if;

  -- 7.
  if not exists (select 1 from document where fiche_fluide_id = p_id
                  and type = 'signature' and legende = 'operateur') then
    manques := manques || 'Signature du technicien';
  end if;

  return manques;
end $$;


-- -----------------------------------------------------------------------------
-- 7. Signer
--
-- `p_nom` est le nom déclaré du signataire. Pour le technicien, son nom de
-- membre s'impose s'il n'est pas fourni ; pour le client, il est obligatoire.
-- -----------------------------------------------------------------------------

create or replace function signer_fiche_fluide(p_id uuid, p_qui text, p_nom text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  f       fiche_fluide;
  manques text[];
  v_num   text;
begin
  select * into f from fiche_fluide
   where id = p_id and entreprise_id = mon_entreprise() for update;
  if not found then raise exception 'Fiche introuvable.'; end if;

  perform set_config('batinium.fiche_fluide', 'oui', true);

  if p_qui = 'operateur' then
    if f.statut <> 'brouillon' then
      raise exception 'Cette fiche est déjà signée par le technicien.';
    end if;
    perform instantane_fiche_fluide(p_id);
    manques := manques_fiche_fluide(p_id, 'operateur');
    if cardinality(manques) > 0 then
      raise exception 'Signature impossible. Il manque : %.', array_to_string(manques, ' ; ');
    end if;
    v_num := prochain_numero('fiche');
    update fiche_fluide set
      numero = v_num,
      statut = 'signee_operateur',
      signature_operateur_le  = now(),
      signature_operateur_nom = coalesce(nullif(trim(p_nom), ''), operateur->'technicien'->>'nom')
    where id = p_id;
    return v_num;

  elsif p_qui = 'detenteur' then
    if f.statut <> 'signee_operateur' then
      raise exception 'Le technicien signe en premier ; le client signe une fiche déjà numérotée.';
    end if;
    if coalesce(trim(p_nom), '') = '' then
      raise exception 'Le nom du client qui signe est obligatoire.';
    end if;
    manques := manques_fiche_fluide(p_id, 'detenteur');
    if cardinality(manques) > 0 then
      raise exception 'Signature impossible. Il manque : %.', array_to_string(manques, ' ; ');
    end if;
    update fiche_fluide set
      statut = 'signee',
      signature_detenteur_le  = now(),
      signature_detenteur_nom = trim(p_nom)
    where id = p_id;
    return f.numero;
  end if;

  raise exception 'Signataire inconnu : %. Attendu : operateur ou detenteur.', p_qui;
end $$;


-- -----------------------------------------------------------------------------
-- 8. Rectifier
--
-- On ne corrige pas une fiche signée : on en établit une nouvelle qui la
-- référence. L'originale garde son numéro et passe en « rectifiée » ; la
-- copie repart en brouillon et recevra son propre numéro à sa signature.
-- Les deux restent : c'est ce qu'un contrôleur doit pouvoir retracer.
-- -----------------------------------------------------------------------------

create or replace function rectifier_fiche_fluide(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f     fiche_fluide;
  v_new uuid;
begin
  select * into f from fiche_fluide
   where id = p_id and entreprise_id = mon_entreprise() for update;
  if not found then raise exception 'Fiche introuvable.'; end if;
  if f.statut not in ('signee_operateur', 'signee') then
    raise exception 'Seule une fiche signée se rectifie ; un brouillon se corrige directement.';
  end if;

  perform set_config('batinium.fiche_fluide', 'oui', true);

  insert into fiche_fluide (
    entreprise_id, rectifie_id, equipement_id, intervention_id, chantier_id, tiers_id,
    site_id, technicien_id, operateur, detenteur, equipement, nature, nature_autre,
    detecteur_identification, detecteur_controle_le, detection_permanente,
    frequence_applicable, fuites_constatees, fuites, charge_vierge, charge_recyclee,
    charge_regeneree, recup_traitement, recup_reutilisation, contenants, denomination_adr,
    destination, bsff, observations, date_intervention)
  values (
    f.entreprise_id, f.id, f.equipement_id, f.intervention_id, f.chantier_id, f.tiers_id,
    f.site_id, f.technicien_id, f.operateur, f.detenteur, f.equipement, f.nature, f.nature_autre,
    f.detecteur_identification, f.detecteur_controle_le, f.detection_permanente,
    f.frequence_applicable, f.fuites_constatees, f.fuites, f.charge_vierge, f.charge_recyclee,
    f.charge_regeneree, f.recup_traitement, f.recup_reutilisation, f.contenants, f.denomination_adr,
    f.destination, f.bsff, f.observations, f.date_intervention)
  returning id into v_new;

  update fiche_fluide set statut = 'rectifiee' where id = p_id;
  return v_new;
end $$;


-- -----------------------------------------------------------------------------
-- 9. L'immuabilité
--
-- Une fiche signée ne change plus, et ne se supprime pas. Le numéro et l'état
-- ne se posent que par les fonctions de signature et de rectification — elles
-- lèvent un drapeau de transaction que ce déclencheur exige. Sans lui, un
-- simple UPDATE suffirait à fabriquer une fiche « signée ».
--
-- Les colonnes générées sont écartées de la comparaison : dans un
-- déclencheur BEFORE, Postgres ne les a pas encore calculées sur NEW.
--
-- Les créations sont surveillées aussi : sans cela, il suffisait d'insérer une
-- fiche directement « signée », numéro inventé compris, pour contourner tout
-- ce qui précède. Une fiche naît brouillon, sans numéro ni signature — sauf la
-- rectificative, créée par sa fonction.
-- -----------------------------------------------------------------------------

create or replace function fiche_fluide_verrou()
returns trigger language plpgsql as $$
declare
  autorise boolean := coalesce(current_setting('batinium.fiche_fluide', true), '') = 'oui';
  libres   text[]  := array['updated_at', 'charge_totale', 'recup_totale'];
begin
  if tg_op = 'INSERT' then
    if (new.statut <> 'brouillon' or new.numero is not null
        or new.signature_operateur_le is not null or new.signature_detenteur_le is not null)
       and not autorise then
      raise exception 'Une fiche naît en brouillon, sans numéro ni signature. Elle se signe ensuite.';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.statut <> 'brouillon' then
      raise exception 'Une fiche signée ne se supprime pas : elle se conserve cinq ans. '
                      'Établissez une fiche rectificative.';
    end if;
    return old;
  end if;

  new.updated_at := now();

  if old.statut = 'brouillon' then
    if (new.numero is distinct from old.numero or new.statut is distinct from old.statut)
       and not autorise then
      raise exception 'Le numéro et l''état d''une fiche ne se posent que par sa signature.';
    end if;
    return new;
  end if;

  if old.statut = 'rectifiee' then
    raise exception 'Cette fiche a été rectifiée et ne change plus. Modifiez la fiche rectificative.';
  end if;

  -- signee_operateur ou signee
  if not autorise then
    raise exception 'Une fiche signée ne se modifie plus. Établissez une fiche rectificative.';
  end if;
  if old.statut = 'signee_operateur' then
    libres := libres || array['statut', 'signature_detenteur_le', 'signature_detenteur_nom'];
  else
    libres := libres || array['statut'];
  end if;
  if (to_jsonb(new) - libres) <> (to_jsonb(old) - libres) then
    raise exception 'Une fiche signée ne se modifie plus. Établissez une fiche rectificative.';
  end if;
  if new.statut is distinct from old.statut
     and not (new.statut = 'rectifiee'
              or (old.statut = 'signee_operateur' and new.statut = 'signee')) then
    raise exception 'Passage de « % » à « % » refusé.', old.statut, new.statut;
  end if;
  return new;
end $$;

drop trigger if exists fiche_fluide_verrou_trg on fiche_fluide;
create trigger fiche_fluide_verrou_trg
  before insert or update or delete on fiche_fluide
  for each row execute function fiche_fluide_verrou();


-- -----------------------------------------------------------------------------
-- 10. Les mouvements de fluide
--
-- Une ligne par fiche signée : c'est le registre que le carnet des fluides de
-- l'entreprise reprendra (phase 2), et le schéma est fixé dès maintenant pour
-- ne pas bouger ensuite.
--
-- Les fiches signées par le seul technicien y figurent : le fluide a été
-- chargé, que le client ait signé ou non. Les fiches rectifiées n'y figurent
-- pas — leur rectification les remplace.
-- -----------------------------------------------------------------------------

drop view if exists v_mouvements_fluide cascade;

create view v_mouvements_fluide with (security_invoker = false) as
select
  f.entreprise_id,
  f.id                         as fiche_id,
  f.numero,
  f.statut,
  f.date_intervention,
  f.chantier_id,
  c.numero                     as chantier_numero,
  f.detenteur->>'nom'          as client,
  f.equipement_id,
  nullif(concat_ws(' ', f.equipement->>'marque', f.equipement->>'modele'), '') as machine,
  f.equipement->>'numero_serie' as numero_serie,
  f.equipement->>'fluide'      as fluide,
  f.contenants,
  f.charge_totale              as charge_kg,
  f.recup_totale               as recupere_kg,
  f.destination,
  f.bsff
from fiche_fluide f
left join chantier c on c.id = f.chantier_id
where f.entreprise_id = mon_entreprise()
  and f.statut in ('signee_operateur', 'signee');

grant select on v_mouvements_fluide to authenticated;

comment on view v_mouvements_fluide is
  'Registre des mouvements de fluide : une ligne par fiche signée. Base du carnet des fluides.';


-- -----------------------------------------------------------------------------
-- 11. Vérification
--
-- On signe vraiment une fiche, au nom d'un membre existant de la direction :
-- refus sans numéro de série, acceptation une fois la machine vérifiée,
-- numéro au bon format, refus de toute modification ensuite, rectification.
-- Tout est annulé à la fin, compteur compris : la vérification ne doit pas
-- consommer un numéro de la série réelle.
-- -----------------------------------------------------------------------------

do $$
declare
  v_user uuid;
  v_ent  uuid;
  v_mbr  uuid;
  v_eq   uuid;
  v_fi   uuid;
  v_rect uuid;
  v_num  text;
  refuse boolean;
begin
  select m.user_id, m.entreprise_id, m.id into v_user, v_ent, v_mbr
    from membre m where m.role = 'direction' and m.actif limit 1;
  if v_user is null then
    raise notice 'Aucun membre de direction : vérification sautée.';
    raise notice 'SQL 33 appliqué. Fiche fluides, numérotation, autocontrôles et immuabilité en place.';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

    -- Les attestations du membre et de l'entreprise, valides le temps du test.
    update membre set aptitude_fluides_num = coalesce(aptitude_fluides_num, 'TEST'),
                      aptitude_fluides_expire_le = null where id = v_mbr;
    update parametres set attestation_capacite = coalesce(attestation_capacite, 'TEST'),
                          attestation_capacite_expire_le = null where entreprise_id = v_ent;

    insert into equipement (entreprise_id, fluide, charge_kg, prp, marque, modele, statut)
      values (v_ent, 'R32', 0.65, 675, 'Daikin', 'FTXM25', 'actif') returning id into v_eq;
    insert into fiche_fluide (entreprise_id, equipement_id, technicien_id, nature)
      values (v_ent, v_eq, v_mbr, array['mise_en_service']) returning id into v_fi;
    insert into document (entreprise_id, fiche_fluide_id, type, nom, legende)
      values (v_ent, v_fi, 'signature', 'signature.png', 'operateur');

    -- Sans plaque ni numéro de série : refus.
    refuse := false;
    begin
      perform signer_fiche_fluide(v_fi, 'operateur');
    exception when others then
      refuse := sqlerrm like '%Machine non vérifiée%';
    end;
    if not refuse then
      raise exception 'ÉCHEC : une fiche sans machine vérifiée a pu être signée.';
    end if;

    -- La machine vérifiée : acceptation, et numéro au format FF-AAAA-NNNN.
    update equipement set numero_serie = 'K123456' where id = v_eq;
    insert into document (entreprise_id, equipement_id, type, nom)
      values (v_ent, v_eq, 'plaque_signaletique', 'plaque.jpg');
    v_num := signer_fiche_fluide(v_fi, 'operateur');
    if v_num !~ ('^FF-' || extract(year from current_date) || '-\d{4}$') then
      raise exception 'ÉCHEC : numéro « % » au mauvais format.', v_num;
    end if;
    if (select equipement->>'numero_serie' from fiche_fluide where id = v_fi) <> 'K123456' then
      raise exception 'ÉCHEC : la copie de l''équipement n''a pas été figée à la signature.';
    end if;

    -- Signée : aucune modification n'est plus admise.
    perform set_config('batinium.fiche_fluide', '', true);
    refuse := false;
    begin
      update fiche_fluide set charge_vierge = 1 where id = v_fi;
    exception when others then
      refuse := true;
    end;
    if not refuse then
      raise exception 'ÉCHEC : une fiche signée a pu être modifiée.';
    end if;

    -- Un brouillon ne s'attribue pas de numéro par un simple UPDATE.
    refuse := false;
    begin
      insert into fiche_fluide (entreprise_id, equipement_id, technicien_id)
        values (v_ent, v_eq, v_mbr) returning id into v_rect;
      update fiche_fluide set numero = 'FF-FAUX', statut = 'signee' where id = v_rect;
    exception when others then
      refuse := true;
    end;
    if not refuse then
      raise exception 'ÉCHEC : un brouillon a pu se déclarer signé sans passer par la signature.';
    end if;

    -- Une fiche ne peut pas naître signée.
    refuse := false;
    begin
      insert into fiche_fluide (entreprise_id, equipement_id, statut, numero)
        values (v_ent, v_eq, 'signee', 'FF-FAUX');
    exception when others then
      refuse := true;
    end;
    if not refuse then
      raise exception 'ÉCHEC : une fiche a pu être créée directement signée.';
    end if;

    -- Rectification : l'originale passe en rectifiée, la copie en brouillon.
    v_rect := rectifier_fiche_fluide(v_fi);
    if (select statut from fiche_fluide where id = v_fi) <> 'rectifiee'
       or (select statut from fiche_fluide where id = v_rect) <> 'brouillon'
       or (select rectifie_id from fiche_fluide where id = v_rect) <> v_fi then
      raise exception 'ÉCHEC : la rectification n''a pas produit les deux fiches attendues.';
    end if;

    raise exception 'fin_de_verification';
  exception when raise_exception then
    if sqlerrm <> 'fin_de_verification' then raise; end if;
  end;

  raise notice 'SQL 33 appliqué. Fiche fluides, numérotation, autocontrôles et immuabilité en place.';
end $$;
