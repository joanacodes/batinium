// =============================================================================
// BATINIUM — Passerelle IA
//
// Déploiement :
//   npx supabase functions deploy ia
//   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Contrairement au webhook Allô, celle-ci exige un jeton : elle se déploie
// SANS --no-verify-jwt. Un appelant anonyme n'a rien à faire ici — la clé
// derrière est facturée à l'entreprise.
//
// -----------------------------------------------------------------------------
// L'ARCHITECTURE, EN CINQ RÈGLES
//
// 1. La clé ne quitte jamais le serveur. Tout ce que le navigateur charge est
//    lisible par qui ouvre les outils de développement ; une clé extraite se
//    facture à Pilotech jusqu'à ce qu'on s'en aperçoive.
//
// 2. Le modèle ne reçoit que des tâches d'une liste fermée. Pas de « fais ce
//    que dit l'utilisateur » : chaque tâche a sa consigne, son format de
//    sortie et sa taille maximale, écrits ici. Un champ de texte libre relayé
//    tel quel serait une porte ouverte à l'injection d'instructions.
//
// 3. Le modèle n'écrit rien dans la base. Il rend des données structurées,
//    l'application les affiche, un humain décide. C'est le même principe que
//    les brouillons du catalogue, et pour la même raison : une lecture
//    automatique se trompe, et une erreur qui s'écrit toute seule dans une
//    base de gestion ne se rattrape pas.
//
// 4. Chaque appel est journalisé : qui, quand, quelle tâche, combien de
//    jetons. Sans compteur, on découvre le coût sur la facture du mois.
//
// 5. Le contenu envoyé s'efface au bout de quelques semaines, la trace reste.
//    Un devis dicté contient des données personnelles.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

/**
 * La clé de l'entreprise, posée depuis l'application.
 *
 * Elle est lue avec la clé de service, qui contourne la RLS — c'est le seul
 * chemin possible, puisque la table qui la porte n'a aucune politique de
 * lecture. Une clé posée à l'écran ne se relit jamais depuis le navigateur.
 *
 * La variable d'environnement reste acceptée : elle sert de repli et permet
 * aux installations existantes de continuer sans rien changer.
 */
async function cleDe(entrepriseId: string): Promise<string> {
  const { data } = await db.from('connecteur_secret')
    .select('valeur').eq('entreprise_id', entrepriseId).eq('cle', 'anthropic').maybeSingle();
  return data?.valeur || ANTHROPIC_KEY;
}
const MODELE = Deno.env.get('IA_MODELE') ?? 'claude-sonnet-4-6';

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const entetes = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Content-Type': 'application/json',
};

/**
 * Les tâches permises. En ajouter une est un acte délibéré : on écrit sa
 * consigne, son format de sortie et sa limite de taille, ici, en connaissance
 * de cause. C'est tout l'intérêt de la liste fermée.
 */
const TACHES: Record<string, { consigne: string; maxEntree: number; maxSortie: number }> = {
  catalogue: {
    maxEntree: 40_000,
    maxSortie: 4_000,
    consigne: `Tu extrais des références de matériel depuis un devis ou un tarif fournisseur
du bâtiment, en français.

Réponds UNIQUEMENT par un tableau JSON, sans texte autour, sans balises de code.
Chaque élément : {"reference": string|null, "designation": string, "description": string|null,
"unite": string, "prix_achat_ht": number|null, "prix_vente_ht": number|null,
"famille": "mono_split"|"multi_split"|"gainable"|"console"|"cassette"|"groupe_eau"|"accessoire"|"fourniture"|"plomberie"|"electricite"|"pose"|"phonique"|"logistique",
"nature": "fourniture"|"pose"|"deplacement"}

Règles : ignore les totaux, sous-totaux, TVA, acomptes et remises. N'invente aucun prix :
si un prix est absent, mets null. Ne déduis pas un prix d'achat d'un prix de vente.
Si tu hésites sur la famille, mets "fourniture".`,
  },

  devis: {
    maxEntree: 60_000,
    maxSortie: 4_000,
    consigne: `Tu transformes la description dictée d'un chantier de climatisation en lignes
de devis, en français.

On te donne d'abord la dictée, puis le catalogue de l'entreprise sous la forme
RÉFÉRENCE | désignation | unité | prix. Ton travail principal est de reconnaître, dans la
dictée, ce qui correspond à une référence du catalogue.

Réponds UNIQUEMENT par un objet JSON : {"titre": string, "notes": string|null,
"lignes": [{"reference": string|null, "designation": string, "description": string|null,
"quantite": number, "unite": string}]}

Règles :
- Quand une ligne dictée correspond à une référence du catalogue, mets sa RÉFÉRENCE exacte
  dans "reference". L'application ira y chercher le prix, l'unité et le taux de TVA :
  c'est ce qui fait la différence entre un brouillon utilisable et une liste de mots.
- Ne force pas la correspondance. Si le catalogue n'a rien qui convienne, mets null et
  laisse la désignation dictée : une fausse référence coûte plus cher qu'une ligne à
  compléter à la main.
- N'invente aucun prix, aucune marque et aucune référence absente du catalogue.
- Quand une quantité n'est pas dite, mets 1.
- Sépare la fourniture de la pose quand c'est manifeste.
- "notes" reçoit ce qui a été dit et qui n'est pas une ligne : contraintes d'accès, délais,
  remarques du client. Ça ira dans les notes internes du devis.

Tu produis un brouillon que quelqu'un relira : mieux vaut une ligne incomplète qu'une ligne
inventée.`,
  },

  formulaire: {
    maxEntree: 30_000,
    maxSortie: 1_500,
    consigne: `Tu extrais les coordonnées d'une personne depuis un e-mail, en français.

Il s'agit le plus souvent d'un formulaire de site web relayé par un prestataire —
Squarespace, Wix, Typeform — où l'expéditeur du message n'est PAS la personne qui a écrit.
Le vrai nom, le vrai e-mail et le vrai téléphone sont dans le corps.

Réponds UNIQUEMENT par un objet JSON : {"nom": string|null, "email": string|null,
"telephone": string|null, "message": string|null, "adresse": string|null,
"est_formulaire": boolean}

Règles :
- Ignore tout ce qui appartient au prestataire : ses adresses e-mail, son pied de page,
  ses mentions légales, son adresse postale. Une adresse en @squarespace, @wix, @typeform
  n'est jamais celle du prospect.
- "message" reçoit ce que la personne a écrit, sans les étiquettes du formulaire.
- "adresse" n'est renseignée que si une adresse postale de chantier est donnée.
- Un nombre doit avoir au moins neuf chiffres pour être un téléphone. Une surface, une
  année ou un code postal n'en sont pas.
- "est_formulaire" vaut faux si le message est un vrai échange écrit par une personne.
  Dans ce cas, ne remonte que ce qui est explicitement écrit, et laisse le reste à null.
- N'invente rien. Un champ absent vaut null.`,
  },

  resume_appel: {
    maxEntree: 20_000,
    maxSortie: 1_000,
    consigne: `Tu résumes la transcription d'un appel entrant chez un installateur de
climatisation, en français.

Réponds UNIQUEMENT par un objet JSON : {"resume": string, "besoin": string,
"urgence": "panne"|"saison"|"projet", "necessite_visite": boolean, "adresse": string|null}

Règles : le résumé fait deux phrases au plus. N'invente ni adresse ni nom :
si ce n'est pas dit, mets null.`,
  },

  caviardage: {
    maxEntree: 20_000,
    maxSortie: 4_000,
    consigne: `Tu repères les informations qui ne devraient pas sortir de l'entreprise dans
un texte destiné à un client, en français.

Réponds UNIQUEMENT par un objet JSON : {"passages": [{"extrait": string, "motif": string,
"remplacement": string}]}

Cherche : prix d'achat, marges, coefficients, noms de fournisseurs, remises obtenues,
commentaires internes sur le client ou sur un collègue, coordonnées d'un tiers.
Tu ne modifies rien : tu proposes, quelqu'un décide.`,
  },

  assistant: {
    maxEntree: 120_000,
    maxSortie: 3_000,
    consigne: `Tu es l'assistant de Batinium, une application de gestion pour un installateur
de climatisation. Tu réponds en français, brièvement, à des questions sur l'activité.

On te donne un extrait de l'état de l'entreprise au format JSON. Cet extrait a déjà été
filtré selon les droits de la personne qui t'interroge : si une information n'y est pas,
c'est soit qu'elle n'existe pas, soit que cette personne n'a pas le droit de la voir.
Dans les deux cas, dis que tu ne l'as pas. N'invente jamais un chiffre, un nom ou une date
qui ne figure pas dans l'extrait.

Réponds UNIQUEMENT par un objet JSON, sans texte autour, sans balises de code :
{"reponse": string,
 "liens": [{"libelle": string, "url": string}],
 "note": {"cible": "journal"|"devis", "id": string, "texte": string} | null,
 "devis": {"titre": string, "notes": string|null,
           "lignes": [{"reference": string|null, "designation": string,
                       "description": string|null, "quantite": number, "unite": string}]} | null}

Règles :
- "reponse" fait quelques phrases au plus. Donne des nombres exacts quand tu en as.
- "liens" reprend les url fournies dans l'extrait, telles quelles, pour que la personne
  aille voir. Trois au maximum, aucun si la question n'appelle pas de renvoi.
- "note" n'est renseignée QUE si on te demande explicitement d'écrire une note de chantier
  ou une note interne sur un devis. Tu ne proposes jamais d'écrire de toi-même. L'"id" doit
  être celui d'un chantier ou d'un devis présent dans l'extrait.
- "devis" n'est renseigné QUE si on te décrit un chantier à chiffrer : « fais-moi un devis
  pour… », « note un devis : deux splits dans le séjour… ». L'extrait contient alors le
  catalogue : reconnais-y les références dictées et mets la RÉFÉRENCE exacte dans
  "reference", l'application ira chercher le prix. Si rien ne correspond, mets null et
  garde la désignation dictée — une fausse référence coûte plus cher qu'une ligne à
  compléter. N'invente aucun prix. Quand une quantité n'est pas dite, mets 1.
  Ce que tu crées est un brouillon : modifiable, sans client, jamais envoyé ni signé.
- Tu ne peux rien modifier d'autre. Si on te demande de changer un prix, de valider des
  heures ou d'envoyer un courriel, explique que tu lis mais que tu n'écris pas, et donne le
  lien vers la page où le faire.`,
  },

  traduction: {
    maxEntree: 10_000,
    maxSortie: 10_000,
    consigne: `Tu traduis une note de chantier du bâtiment, en conservant le vocabulaire
technique et les unités.

Réponds UNIQUEMENT par un objet JSON : {"langue_source": string, "traduction": string}

Ne reformule pas, ne résume pas, n'ajoute aucun commentaire. Une note de chantier
est un constat : elle doit rester exacte.`,
  },
};

Deno.serve(async (requete) => {
  if (requete.method === 'OPTIONS') return new Response('ok', { headers: entetes });

  const debut = Date.now();
  let membreId: string | null = null;
  let entrepriseId: string | null = null;
  let tache = '';

  try {
    // Règle 5 de la RLS, appliquée ici à la main : on vérifie que l'appelant
    // est bien un membre actif, et on en déduit son entreprise. On ne fait
    // jamais confiance à un entreprise_id envoyé par le navigateur.
    const jeton = requete.headers.get('Authorization')?.replace('Bearer ', '');
    if (!jeton) return erreur(401, 'Authentification requise.');

    const { data: utilisateur } = await db.auth.getUser(jeton);
    if (!utilisateur?.user) return erreur(401, 'Session invalide ou expirée.');

    const { data: membre } = await db.from('membre')
      .select('id, entreprise_id, role')
      .eq('user_id', utilisateur.user.id).eq('actif', true).maybeSingle();
    if (!membre) return erreur(403, 'Vous n’êtes rattaché à aucune entreprise.');

    membreId = membre.id;
    entrepriseId = membre.entreprise_id;
    const ent = membre.entreprise_id as string;

    const corps = await requete.json();
    tache = String(corps.tache ?? '');

    // Contrôle de santé : dit si la fonction est déployée et si la clé est
    // posée, sans appeler le modèle. Un diagnostic qui coûte un appel payant
    // est un diagnostic qu'on n'ose pas relancer.
    if (tache === '__diagnostic__') {
      return new Response(JSON.stringify({
        deployee: true,
        cle: Boolean(await cleDe(ent)),
        modele: MODELE,
        taches: Object.keys(TACHES),
      }), { headers: entetes });
    }
    const definition = TACHES[tache];
    if (!definition) {
      return erreur(400, `Tâche « ${tache} » inconnue. Elle doit être déclarée dans la passerelle.`);
    }

    // Deux formes d'entrée : du texte, ou un fichier encodé en base64. Un PDF
    // et une photo de tarif se lisent directement par le modèle ; les extraire
    // en texte dans le navigateur demanderait des bibliothèques lourdes et
    // rendrait un résultat moins bon.
    const contenu = String(corps.contenu ?? '');
    const fichier = corps.fichier as { media_type?: string; data?: string } | undefined;

    if (!contenu.trim() && !fichier?.data) return erreur(400, 'Contenu vide.');
    if (contenu.length > definition.maxEntree) {
      return erreur(413, `Contenu trop long : ${contenu.length} caractères pour un maximum de `
        + `${definition.maxEntree}. Découpez-le.`);
    }
    if (fichier?.data && fichier.data.length > 14_000_000) {
      return erreur(413, 'Fichier trop lourd : dix mégaoctets au maximum. '
        + 'Pour un PDF long, n’envoyez que les pages du tarif.');
    }

    const bloc: unknown[] = [];
    if (fichier?.data && fichier.media_type) {
      const source = { type: 'base64', media_type: fichier.media_type, data: fichier.data };
      if (fichier.media_type === 'application/pdf') bloc.push({ type: 'document', source });
      else if (fichier.media_type.startsWith('image/')) bloc.push({ type: 'image', source });
      else return erreur(400, `Type de fichier non pris en charge : ${fichier.media_type}. `
        + 'PDF et images seulement ; un tableur s’enregistre en CSV.');
      bloc.push({ type: 'text', text: 'Voici le document à traiter.' });
    } else {
      bloc.push({
        // Le contenu de l'utilisateur est encadré : le modèle sait que ce
        // qui suit est une donnée à traiter, pas une consigne à suivre.
        type: 'text',
        text: `Voici le contenu à traiter.\n\n<contenu>\n${contenu}\n</contenu>`,
      });
    }

    const cle = await cleDe(ent);
    if (!cle) {
      return erreur(400, 'L’assistant n’est pas configuré sur cette installation. '
        + 'Le déployeur doit poser une clé, ou l’entreprise la sienne dans '
        + 'Connexions, carte « Assistant IA ».');
    }

    /*
     * Le plafond mensuel.
     *
     * Une clé partagée sans plafond est une carte de crédit prêtée. Il ne
     * s'agit pas de se méfier : un import mal découpé ou une boucle dans un
     * écran suffisent à faire une facture qu'aucun client n'a voulue.
     *
     * On ne compte pas les appels en erreur : ils n'ont rien consommé.
     * Un plafond négatif vaut « sans limite », pour un client dont on sait
     * qu'il paie à l'usage.
     */
    const { data: usage } = await db.rpc('consommation_ia', { p_entreprise: ent });
    const consomme = Number(usage?.[0]?.jetons ?? 0);
    const plafond = Number(usage?.[0]?.quota ?? 0);

    if (plafond >= 0 && consomme + definition.maxSortie > plafond) {
      return erreur(429,
        `Le plafond du mois est atteint : ${consomme.toLocaleString('fr-FR')} jetons `
        + `sur ${plafond.toLocaleString('fr-FR')}. L’assistant repart le 1er du mois `
        + 'prochain. Pour l’augmenter, parlez-en à votre prestataire.');
    }

    const reponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cle,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: definition.maxSortie,
        system: definition.consigne,
        messages: [{ role: 'user', content: bloc }],
      }),
    });

    const donnees = await reponse.json();
    if (!reponse.ok) {
      throw new Error(donnees?.error?.message ?? `Le modèle a répondu ${reponse.status}.`);
    }

    const texte = (donnees.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n')
      .replace(/```json|```/g, '')
      .trim();

    await journaliser({
      entrepriseId, membreId, tache,
      entree: contenu || `[fichier ${fichier?.media_type}]`, sortie: texte,
      jetonsEntree: donnees.usage?.input_tokens ?? null,
      jetonsSortie: donnees.usage?.output_tokens ?? null,
      duree: Date.now() - debut,
    });

    // On rend le texte brut : c'est l'application qui l'analyse et qui décide
    // quoi en faire. La passerelle ne présume rien du format.
    return new Response(JSON.stringify({ resultat: texte }), { headers: entetes });

  } catch (e) {
    const message = (e as Error).message;
    if (entrepriseId) {
      await journaliser({
        entrepriseId, membreId, tache,
        entree: null, sortie: null,
        jetonsEntree: null, jetonsSortie: null,
        duree: Date.now() - debut, erreur: message,
      });
    }
    return erreur(500, message);
  }
});

function erreur(code: number, message: string): Response {
  return new Response(JSON.stringify({ erreur: message }), { status: code, headers: entetes });
}

/** Le journal est écrit avec la clé de service : le navigateur ne peut pas le falsifier. */
async function journaliser(x: {
  entrepriseId: string; membreId: string | null; tache: string;
  entree: string | null; sortie: string | null;
  jetonsEntree: number | null; jetonsSortie: number | null;
  duree: number; erreur?: string;
}) {
  try {
    await db.from('journal_ia').insert({
      entreprise_id: x.entrepriseId,
      membre_id: x.membreId,
      tache: x.tache || 'inconnue',
      modele: MODELE,
      // Un extrait, pas tout : la trace sert à comprendre, pas à archiver.
      entree_extrait: x.entree?.slice(0, 2000) ?? null,
      sortie_extrait: x.sortie?.slice(0, 2000) ?? null,
      jetons_entree: x.jetonsEntree,
      jetons_sortie: x.jetonsSortie,
      duree_ms: x.duree,
      erreur: x.erreur ?? null,
    });
  } catch { /* un journal qui échoue ne doit pas faire échouer la demande */ }
}
