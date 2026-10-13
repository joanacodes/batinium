-- =============================================================================
-- BATINIUM — Amorçage
-- À exécuter APRÈS 01_batinium.sql, une seule fois.
--
-- Ce fichier est REJOUABLE : il ne crée jamais deux fois la même chose.
--
-- Deux façons de démarrer, au choix :
--   a) Créez votre compte dans Supabase (Authentication → Users → Add user,
--      en cochant « Auto Confirm User »), puis exécutez ce fichier. Il
--      rattache le premier compte à l'entreprise, en direction.
--   b) Inscrivez-vous depuis l'application, créez votre entreprise à l'écran,
--      puis exécutez ce fichier pour ajouter le catalogue et les gabarits.
--
-- La dernière requête affiche le CODE D'INVITATION à donner aux salariés.
-- =============================================================================

-- 1. L'entreprise et son premier membre -------------------------------------
-- Rejouable : si l'entreprise a déjà été créée depuis l'application, ce bloc
-- ne fait rien et le catalogue vient s'ajouter à l'existant.

insert into entreprise (nom)
select 'Pilotech' where not exists (select 1 from entreprise);

insert into membre (entreprise_id, user_id, nom, role)
select e.id, u.id, coalesce(u.email, 'Direction'), 'direction'
from entreprise e
cross join lateral (select id, email from auth.users order by created_at limit 1) u
where not exists (select 1 from membre)
order by e.created_at
limit 1;

insert into parametres (entreprise_id)
select id from entreprise
where not exists (select 1 from parametres)
order by created_at limit 1;

-- Raccourci pour la suite du script
drop view if exists ent;
create temporary view ent as select id from entreprise order by created_at limit 1;

-- 2. Catalogue ---------------------------------------------------------------
-- Prix de VENTE réels, extraits du devis DEV-2026/07-0056.
-- Prix d'ACHAT rétro-calculés au coefficient 1,6 : à corriger avec Fabrice.

insert into produit
(entreprise_id, reference, designation, description, famille, nature, unite,
 puissance_kw, classe_froid, classe_chaud, fluide, fixe, reversible, connecte,
 prix_achat_ht, coefficient, prix_vente_ht)
select (select id from ent), * from (values

('IDRA4-36C', 'GROUPE INTERIEUR 4 SORTIES',
 E'Unité intérieure de condensation à eau invisible multisplit DC INVERTER FROID SEULEMENT.\nPuissance frigorifique 35 805 BTU/h (10 500 Watt).\nRéfrigérant R32. Raccords frigo diam. gas 4 x 1/4" - 3/8".\nRaccordement eau 1/2".\nAlimentation monophasée V/Ph/Hz 220-240/1/50.\nDimensions 500 x 300 x 750 mm.\nPossibilité de connecter maximum 4 unités intérieures.',
 'groupe_eau', 'fourniture', 'U',
 10.50::numeric, null::text, null::text, 'R32', true, false, false,
 4650.00::numeric, 1.598::numeric, 7431.00::numeric),

('IDRA4-28C', 'GROUPE INTERIEUR 4 SORTIES',
 E'Unité intérieure de condensation à eau invisible multisplit DC INVERTER FROID SEULEMENT.\nPuissance frigorifique 28 000 BTU/h (8 200 Watt).\nRéfrigérant R32. Raccords frigo diam. gas 4 x 1/4" - 3/8".\nRaccordement eau 1/2".\nAlimentation monophasée V/Ph/Hz 220-240/1/50.\nDimensions 500 x 300 x 750 mm.\nPossibilité de connecter maximum 4 unités intérieures.',
 'groupe_eau', 'fourniture', 'U',
 8.20, null, null, 'R32', true, false, false, 4460.00, 1.600, 7137.00),

('DUCT-18', 'UNITE GAINABLE',
 E'Gainable.\nPuissance frigorifique 17 700 BTU/h (5 200 Watt).\nPuissance calorifique 14 000 BTU/h (4 100 Watt). Pression max 50 P.\nAlimentation monophasée V/Ph/Hz 220-240/1/50.\nLiaisons frigo diam. 1/4"-3/8".\nCommande murale standard.',
 'gainable', 'fourniture', 'U',
 5.20, null, null, 'R32', true, false, false, 645.00, 1.605, 1035.00),

('SKIV-07', 'UNITE MURALE INTERIEURE',
 E'Unité intérieure murale DC inverter.\nPuissance frigorifique 7 500 BTU/h (2 000 Watt).\nPuissance calorifique 7 800 BTU/h (2 100 Watt).\nAlimentation monophasée V/Ph/Hz 220-240/1/50.\nTélécommande standard.\nLiaisons frigo diam. 1/4" - 3/8".\nWi-Fi Ready.',
 'mono_split', 'fourniture', 'U',
 2.00, null, null, 'R32', true, false, false, 240.00, 1.604, 385.00),

('SKIV-12', 'UNITE MURALE INTERIEURE',
 E'Unité intérieure murale DC inverter.\nPuissance frigorifique 12 000 BTU/h (3 500 Watt).\nPuissance calorifique 12 500 BTU/h (3 650 Watt).\nAlimentation monophasée V/Ph/Hz 220-240/1/50.\nTélécommande standard.\nLiaisons frigo diam. 1/4" - 3/8".\nWi-Fi Ready.',
 'mono_split', 'fourniture', 'U',
 3.50, null, null, 'R32', true, false, false, 265.00, 1.604, 425.00),

-- Air/air réversible : références de DÉMONSTRATION du taux à 5,5 %.
-- Caractéristiques plausibles mais NON vérifiées sur fiche constructeur.
-- À remplacer par les vraies marques que pose Fabrice.
('DEMO-MONO-25', '[À VÉRIFIER] Mono-split mural réversible 2,5 kW',
 E'Unité murale réversible DC inverter, 2 500 W froid / 3 200 W chaud.\nClasse A+++ froid, A++ chaud. R32. Pilotage Wi-Fi intégré.\nRÉFÉRENCE DE DÉMONSTRATION — à remplacer.',
 'mono_split', 'fourniture', 'U',
 2.50, 'A+++', 'A++', 'R32', true, true, true, 805.00, 1.602, 1290.00),

('DEMO-MULTI-70', '[À VÉRIFIER] Multi-split réversible 7 kW, 3 sorties',
 E'Groupe extérieur réversible DC inverter, 7 000 W froid.\nClasse A+ froid et chaud. R32. Pilotage Wi-Fi intégré.\nRÉFÉRENCE DE DÉMONSTRATION — à remplacer.',
 'multi_split', 'fourniture', 'U',
 7.00, 'A+', 'A+', 'R32', true, true, true, 1745.00, 1.603, 2797.00),

('DEMO-MONO-14KW', '[À VÉRIFIER] Split réversible 14 kW',
 E'Au-delà du seuil de 12 kW : sert à vérifier que le moteur refuse bien le 5,5 %\net affiche la raison du refus.',
 'mono_split', 'fourniture', 'U',
 14.00, 'A++', 'A+', 'R32', true, true, true, 2430.00, 1.600, 3888.00)

) as p(reference, designation, description, famille, nature, unite,
       puissance_kw, classe_froid, classe_chaud, fluide, fixe, reversible, connecte,
       prix_achat_ht, coefficient, prix_vente_ht)
on conflict (entreprise_id, reference) do nothing;

-- Accessoires, plomberie, électricité et main-d'œuvre
insert into produit
(entreprise_id, reference, designation, description, famille, nature, unite,
 prix_achat_ht, coefficient, prix_vente_ht)
select (select id from ent), * from (values

('PLENUM-2S', 'PLENUM 2 SORTIES - ACCESSOIRES DE POSE ET DE SOUFFLAGE',
 E'KIT DUCT - DBIS-DIFF - Plénum de sortie et reprise - 3 grilles standard.',
 'accessoire', 'fourniture', 'u', 580.00::numeric, 1.601::numeric, 928.60::numeric),

('ALLURESILENT20W', 'POMPE DE RELEVAGE DE CONDENSAT',
 E'Pompe de relevage de condensat de PAC Air / Air en goulotte.\nALLURESILENT20WATER Altech.',
 'accessoire', 'fourniture', 'u', 97.00, 1.608, 156.00),

('FOURN-FROID', 'FOURNITURES FROID',
 E'Câbles électriques divers, répartiteur frigorifique, liaisons frigorifiques,\névacuations des condensats, fixations, goulottes, supports unités,\nsupports groupes, percements, petite visserie.',
 'fourniture', 'fourniture', 'U', 235.00, 1.617, 380.00),

('KIT-AWHAM', 'KIT AWHAM - Kit anti coup de bélier',
 null, 'plomberie', 'fourniture', 'u', 55.00, 1.618, 89.00),

('RID-PR', 'RID-PR - Réducteur de pression d''eau avec manomètre intégré',
 null, 'plomberie', 'fourniture', 'u', 68.00, 1.603, 109.00),

('VALSIC', 'VALSIC - Clapet anti-retour',
 null, 'plomberie', 'fourniture', 'u', 64.00, 1.609, 103.00),

('PLOMB-INTEG', 'PLOMBERIE CLIMATISATION - INTEGRATION DU GROUPE',
 E'En reprise de l''alimentation :\n - Réalisation d''une alimentation avec vanne d''arrêt\n - Pose de l''anti-retour, de l''anti-bélier, du réducteur de pression et étalonnage\nEn reprise sur l''évacuation :\n - Reprise avec manchette à visser en 3/4 pour raccorder un flexible d''évacuation et les condensats.',
 'plomberie', 'pose', 'Forfait', null, null, 350.00),

('ELEC-ALIM', 'ELECTRICITE CLIMATISATION - ALIMENTATION GROUPE',
 E'Depuis l''armoire électrique, fourniture et passage de faisceau 3x2.5² Courbe D.\nFourniture et pose de disjoncteur dédié et disjoncteur différentiel dédié.',
 'electricite', 'pose', 'Forfait', null, null, 220.00),

('POSE-CLIM', 'FORFAIT POSE DE CLIMATISATION',
 E'Forfait pose comprenant :\nLa pose des unités intérieures\nLa pose du groupe (sans caisson)\nLa pose des goulottes\nLes percements en traversée de cloison et passage en comble si possible.\nPose réalisée dans les règles de l''art.\nLa mise en route par entreprise agréée.\n\n - SPECIFICITES CHANTIER -\n[à dicter sur place]\n\n - GENERALITES -\nLes passages de fluides et autres sont réalisés au plus judicieux.\nLes passages dans les faux plafonds et cloisons sont en option si non indiqués dans les spécificités chantier.\nCertains travaux induits resteront à faire s''ils ne sont pas prévus au devis.',
 'pose', 'pose', 'Forfait', null, null, 4850.00),

('ISOL-PHON', 'ISOLATION PHONIQUE GROUPE',
 E'Doublage laine de tissu acoustique du plafond et des cloisons périphériques.\nCertaines fréquences et certains bruits, notamment d''écoulement, pourront encore être entendus.',
 'phonique', 'pose', 'Forfait', null, null, 260.00),

('CAISSON-PHON', 'CAISSON PHONIQUE GROUPE',
 E'Caisson phonique autour du groupe pour atténuer les bruits de fonctionnement,\nau moyen de panneaux MDF assemblés, mise en teinte.\nSi possible doublage laine de tissu acoustique.',
 'phonique', 'pose', 'Forfait', null, null, 350.00),

('LOGISTIQUE', 'MISE EN PLACE - TENUE - REPLI',
 E'Mise en place chantier, fourniture et pose des protections appropriées,\ncoltinage de l''outillage et du matériel.',
 'logistique', 'pose', 'Forfait', null, null, 600.00)

) as p(reference, designation, description, famille, nature, unite,
       prix_achat_ht, coefficient, prix_vente_ht)
on conflict (entreprise_id, reference) do nothing;

-- 3. Gabarits de zone --------------------------------------------------------
-- L'ossature exacte des devis actuels. C'est ce qui fait tomber un devis
-- de six pages à vingt minutes.

insert into gabarit (entreprise_id, nom, description, position, sous_lots)
select (select id from ent), * from (values

('Zone climatisation complète',
 'Ossature d''une zone telle qu''elle apparaît sur les devis Pilotech : condensation, soufflage, relevage, fournitures froid, plomberie, électricité, pose, phonique.',
 1,
 '[
   {"titre":"UNITÉS DE CONDENSATION","lignes":[{"reference":"IDRA4-28C","quantite":1}]},
   {"titre":"UNITÉS DE SOUFFLAGE","lignes":[{"reference":"SKIV-07","quantite":3}]},
   {"titre":"POMPES DE RELEVAGE - SI NÉCESSAIRE","lignes":[{"reference":"ALLURESILENT20W","quantite":3}]},
   {"titre":"FOURNITURES FROID","lignes":[{"reference":"FOURN-FROID","quantite":3}]},
   {"titre":"PLOMBERIE EAU - Fourniture et pose","lignes":[
     {"reference":"KIT-AWHAM","quantite":1},
     {"reference":"RID-PR","quantite":1},
     {"reference":"VALSIC","quantite":1},
     {"reference":"PLOMB-INTEG","quantite":1}]},
   {"titre":"ÉLECTRICITÉ","lignes":[{"reference":"ELEC-ALIM","quantite":1}]},
   {"titre":"POSE DE CLIMATISATION","lignes":[{"reference":"POSE-CLIM","quantite":1}]},
   {"titre":"ISOLATION PHONIQUE DU GROUPE","lignes":[{"reference":"ISOL-PHON","quantite":1}]}
 ]'::jsonb),

('Zone air/air réversible',
 'Installation split réversible éligible au taux de 5,5 %. Références de démonstration à remplacer.',
 2,
 '[
   {"titre":"UNITÉS INTÉRIEURES","lignes":[{"reference":"DEMO-MONO-25","quantite":1}]},
   {"titre":"FOURNITURES FROID","lignes":[{"reference":"FOURN-FROID","quantite":1}]},
   {"titre":"ÉLECTRICITÉ","lignes":[{"reference":"ELEC-ALIM","quantite":1}]},
   {"titre":"POSE DE CLIMATISATION","lignes":[{"reference":"POSE-CLIM","quantite":1}]}
 ]'::jsonb),

('Finitions et logistique',
 'Lot de clôture commun à tous les chantiers.',
 3,
 '[
   {"titre":"COFFRAGE PHONIQUE","lignes":[{"reference":"CAISSON-PHON","quantite":1}]},
   {"titre":"MISE EN PLACE - TENUE - REPLI","lignes":[{"reference":"LOGISTIQUE","quantite":1}]}
 ]'::jsonb)

) as g(nom, description, position, sous_lots)
where not exists (select 1 from gabarit);

-- 4. Un client de test -------------------------------------------------------

insert into tiers (entreprise_id, type, categorie, nom, adresse, code_postal, ville)
select (select id from ent), 'particulier', 'client',
       'Aymerick Chastenet de Gery', '85 Rue Montmartre', '75002', 'Paris'
where not exists (select 1 from tiers where nom = 'Aymerick Chastenet de Gery');

insert into site (entreprise_id, tiers_id, adresse, code_postal, ville,
                  usage_local, annee_achevement, en_copropriete, notes)
select (select id from ent), t.id, '85 Rue Montmartre', '75002', 'Paris',
       'habitation', 1880, true,
       'Le comptage de l''eau doit être individuel afin d''éviter les problèmes de répartition avec les autres copropriétaires.'
from tiers t
where t.nom = 'Aymerick Chastenet de Gery'
  and not exists (select 1 from site where adresse = '85 Rue Montmartre');

-- 5. Vérification ------------------------------------------------------------

select
  (select count(*) from membre)   as membres,
  (select count(*) from produit)  as references_catalogue,
  (select count(*) from gabarit)  as gabarits,
  (select count(*) from tiers)    as clients,
  (select code_invitation from entreprise order by created_at limit 1) as code_invitation;
