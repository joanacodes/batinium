-- =============================================================================
-- BATINIUM — 33. La fiche d'intervention fluides (Cerfa 15497*04)
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 32.
-- Rejouable, y compris sur une base où la version livrée le 4 octobre a déjà
-- tourné.
--
-- Toute opération sur le fluide d'un équipement — assemblage, mise en
-- service, maintenance, contrôle, démantèlement — donne lieu à une fiche
-- conforme au Cerfa 15497*04 (art. R.543-82 du Code de l'environnement, arrêté
-- du 29 février 2016). Une fiche par équipement, conservée au moins cinq ans
-- par l'opérateur et par le détenteur.
--
-- Trois choses font de cette table autre chose qu'un formulaire :
--   - le numéro ne s'attribue qu'à la signature du technicien ;
--   - la signature exige sept autocontrôles, vérifiés ici, pas seulement à
--     l'écran ;
--   - une fiche signée ne bouge plus. On la corrige par une fiche
--     rectificative, et les deux restent.
--
-- Corrigé le 13 octobre, avant toute exécution sur Supabase :
--   - la version livrée remplaçait `prochain_numero`, et avec elle les
--     préfixes et le format de numérotation réglés dans Entreprise : les
--     devis, chantiers et factures auraient changé de format en silence. Les
--     fiches ont désormais leur propre fonction, `prochain_numero_fiche` ;
--   - les autocontrôles échouaient sur « malformed array literal » au lieu de
--     dire ce qui manque : un tableau de texte s'allonge par array_append ;
--   - la signature du client n'est exigée qu'au-delà de 3 kg de HCFC ou de
--     5 t éq. CO2 de HFC, comme le dit la notice 52064*04. En dessous, elle
--     reste possible mais ne bloque plus la fiche ;
--   - les lettres de la rubrique 11 sont celles du Cerfa : A + B + C chargé,
--     D + E récupéré ;
--   - ajout de la qualité de chaque signataire et du fluide chargé quand il
--     change, deux champs du formulaire officiel.
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

  -- Rubriques 5 à 10 : contrôle d'étanchéité.
  detecteur_identification text,
  detecteur_controle_le    date,
  detection_permanente     boolean,
  frequence_applicable     text,
  fuites_constatees        boolean,
  fuites                   jsonb not null default '[]'::jsonb,

  -- Rubrique 11 : manipulation du fluide, en kilogrammes. Les lettres sont
  -- celles du Cerfa ; la notice, le BSFF et le bilan annuel y renvoient.
  charge_vierge       numeric(8,3) not null default 0 check (charge_vierge >= 0),        -- A
  charge_recyclee     numeric(8,3) not null default 0 check (charge_recyclee >= 0),      -- B
  charge_regeneree    numeric(8,3) not null default 0 check (charge_regeneree >= 0),     -- C
  recup_traitement    numeric(8,3) not null default 0 check (recup_traitement >= 0),     -- D
  recup_reutilisation numeric(8,3) not null default 0 check (recup_reutilisation >= 0),  -- E
  contenants          text,
  denomination_adr    text,
  destination         text,
  bsff                text,

  -- Rubrique 14.
  observations    text,

  -- Signatures : les images sont des documents de type « signature »,
  -- rattachés à la fiche, leur légende disant qui a signé.
  signature_operateur_le  timestamptz,
  signature_operateur_nom text,
  signature_detenteur_le  timestamptz,
  signature_detenteur_nom text,

  date_intervention date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entreprise_id, numero)
);

-- Ajouts du 13 octobre. En `add column if not exists` pour qu'une base où la
-- version livrée a tourné les reçoive aussi.
alter table fiche_fluide
  add column if not exists fluide_charge_si_changement text,
  add column if not exists signature_operateur_qualite text,
  add column if not exists signature_detenteur_qualite text,
  add column if not exists signature_detenteur_requise boolean;

comment on column fiche_fluide.fluide_charge_si_changement is
  'Rubrique 11 : le fluide chargé quand ce n''est pas celui de la plaque (reconversion). Nul sinon.';
comment on column fiche_fluide.signature_detenteur_qualite is
  'Qualité du signataire côté détenteur : propriétaire, gestionnaire, syndic… Le Cerfa la demande.';
comment on column fiche_fluide.signature_detenteur_requise is
  'Vrai au-delà de 3 kg de HCFC ou de 5 t éq. CO2 de HFC (art. R.543-82, notice 52064*04). Figé à la signature du technicien.';

-- A + B + C et D + E : calculés, ils ne peuvent pas contredire leurs parties.
-- Une fiche où le total chargé n'égale pas la somme de ses origines serait
-- refusée par n'importe quel contrôleur.
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
  'Tableau [{localisation, reparation_faite, reparation_a_faire}] — rubrique 10, une ligne par fuite.';


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
-- Une fonction à part, et non une branche de `prochain_numero`. Celle-ci a
-- été réécrite après le SQL 01 pour lire les préfixes et le format réglés
-- dans Entreprise ; la redéfinir ici depuis sa version d'origine les aurait
-- effacés, et la série des factures aurait changé de format en cours d'année.
--
-- Même compteur, sous le type « fiche » : une ligne par entreprise et par
-- année, qui ne recule jamais. Aucun format n'est imposé par les textes ; le
-- préfixe FF reste une question ouverte avec Fabrice (les bordereaux
-- Trackdéchets portent aussi FF, sous la forme FF-AAAAMMJJ-…).
-- -----------------------------------------------------------------------------

create or replace function prochain_numero_fiche()
returns text language plpgsql security definer set search_path = public as $$
declare
  e uuid := mon_entreprise();
  a int  := extract(year from current_date);
  n int;
begin
  if e is null then
    raise exception 'Aucune entreprise rattachée à cet utilisateur.';
  end if;
  insert into compteur (entreprise_id, type, annee) values (e, 'fiche', a)
    on conflict (entreprise_id, type, annee) do nothing;
  update compteur set dernier = dernier + 1
    where entreprise_id = e and type = 'fiche' and annee = a
    returning dernier into n;
  return 'FF-' || a || '-' || lpad(n::text, 4, '0');
end $$;


-- -----------------------------------------------------------------------------
-- 5. Faut-il la signature du client ?
--
-- L'article R.543-82 ne l'exige qu'au-delà de 3 kg de HCFC ou de 5 t éq. CO2
-- de HFC ; en dessous, la notice dit que la fiche « n'est pas à signer par le
-- détenteur, par souci de simplification ». C'est le cas de la plupart des
-- splits résidentiels : 5 t, c'est 7,4 kg de R32.
--
-- Une charge ou une famille inconnue répond « oui » : mieux vaut une signature
-- de trop qu'une fiche incomplète le jour d'un contrôle.
-- -----------------------------------------------------------------------------

create or replace function signature_detenteur_requise(p_famille text, p_charge_kg numeric,
                                                       p_tonnage numeric)
returns boolean language sql immutable as $$
  select case
    when p_famille = 'HCFC' then p_charge_kg is null or p_charge_kg > 3
    when p_famille = 'HFC'  then p_tonnage is null or p_tonnage > 5
    when p_famille in ('HFO', 'HC', 'CO2') then false
    else true
  end
$$;


-- -----------------------------------------------------------------------------
-- 6. Les copies figées : opérateur, détenteur, équipement
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
  v_prp     numeric;
  v_tonnage numeric;
begin
  select * into f from fiche_fluide where id = p_id and entreprise_id = mon_entreprise();
  if not found then raise exception 'Fiche introuvable.'; end if;
  if f.statut <> 'brouillon' then return; end if;

  select * into m  from equipement where id = f.equipement_id;
  select * into pa from parametres where entreprise_id = f.entreprise_id;
  select * into t  from membre     where id = f.technicien_id;
  select * into ff from fluide_frigorigene where code = m.fluide;

  v_prp     := coalesce(m.prp, ff.prp);
  v_tonnage := tonnage_co2(m.charge_kg, v_prp);

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
      'famille',       ff.famille,
      'prp',           v_prp,
      'charge_kg',     m.charge_kg,
      'tonnage_co2',   v_tonnage,
      'hermetique',    m.hermetique,
      'puissance_kw',  m.puissance_kw),
    detection_permanente = coalesce(f.detection_permanente, m.detection_permanente),
    frequence_applicable = frequence_controle(ff.famille, m.charge_kg, v_tonnage, m.hermetique,
                                              coalesce(f.detection_permanente, m.detection_permanente)),
    signature_detenteur_requise = signature_detenteur_requise(ff.famille, m.charge_kg, v_tonnage),
    denomination_adr = coalesce(f.denomination_adr, ff.denomination_adr)
  where id = p_id;
end $$;


-- -----------------------------------------------------------------------------
-- 7. Les autocontrôles
--
-- La même liste que l'écran, vérifiée ici pour que l'écran ne soit pas la
-- seule barrière : une fiche sans attestation valide ne doit pas pouvoir être
-- signée, même par un appel direct à la base.
--
-- Rend la liste de ce qui manque, vide quand tout est en ordre. array_append
-- et non `||` : un texte littéral collé à un tableau par `||` est lu par
-- Postgres comme un tableau mal écrit, et l'erreur remplaçait la liste.
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
      manques := array_append(manques, 'Signature du client');
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
    manques := array_append(manques, 'Machine non vérifiée : photo de la plaque et numéro de série requis');
  end if;

  -- 2. et 3. Une attestation périmée interdit l'intervention elle-même.
  if t.id is null or coalesce(trim(t.aptitude_fluides_num), '') = ''
     or (t.aptitude_fluides_expire_le is not null and t.aptitude_fluides_expire_le < f.date_intervention) then
    manques := array_append(manques, 'Technicien sans attestation d''aptitude valide');
  end if;
  if coalesce(trim(pa.attestation_capacite), '') = ''
     or (pa.attestation_capacite_expire_le is not null
         and pa.attestation_capacite_expire_le < f.date_intervention) then
    manques := array_append(manques, 'Entreprise sans attestation de capacité valide');
  end if;

  -- 4.
  if cardinality(f.nature) = 0 then
    manques := array_append(manques, 'Nature de l''intervention à cocher');
  end if;

  -- 5. Un fluide chargé vient d'un contenant identifié ; un fluide récupéré
  --    part quelque part, avec un bordereau.
  if f.charge_totale > 0 and coalesce(trim(f.contenants), '') = '' then
    manques := array_append(manques, 'Contenant du fluide chargé à identifier');
  end if;
  if f.recup_totale > 0
     and (coalesce(trim(f.destination), '') = '' or coalesce(trim(f.bsff), '') = '') then
    manques := array_append(manques, 'Destination et n° de BSFF du fluide récupéré à renseigner');
  end if;

  -- 6.
  if (f.nature && array['controle_periodique','controle_non_periodique'])
     or coalesce(f.frequence_applicable, 'non_soumis') <> 'non_soumis' then
    if coalesce(trim(f.detecteur_identification), '') = ''
       or f.detecteur_controle_le is null or f.fuites_constatees is null then
      manques := array_append(manques,
        'Contrôle d''étanchéité incomplet : détecteur, date de son contrôle, fuites constatées');
    end if;
  end if;

  -- 7.
  if not exists (select 1 from document where fiche_fluide_id = p_id
                  and type = 'signature' and legende = 'operateur') then
    manques := array_append(manques, 'Signature du technicien');
  end if;

  return manques;
end $$;


-- -----------------------------------------------------------------------------
-- 8. Signer
--
-- `p_nom` est le nom déclaré du signataire. Pour le technicien, son nom de
-- membre s'impose s'il n'est pas fourni ; pour le client, il est obligatoire.
-- `p_qualite` est la « qualité du signataire » du Cerfa.
--
-- Quand la signature du client n'est pas requise, la fiche est complète dès
-- la signature du technicien. Le client peut encore signer ensuite, une fois :
-- c'est une preuve de passage que Fabrice peut vouloir, pas une obligation.
-- -----------------------------------------------------------------------------

-- La version livrée n'avait pas de qualité : sa signature à trois arguments
-- coexisterait avec la nouvelle, et PostgREST ne saurait laquelle appeler.
drop function if exists signer_fiche_fluide(uuid, text, text);

create or replace function signer_fiche_fluide(p_id uuid, p_qui text, p_nom text default null,
                                               p_qualite text default null)
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
    select * into f from fiche_fluide where id = p_id;
    v_num := prochain_numero_fiche();
    update fiche_fluide set
      numero = v_num,
      statut = case when coalesce(f.signature_detenteur_requise, true)
                    then 'signee_operateur' else 'signee' end,
      signature_operateur_le      = now(),
      signature_operateur_nom     = coalesce(nullif(trim(p_nom), ''), operateur->'technicien'->>'nom'),
      signature_operateur_qualite = coalesce(nullif(trim(p_qualite), ''), 'Technicien')
    where id = p_id;
    return v_num;

  elsif p_qui = 'detenteur' then
    if not (f.statut = 'signee_operateur'
            or (f.statut = 'signee' and not coalesce(f.signature_detenteur_requise, true)
                and f.signature_detenteur_le is null)) then
      raise exception 'Le client signe une fiche déjà numérotée par le technicien, et une seule fois.';
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
      signature_detenteur_le      = now(),
      signature_detenteur_nom     = trim(p_nom),
      signature_detenteur_qualite = nullif(trim(p_qualite), '')
    where id = p_id;
    return f.numero;
  end if;

  raise exception 'Signataire inconnu : %. Attendu : operateur ou detenteur.', p_qui;
end $$;


-- -----------------------------------------------------------------------------
-- 9. Rectifier
--
-- On ne corrige pas une fiche signée : on en établit une nouvelle qui la
-- référence. L'originale garde son numéro et passe en « rectifiée » ; la
-- copie repart en brouillon et recevra son propre numéro à sa signature.
-- Les deux restent : c'est ce qu'un contrôleur doit pouvoir retracer.
--
-- Les quantités de la rectificative remplacent celles de l'originale dans le
-- registre, elles ne s'y ajoutent pas : v_mouvements_fluide écarte les fiches
-- rectifiées pour cette raison.
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
    destination, bsff, observations, date_intervention, fluide_charge_si_changement,
    signature_detenteur_requise)
  values (
    f.entreprise_id, f.id, f.equipement_id, f.intervention_id, f.chantier_id, f.tiers_id,
    f.site_id, f.technicien_id, f.operateur, f.detenteur, f.equipement, f.nature, f.nature_autre,
    f.detecteur_identification, f.detecteur_controle_le, f.detection_permanente,
    f.frequence_applicable, f.fuites_constatees, f.fuites, f.charge_vierge, f.charge_recyclee,
    f.charge_regeneree, f.recup_traitement, f.recup_reutilisation, f.contenants, f.denomination_adr,
    f.destination, f.bsff, f.observations, f.date_intervention, f.fluide_charge_si_changement,
    f.signature_detenteur_requise)
  returning id into v_new;

  update fiche_fluide set statut = 'rectifiee' where id = p_id;
  return v_new;
end $$;


-- -----------------------------------------------------------------------------
-- 10. L'immuabilité
--
-- Une fiche signée ne change plus, et ne se supprime pas. Le numéro et l'état
-- ne se posent que par les fonctions de signature et de rectification — elles
-- lèvent un drapeau de transaction que ce déclencheur exige. Sans lui, un
-- simple UPDATE suffirait à fabriquer une fiche « signée ».
--
-- Une seule ouverture après signature : la signature facultative du client,
-- une fois, sur une fiche qui ne l'exigeait pas. Rien d'autre ne bouge.
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
  client   text[]  := array['signature_detenteur_le', 'signature_detenteur_nom',
                            'signature_detenteur_qualite'];
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
  if old.statut = 'signee_operateur'
     or (old.signature_detenteur_le is null and not coalesce(old.signature_detenteur_requise, true)) then
    libres := libres || client || array['statut'];
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
-- 11. Les mouvements de fluide
--
-- Une ligne par fiche signée : c'est le registre que le carnet des fluides de
-- l'entreprise reprendra (phase 2), et le schéma est fixé dès maintenant pour
-- ne pas bouger ensuite.
--
-- Les fiches signées par le seul technicien y figurent : le fluide a été
-- chargé, que le client ait signé ou non. Les fiches rectifiées n'y figurent
-- pas — leur rectification les remplace.
--
-- `fluide_charge` est celui du bilan annuel : le fluide de la plaque, sauf
-- reconversion déclarée sur la fiche.
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
  coalesce(nullif(trim(f.fluide_charge_si_changement), ''), f.equipement->>'fluide') as fluide_charge,
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
-- 12. Vérification
--
-- On signe vraiment des fiches, au nom d'un membre existant de la direction :
-- refus motivé sans numéro de série, acceptation une fois la machine
-- vérifiée, numéro au bon format, signature du client facultative sous le
-- seuil et exigée au-dessus, refus de toute modification ensuite,
-- rectification. Tout est annulé à la fin, compteur compris : la vérification
-- ne doit pas consommer un numéro de la série réelle.
-- -----------------------------------------------------------------------------

do $$
declare
  v_user  uuid;
  v_ent   uuid;
  v_mbr   uuid;
  v_eq    uuid;
  v_eq2   uuid;
  v_fi    uuid;
  v_fi2   uuid;
  v_rect  uuid;
  v_num   text;
  refuse  boolean;
  message text;
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
    -- `nullif` : une attestation vide vaut une attestation absente.
    update membre set aptitude_fluides_num = coalesce(nullif(trim(aptitude_fluides_num), ''), 'TEST'),
                      aptitude_fluides_expire_le = null where id = v_mbr;
    update parametres set attestation_capacite = coalesce(nullif(trim(attestation_capacite), ''), 'TEST'),
                          attestation_capacite_expire_le = null where entreprise_id = v_ent;

    -- Une petite machine : 0,65 kg de R32, 0,439 t. Signature du client facultative.
    insert into equipement (entreprise_id, fluide, charge_kg, prp, marque, modele, statut)
      values (v_ent, 'R32', 0.65, 675, 'Daikin', 'FTXM25', 'actif') returning id into v_eq;
    insert into fiche_fluide (entreprise_id, equipement_id, technicien_id, nature)
      values (v_ent, v_eq, v_mbr, array['mise_en_service']) returning id into v_fi;
    insert into document (entreprise_id, fiche_fluide_id, type, nom, legende)
      values (v_ent, v_fi, 'signature', 'signature.png', 'operateur');

    -- Sans plaque ni numéro de série : refus, et le message dit pourquoi.
    message := null;
    begin
      perform signer_fiche_fluide(v_fi, 'operateur');
    exception when others then
      message := sqlerrm;
    end;
    if message is null or message not like 'Signature impossible. Il manque : Machine non vérifiée%' then
      raise exception 'ÉCHEC : refus attendu pour machine non vérifiée, obtenu « % ».', coalesce(message, 'aucun refus');
    end if;

    -- La machine vérifiée : acceptation, numéro au format FF-AAAA-NNNN, et
    -- fiche complète d'emblée puisque le client n'a pas à signer.
    update equipement set numero_serie = 'K123456' where id = v_eq;
    insert into document (entreprise_id, equipement_id, type, nom)
      values (v_ent, v_eq, 'plaque_signaletique', 'plaque.jpg');
    v_num := signer_fiche_fluide(v_fi, 'operateur');
    if v_num !~ ('^FF-' || extract(year from current_date) || '-\d{4}$') then
      raise exception 'ÉCHEC : numéro « % » au mauvais format.', v_num;
    end if;
    if (select statut from fiche_fluide where id = v_fi) <> 'signee' then
      raise exception 'ÉCHEC : sous le seuil, la fiche devrait être complète sans le client.';
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

    -- Le client peut encore signer, une fois.
    insert into document (entreprise_id, fiche_fluide_id, type, nom, legende)
      values (v_ent, v_fi, 'signature', 'client.png', 'detenteur');
    perform signer_fiche_fluide(v_fi, 'detenteur', 'Client essai', 'Propriétaire');
    if (select signature_detenteur_nom from fiche_fluide where id = v_fi) <> 'Client essai' then
      raise exception 'ÉCHEC : la signature facultative du client n''a pas été enregistrée.';
    end if;
    refuse := false;
    begin
      perform signer_fiche_fluide(v_fi, 'detenteur', 'Autre client');
    exception when others then
      refuse := true;
    end;
    if not refuse then
      raise exception 'ÉCHEC : le client a pu signer deux fois.';
    end if;

    -- Une grosse machine : 8 kg de R410A, 16,7 t. Signature du client exigée.
    insert into equipement (entreprise_id, fluide, charge_kg, prp, marque, modele, numero_serie, statut)
      values (v_ent, 'R410A', 8, 2088, 'Daikin', 'RZQG', 'G999', 'actif') returning id into v_eq2;
    insert into document (entreprise_id, equipement_id, type, nom)
      values (v_ent, v_eq2, 'plaque_signaletique', 'plaque2.jpg');
    insert into fiche_fluide (entreprise_id, equipement_id, technicien_id, nature,
                              detecteur_identification, detecteur_controle_le, fuites_constatees)
      values (v_ent, v_eq2, v_mbr, array['controle_periodique'], 'Détecteur essai', current_date, false)
      returning id into v_fi2;
    insert into document (entreprise_id, fiche_fluide_id, type, nom, legende)
      values (v_ent, v_fi2, 'signature', 'signature2.png', 'operateur');
    perform signer_fiche_fluide(v_fi2, 'operateur');
    if (select statut from fiche_fluide where id = v_fi2) <> 'signee_operateur'
       or (select frequence_applicable from fiche_fluide where id = v_fi2) <> '12_mois' then
      raise exception 'ÉCHEC : au-dessus du seuil, la fiche attend le client et un contrôle tous les 12 mois.';
    end if;
    message := null;
    begin
      perform signer_fiche_fluide(v_fi2, 'detenteur', 'Client essai');
    exception when others then
      message := sqlerrm;
    end;
    if message is null or message not like '%Signature du client%' then
      raise exception 'ÉCHEC : la signature du client sans son tracé a été acceptée (« % »).', message;
    end if;

    -- Un brouillon ne s'attribue pas de numéro par un simple UPDATE. Le
    -- drapeau des fonctions de signature, levé par les signatures ci-dessus,
    -- est d'abord rabattu : sans quoi ce serait lui qu'on éprouverait.
    perform set_config('batinium.fiche_fluide', '', true);
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
