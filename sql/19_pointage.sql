-- =============================================================================
-- BATINIUM — 19. Pointage des heures
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase, après 18.
-- Rejouable.
--
-- La moitié manquante de la marge réelle. Jusqu'ici Batinium comparait un prix
-- de vente à un prix d'achat catalogue : c'est une marge prévisionnelle, et
-- elle ignore le poste qui fait basculer un chantier — le temps passé.
-- L'autre moitié, les factures fournisseurs rapprochées, viendra avec le
-- module achats.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Le pointage
--
-- Une ligne par personne, par jour, par chantier. Volontairement grossier :
-- un poseur ne remplira pas un formulaire de huit champs sur un téléphone, les
-- mains sales, à dix-huit heures. Une date, un chantier, un nombre d'heures.
--
-- `valide` sépare ce que le terrain déclare de ce que la direction accepte.
-- Une fois validée, la ligne se fige pour son auteur : c'est la seule façon
-- qu'un chiffre serve à quelque chose une fois qu'il a été regardé.
-- -----------------------------------------------------------------------------

create table if not exists pointage (
  id              uuid primary key default gen_random_uuid(),
  entreprise_id   uuid not null references entreprise(id) on delete cascade,
  membre_id       uuid not null references membre(id) on delete cascade,
  chantier_id     uuid references chantier(id) on delete set null,
  intervention_id uuid references intervention(id) on delete set null,
  jour            date not null default current_date,
  heures          numeric(5,2) not null check (heures > 0 and heures <= 24),
  type            text not null default 'pose'
                  check (type in ('pose','deplacement','preparation','sav','entretien',
                                  'attente','atelier','autre')),
  commentaire     text,
  valide          boolean not null default false,
  valide_le       timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists pointage_jour_idx     on pointage (entreprise_id, jour desc);
create index if not exists pointage_membre_idx   on pointage (entreprise_id, membre_id, jour desc);
create index if not exists pointage_chantier_idx on pointage (entreprise_id, chantier_id)
  where chantier_id is not null;

comment on table pointage is
  'Heures déclarées par l''équipe. Une ligne validée ne peut plus être modifiée par son auteur.';
comment on column pointage.heures is
  'En heures décimales : 7,5 pour sept heures trente. Plus rapide à saisir qu''un début et une fin.';


-- -----------------------------------------------------------------------------
-- 2. Droits
--
-- Chacun saisit et corrige les siennes tant qu'elles n'ont pas été validées.
-- Personne ne voit celles des autres, sauf la direction et les chefs de
-- chantier — les heures d'un collègue ne regardent pas un poseur.
--
-- La validation est réservée à la direction, et le WITH CHECK l'impose sur la
-- ligne écrite : un salarié ne peut pas se valider lui-même, même en modifiant
-- une ligne qui lui appartient.
-- -----------------------------------------------------------------------------

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'pointage'
  loop
    execute format('drop policy %I on pointage', p.policyname);
  end loop;
end $$;

alter table pointage enable row level security;

create policy lecture on pointage for select to authenticated
  using (entreprise_id = mon_entreprise()
         and (voit_les_prix() or membre_id = mon_membre()));

create policy saisie on pointage for insert to authenticated
  with check (entreprise_id = mon_entreprise()
              and (mon_role() = 'direction'
                   or (membre_id = mon_membre() and not valide)));

create policy correction on pointage for update to authenticated
  using (entreprise_id = mon_entreprise()
         and (mon_role() = 'direction' or (membre_id = mon_membre() and not valide)))
  with check (entreprise_id = mon_entreprise()
              and (mon_role() = 'direction' or (membre_id = mon_membre() and not valide)));

create policy retrait on pointage for delete to authenticated
  using (entreprise_id = mon_entreprise()
         and (mon_role() = 'direction' or (membre_id = mon_membre() and not valide)));


-- -----------------------------------------------------------------------------
-- 3. Le coût réel de la main-d'œuvre, par chantier
--
-- Le taux horaire retenu est celui **du jour travaillé**, pas celui
-- d'aujourd'hui : c'est précisément pour ça que les rémunérations sont
-- historisées depuis le SQL 14. Une augmentation en avril ne doit pas
-- renchérir rétroactivement un chantier de février.
--
-- La vue est en security definer, comme la fiche de pose : elle lit
-- `remuneration`, réservée à la direction, pour rendre un coût agrégé par
-- chantier. Le `voit_les_prix()` dans le WHERE fait le tri — un technicien qui
-- interrogerait la vue obtiendrait zéro ligne, pas les salaires de ses
-- collègues. Rien d'individuel n'en sort : ni nom, ni taux, ni montant par
-- personne.
-- -----------------------------------------------------------------------------

drop view if exists v_cout_main_oeuvre cascade;

create view v_cout_main_oeuvre with (security_invoker = false) as
select
  p.entreprise_id,
  p.chantier_id,
  sum(p.heures)                                  as heures,
  sum(p.heures) filter (where p.valide)          as heures_validees,
  round(sum(p.heures * coalesce(t.taux, 0)), 2)  as cout
from pointage p
left join lateral (
  select
    coalesce(r.cout_employeur_mensuel, r.brut_mensuel * par.coefficient_charges)
      / nullif(r.heures_hebdo * 52 / 12, 0) as taux
  from remuneration r
  join parametres par on par.entreprise_id = r.entreprise_id
  where r.membre_id = p.membre_id
    and r.depuis_le <= p.jour
  order by r.depuis_le desc
  limit 1
) t on true
where p.entreprise_id = mon_entreprise()
  and p.chantier_id is not null
  and voit_les_prix()
group by p.entreprise_id, p.chantier_id;

grant select on v_cout_main_oeuvre to authenticated;

comment on view v_cout_main_oeuvre is
  'Heures et coût employeur par chantier, au taux en vigueur le jour travaillé. Agrégé : rien d''individuel n''en sort.';


-- -----------------------------------------------------------------------------
-- 4. Vérification
-- -----------------------------------------------------------------------------

do $$
declare fuite text;
begin
  select string_agg(column_name, ', ') into fuite
  from information_schema.columns
  where table_schema = 'public' and table_name = 'v_cout_main_oeuvre'
    and column_name in ('membre_id', 'nom', 'brut_mensuel', 'taux');

  if fuite is not null then
    raise exception 'Le coût de main-d''œuvre exposerait du détail individuel : %.', fuite;
  end if;

  raise notice 'SQL 19 appliqué. Pointage créé, coût de main-d''œuvre agrégé par chantier.';
end $$;
