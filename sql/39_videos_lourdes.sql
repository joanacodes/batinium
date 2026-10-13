-- =============================================================================
-- BATINIUM — 39. Des vidéos jusqu'à 500 Mo
--
-- À exécuter en une fois dans l'éditeur SQL de Supabase. Rejouable.
-- Ne touche qu'au seau `documents` (SQL 13) : indépendant des SQL 32 à 38.
--
-- Le seau acceptait 50 Mo par fichier : vingt à trente secondes de vidéo au
-- téléphone, trop court pour montrer une installation. Fabrice passe Supabase
-- à l'offre Pro, où la limite par fichier se règle bien au-delà. On la porte
-- à 500 Mo : trois minutes de vidéo en 4K, huit en HD. Pas plus : 500 Mo,
-- c'est déjà cinq à dix minutes d'envoi sur la 4G d'un chantier, et au-delà
-- mieux vaut filmer en plusieurs fois.
--
-- DEUX LIMITES s'appliquent, et la plus basse l'emporte :
--   - celle du seau, que ce script relève ;
--   - celle du projet, qui ne se règle pas en SQL : Supabase → Storage →
--     Settings → « Upload file size limit », à porter à 500 MB. Sur l'offre
--     gratuite, elle reste bloquée à 50 Mo.
-- Tant que celle du projet n'est pas relevée, l'application le dit au moment
-- d'envoyer : Supabase refuse la taille annoncée, avant le premier octet.
--
-- La constante TAILLE_MAXIMALE de src/lib/db.ts vaut la même chose : la
-- changer avec celle-ci.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. La limite du seau
--
-- Jamais vers le bas : si quelqu'un l'a déjà portée plus haut dans Supabase,
-- rejouer ce script ne doit pas la réduire.
-- -----------------------------------------------------------------------------

update storage.buckets
   set file_size_limit = greatest(coalesce(file_size_limit, 0), 524288000)
 where id = 'documents';


-- -----------------------------------------------------------------------------
-- 2. Vérification
--
-- Ce bloc ne peut pas essayer un envoi : c'est le serveur de fichiers de
-- Supabase, pas Postgres, qui applique la limite, en lisant la ligne du seau.
-- Il vérifie donc ce que ce serveur lira : le seau existe, il reste privé, il
-- accepte 500 Mo. L'essai réel est l'envoi d'une vidéo de plus de 50 Mo
-- depuis l'application, une fois la limite du projet relevée.
--
-- Le SQL 13, qui crée le seau à 50 Mo, a été retouché le même jour pour ne
-- plus jamais baisser cette limite : le rejouer après celui-ci ne défait rien.
-- -----------------------------------------------------------------------------

do $$
declare
  v_seau storage.buckets;
begin
  select * into v_seau from storage.buckets where id = 'documents';
  if v_seau.id is null then
    raise exception 'SQL 39 : le seau « documents » n''existe pas — exécutez d''abord le SQL 13.';
  end if;
  if v_seau.public then
    raise exception 'SQL 39 : le seau « documents » est public, il doit rester privé (SQL 13).';
  end if;
  if coalesce(v_seau.file_size_limit, 0) < 524288000 then
    raise exception 'SQL 39 : le seau « documents » accepte % octets, il en faut 524288000.',
      v_seau.file_size_limit;
  end if;

  raise notice '%', 'SQL 39 appliqué. Le seau accepte 500 Mo par fichier. Reste à relever la '
    || 'limite du projet : Supabase → Storage → Settings → Upload file size limit (offre Pro).';
end $$;
