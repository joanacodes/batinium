// =============================================================================
// BATINIUM — Webhook Allo
//
// Déploiement :
//   npx supabase functions deploy allo-webhook --no-verify-jwt
//   npx supabase secrets set ALLO_SECRET=... ENTREPRISE_ID=...   (facultatif)
//
// Depuis le SQL 30, ces deux variables ne sont plus nécessaires : le jeton
// vient de la table `connecteur` et il désigne l'entreprise à lui seul. Elles
// restent acceptées le temps que les installations existantes basculent.
//
// Puis, côté Allo, pointez le webhook sur :
//   https://<projet>.supabase.co/functions/v1/allo-webhook?cle=<ALLO_SECRET>
//
// Chaque appel devient une demande, rattachée au client si son numéro est connu.
// L'insertion est idempotente : Allo rejoue ses webhooks, on ne veut pas de doublons.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLO_SECRET = Deno.env.get('ALLO_SECRET') ?? '';
const ENTREPRISE_ID = Deno.env.get('ENTREPRISE_ID') ?? '';

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Normalise un numéro français pour pouvoir le rapprocher d'une fiche client. */
function normaliser(tel: string | null | undefined): string | null {
  if (!tel) return null;
  const n = tel.replace(/[^0-9+]/g, '');
  if (n.startsWith('+33')) return '0' + n.slice(3);
  if (n.startsWith('33') && n.length === 11) return '0' + n.slice(2);
  return n;
}

/** Déduit l'urgence du contenu de l'appel. Grossier mais utile pour trier. */
function urgence(texte: string): 'panne' | 'saison' | 'projet' {
  const t = texte.toLowerCase();
  if (/panne|fuite|ne fonctionne|en rade|urgent|plus de froid|hs\b/.test(t)) return 'panne';
  if (/canicule|chaleur|rapidement|au plus vite|cette semaine/.test(t)) return 'saison';
  return 'projet';
}

/**
 * Trace de vie : c'est elle qui prouve, dans l'application, que le branchement
 * fonctionne. Une configuration ne se déduit pas, elle se constate.
 */
async function marquerVu(entreprise: string, message: string): Promise<void> {
  await db.from('connecteur')
    .update({ vu_le: new Date().toISOString(), dernier_message: message })
    .eq('cle', 'allo').eq('entreprise_id', entreprise);
}

const adresseAction = (req: Request) =>
  new URL(req.url).searchParams.get('action');

async function installerChezAllo(req: Request): Promise<Response> {
  try {
    const jetonUtilisateur = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!jetonUtilisateur) return new Response('Authentification requise', { status: 401, headers: CORS });

    const { data: utilisateur } = await db.auth.getUser(jetonUtilisateur);
    if (!utilisateur?.user) return new Response('Session invalide', { status: 401, headers: CORS });

    const { data: membre } = await db.from('membre')
      .select('id, entreprise_id, role').eq('user_id', utilisateur.user.id)
      .eq('actif', true).maybeSingle();
    if (!membre || membre.role !== 'direction') {
      return new Response('Réservé à la direction', { status: 403, headers: CORS });
    }

    const { cle_api, url } = await req.json();
    if (!cle_api || !url) {
      return new Response(JSON.stringify({ erreur: 'Clé d’API Allô et adresse requises.' }),
        { status: 400, headers: CORS });
    }

    /*
     * Le format d'authentification d'Allô est `Authorization: Api-Key ak_live_…`.
     * Leur page « intégrations » montre encore l'ancien format v1, la clé
     * brute — c'est ce que j'avais suivi, d'où un 401 qui ressemblait à un
     * problème de droits alors que c'était un problème de préfixe.
     *
     * Leurs chemins ne sont pas non plus tous d'accord entre eux : le guide
     * d'authentification dit `/v2/api/…`, la page webhooks dit `/v2/…`. On
     * essaie les combinaisons plausibles plutôt que de parier, et on rapporte
     * le message exact d'Allô si aucune ne passe.
     */
    const entetes = (forme: 'prefixe' | 'brut') => ({
      Authorization: forme === 'prefixe' ? `Api-Key ${cle_api}` : String(cle_api),
      'Content-Type': 'application/json',
    });

    // D'abord vérifier la clé : /me rend ses droits, ce qui permet de dire
    // « clé invalide » ou « clé valide sans le bon droit » au lieu d'un 401 nu.
    let auth: 'prefixe' | 'brut' | null = null;
    let scopes: string[] = [];
    let messageAllo = '';

    for (const forme of ['prefixe', 'brut'] as const) {
      const me = await fetch('https://api.withallo.com/v2/api/me', { headers: entetes(forme) });
      if (me.ok) {
        const d = await me.json().catch(() => ({}));
        auth = forme;
        scopes = d?.data?.scopes ?? [];
        break;
      }
      const d = await me.json().catch(() => ({}));
      messageAllo = d?.error?.message ?? d?.message ?? `réponse ${me.status}`;
    }

    if (!auth) {
      return new Response(JSON.stringify({
        erreur: `Allô ne reconnaît pas cette clé. ${messageAllo} `
          + 'Vérifiez qu’elle a été copiée en entier — elle commence par ak_live_ — et '
          + 'qu’elle n’a pas été révoquée.',
      }), { status: 400, headers: CORS });
    }

    if (scopes.length && !scopes.includes('WEBHOOKS_READ_WRITE')) {
      return new Response(JSON.stringify({
        erreur: 'La clé est valide, mais il lui manque le droit WEBHOOKS_READ_WRITE. '
          + `Elle porte : ${scopes.join(', ') || 'aucun droit'}. Créez-en une autre dans `
          + 'Allô, Réglages → API, en cochant ce droit.',
      }), { status: 400, headers: CORS });
    }

    // La clé est bonne. On crée l'abonnement, en essayant les deux chemins.
    const corps = JSON.stringify({
      url,
      // On ne demande que ce qu'on sait traiter. S'abonner à tout ferait
      // arriver huit événements par appel, dont sept à jeter.
      topics: ['call.completed', 'sms.received'],
    });

    let reponse: Record<string, unknown> = {};
    let cree = false;
    for (const chemin of ['/v2/api/webhooks', '/v2/webhooks']) {
      const r = await fetch(`https://api.withallo.com${chemin}`, {
        method: 'POST', headers: entetes(auth), body: corps,
      });
      reponse = await r.json().catch(() => ({}));
      if (r.ok) { cree = true; break; }
      messageAllo = (reponse as { error?: { message?: string }; message?: string })
        ?.error?.message
        ?? (reponse as { message?: string })?.message
        ?? `réponse ${r.status}`;
    }

    if (!cree) {
      return new Response(JSON.stringify({
        erreur: `Allô a refusé la création : ${messageAllo}`,
        detail: reponse,
      }), { status: 400, headers: CORS });
    }

    await db.from('connecteur')
      .update({
        vu_le: new Date().toISOString(),
        dernier_message: 'Adresse déclarée chez Allô depuis Batinium.',
        config: {
          allo_webhook_id: (reponse as { id?: string; data?: { id?: string } })?.id
            ?? (reponse as { data?: { id?: string } })?.data?.id ?? null,
        },
      })
      .eq('cle', 'allo').eq('entreprise_id', membre.entreprise_id);

    return new Response(JSON.stringify({ ok: true, webhook: reponse }),
      { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ erreur: (e as Error).message }),
      { status: 500, headers: CORS });
  }
}

async function relayerAudio(req: Request): Promise<Response> {
  try {
    const jetonUtilisateur = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!jetonUtilisateur) return new Response('Authentification requise', { status: 401, headers: CORS });

    const { data: utilisateur } = await db.auth.getUser(jetonUtilisateur);
    if (!utilisateur?.user) return new Response('Session invalide', { status: 401, headers: CORS });

    const { data: membre } = await db.from('membre')
      .select('entreprise_id').eq('user_id', utilisateur.user.id).eq('actif', true).maybeSingle();
    if (!membre) return new Response('Aucune entreprise', { status: 403, headers: CORS });

    const { demande_id } = await req.json();

    // On relit l'adresse en base plutôt que de l'accepter du navigateur :
    // sinon la fonction devient un relais ouvert vers n'importe quelle URL.
    const { data: demande } = await db.from('demande')
      .select('enregistrement_url')
      .eq('id', demande_id).eq('entreprise_id', membre.entreprise_id).maybeSingle();

    const adresse = demande?.enregistrement_url;
    if (!adresse) {
      return new Response(JSON.stringify({ erreur: 'Aucun enregistrement pour cet appel.' }),
        { status: 404, headers: CORS });
    }

    const { data: secret } = await db.from('connecteur_secret')
      .select('valeur').eq('entreprise_id', membre.entreprise_id)
      .eq('cle', 'allo_api').maybeSingle();

    // Avec la clé si on l'a, sans elle sinon : certaines adresses sont
    // publiques et signées, il n'y a pas de raison d'exiger la clé pour
    // celles-là.
    const entetes: Record<string, string> = {};
    if (secret?.valeur) entetes.Authorization = `Api-Key ${secret.valeur}`;

    let r = await fetch(adresse, { headers: entetes });
    if (!r.ok && secret?.valeur) r = await fetch(adresse);   // deuxième essai, sans clé

    if (!r.ok) {
      return new Response(JSON.stringify({
        erreur: `Allô a répondu ${r.status} pour cet enregistrement.`
          + (secret?.valeur ? '' : ' Aucune clé d’API enregistrée : ajoutez-la dans '
            + 'Connexions, carte Allô, pour que Batinium puisse aller le chercher.'),
      }), { status: 502, headers: CORS });
    }

    return new Response(r.body, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': r.headers.get('content-type') ?? 'audio/mpeg',
        'Cache-Control': 'private, max-age=600',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ erreur: (e as Error).message }),
      { status: 500, headers: CORS });
  }
}

interface AppelAllo {
  id?: string;
  call_id?: string;
  callId?: string;
  uuid?: string;
  reference?: string;
  event_id?: string;
  direction?: string;
  status?: string;
  from?: string;
  from_number?: string;
  to?: string;
  type?: string;
  result?: string;
  transcription?: string;
  recording_url?: string;
  caller_name?: string;
  duration?: number;
  summary?: string;
  transcript?: string;
  recording_url?: string;
  created_at?: string;
  [k: string]: unknown;
}

/**
 * Contrôle de santé.
 *
 * Un GET répond « je suis là », sans clé, sans rien écrire. C'est le seul
 * moyen pour l'application de savoir si la fonction est déployée : compter les
 * demandes portant la source « allo » ne prouve rien, elles peuvent venir d'un
 * jeu de démonstration ou d'une saisie à la main.
 *
 * Les en-têtes CORS sont indispensables ici : sans eux le navigateur refuse de
 * lire la réponse, et une fonction bien déployée passerait pour absente.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  // Sans cette ligne, un POST venant d'un navigateur échoue à la vérification
  // préalable, et l'erreur affichée est « Failed to fetch » — qui ne dit rien
  // de la cause. Un GET passait, parce qu'il n'est pas soumis à cette
  // vérification : d'où un test navigateur au vert et un bouton en échec.
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-batinium-cle',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method === 'GET') {
    return new Response(JSON.stringify({
      deployee: true,
      secret: Boolean(ALLO_SECRET),
      // Le réglage se fait maintenant en base : ces variables ne conditionnent
      // plus rien, on les rapporte seulement pour les anciennes installations.
      entreprise: true,
      variables_héritées: Boolean(ALLO_SECRET && ENTREPRISE_ID),
    }), { headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response('Méthode non autorisée', { status: 405, headers: CORS });
  }

  /*
   * Installation du webhook chez Allô, depuis Batinium.
   *
   * Créer l'abonnement à la main dans leur interface s'est révélé être le
   * point de blocage : « échec de la création de l'endpoint », sans plus. Or
   * Allô offre une API pour le faire, et un appel serveur à serveur évite à la
   * fois le formulaire et les refus du navigateur.
   *
   * L'appelant doit prouver qu'il est direction dans Batinium : cette branche
   * n'est pas protégée par la plateforme, la fonction étant déployée sans
   * vérification de jeton pour qu'Allô puisse l'appeler.
   */
  if (adresseAction(req) === 'installer') {
    return await installerChezAllo(req);
  }

  /*
   * Relais de l'enregistrement.
   *
   * L'adresse rendue par Allô ne se lit pas depuis un navigateur : elle est
   * soit protégée, soit refusée par la politique d'origine. Le lecteur
   * affichait donc 0:00 sans un mot, et renvoyer vers un autre onglet
   * n'était pas une réponse — juste un aveu.
   *
   * Le serveur va donc chercher le fichier avec la clé d'API de l'entreprise
   * et le rend au navigateur. Rien n'est stocké : les octets traversent, ils
   * ne se posent pas.
   */
  if (adresseAction(req) === 'audio') {
    return await relayerAudio(req);
  }

  // Le jeton de l'URL désigne l'entreprise à lui seul : il est unique sur
  // toute la base. Plus besoin d'un ENTREPRISE_ID en variable d'environnement,
  // qui rendait ce webhook mono-entreprise, ni d'un secret posé au terminal.
  // Trois chemins pour le même jeton, parce que les plateformes ne
  // s'accordent pas. Beaucoup refusent un paramètre dans l'URL d'un webhook —
  // n'en proposer qu'un seul, c'était supposer que tout le monde accepte le
  // nôtre.
  //
  //   ?cle=JETON                       le plus courant
  //   /allo-webhook/JETON              quand les paramètres sont refusés
  //   en-tête x-batinium-cle: JETON    quand la plateforme sait en poser
  const adresse = new URL(req.url);
  const dernierSegment = adresse.pathname.split('/').filter(Boolean).pop() ?? '';
  const cle = adresse.searchParams.get('cle')
    ?? req.headers.get('x-batinium-cle')
    ?? (dernierSegment !== 'allo-webhook' ? dernierSegment : null);

  if (!cle) {
    return new Response(
      'Jeton absent. L’adresse doit contenir votre jeton, soit après ?cle=, soit à la '
      + 'fin du chemin. Recopiez-la depuis Batinium, Connexions, carte Allô.',
      { status: 401, headers: CORS });
  }

  const { data: connecteur } = await db.from('connecteur')
    .select('entreprise_id, actif')
    .eq('cle', 'allo').eq('jeton', cle).maybeSingle();

  // On accepte encore l'ancien couple de variables d'environnement, le temps
  // que les installations existantes basculent.
  let entreprise: string | null = connecteur?.actif ? connecteur.entreprise_id : null;
  if (!entreprise && ALLO_SECRET && cle === ALLO_SECRET && ENTREPRISE_ID) {
    entreprise = ENTREPRISE_ID;
  }
  if (!entreprise) {
    return new Response(
      'Jeton inconnu ou désactivé. Si vous avez cliqué « Remplacer l’adresse » dans '
      + 'Batinium, l’ancienne ne fonctionne plus : recopiez la nouvelle ici.',
      { status: 401, headers: CORS });
  }

  // Un corps vide n'est pas une erreur : c'est le bouton « Tester » du
  // prestataire. Le refuser affichait « échec » chez Allô alors que le jeton
  // était bon et la fonction jointe — le pire des diagnostics, celui qui
  // désigne le mauvais coupable.
  let enveloppe: Record<string, unknown> = {};
  try {
    enveloppe = (await req.json()) ?? {};
  } catch {
    enveloppe = {};
  }

  /*
   * Allô n'envoie pas les champs à plat, contrairement à ce que supposait la
   * première version de ce fichier. Tout arrive dans une enveloppe :
   *
   *   { "topic": "call.completed", "version": "2.0",
   *     "timestamp": "…", "data": { … } }
   *
   * Sans déballage, la fonction aurait répondu 200 à chaque appel et
   * n'aurait rien enregistré — une panne muette, la pire espèce.
   */
  const topic = String(enveloppe.topic ?? '');
  const appel = (enveloppe.data ?? enveloppe) as AppelAllo;

  // On ne retient que la fin d'appel : c'est le seul événement qui porte
  // l'enregistrement, la transcription et le résumé. Les autres — sonnerie,
  // décroché, étiquette — arriveraient en double pour un même appel.
  const RETENUS = ['call.completed', 'sms.received'];
  if (topic && !RETENUS.includes(topic)) {
    await marquerVu(entreprise, `Événement ${topic} ignoré.`);
    return new Response(JSON.stringify({ ok: true, ignore: topic }),
      { status: 200, headers: CORS });
  }

  // `webhook-id` sert à dédoublonner : Allô garantit une livraison « au moins
  // une fois » et rejoue jusqu'à huit fois en cas d'échec. Sans lui, un appel
  // pourrait donner trois demandes.
  const reference = req.headers.get('webhook-id')
    ?? appel.id ?? appel.call_id ?? appel.callId ?? appel.uuid
    ?? appel.reference ?? appel.event_id;

  if (!reference) {
    // On note quand même le passage : une requête reçue prouve que le
    // branchement fonctionne, et c'est ce que l'écran doit pouvoir dire.
    await marquerVu(entreprise, 'Requête de test reçue, sans identifiant d’appel.');

    return new Response(JSON.stringify({
      ok: true,
      test: true,
      message: 'Connexion établie. Aucun identifiant d’appel dans ce message : '
        + 'rien n’a été enregistré, ce qui est normal pour un test.',
    }), { status: 200, headers: CORS });
  }

  // Les noms réels du catalogue d'événements d'Allô. Les anciens sont gardés
  // en repli : ils ne coûtent rien et couvrent un changement de format.
  const telephone = normaliser(appel.from_number ?? appel.from);
  const resume = appel.summary ?? '';
  const transcription = appel.transcript ?? appel.transcription ?? '';

  // `result` vaut ANSWERED, NO_ANSWER, BUSY, FAILED… Un appel entrant non
  // décroché est précisément celui qu'il ne faut pas laisser filer.
  const resultat = String(appel.result ?? appel.status ?? '').toUpperCase();
  const manque = ['NO_ANSWER', 'MISSED', 'BUSY', 'FAILED', 'NO-ANSWER'].includes(resultat);
  const entrant = String(appel.type ?? appel.direction ?? 'INBOUND').toUpperCase() !== 'OUTBOUND';

  // Un appel sortant n'est pas une demande entrante : le noter en créerait une
  // pour chaque coup de fil passé par Fabrice.
  if (topic === 'call.completed' && !entrant) {
    await marquerVu(entreprise, 'Appel sortant ignoré.');
    return new Response(JSON.stringify({ ok: true, ignore: 'appel sortant' }),
      { status: 200, headers: CORS });
  }

  // Rattachement au client existant, par numéro
  let tiersId: string | null = null;
  if (telephone) {
    const { data } = await db.from('tiers').select('id')
      .eq('entreprise_id', entreprise).eq('telephone', telephone).limit(1).maybeSingle();
    tiersId = data?.id ?? null;
  }

  // La demande. `upsert` sur (entreprise_id, source, source_ref) rend l'appel idempotent.
  const { data: demande, error } = await db.from('demande').upsert({
    entreprise_id: entreprise,
    source: 'allo',
    source_ref: reference,
    recu_le: appel.created_at ?? new Date().toISOString(),
    nom: appel.caller_name ?? null,
    telephone,
    besoin: resume.slice(0, 200) || (manque ? 'Appel manqué' : 'Appel reçu'),
    resume,
    transcription,
    enregistrement_url: appel.recording_url ?? null,
    duree_secondes: appel.duration ?? null,
    urgence: urgence(`${resume} ${transcription}`),
    statut: manque ? 'a_rappeler' : 'nouvelle',
    repondu: false,
    tiers_id: tiersId,
  }, { onConflict: 'entreprise_id,source,source_ref' }).select('id').single();

  if (error) {
    console.error('Insertion de la demande impossible', error);
    return new Response(JSON.stringify({ erreur: error.message }), { status: 500 });
  }

  // Le fil du client, pour retrouver qui a appelé quand
  await db.from('fil').upsert({
    entreprise_id: entreprise,
    tiers_id: tiersId,
    demande_id: demande.id,
    type: manque ? 'appel_manque' : 'appel_entrant',
    sujet: resume.slice(0, 200) || (manque ? 'Appel manqué' : 'Appel reçu'),
    contenu: transcription || null,
    source: 'allo',
    source_ref: reference,
    a_traiter: true,
    occurred_at: appel.created_at ?? new Date().toISOString(),
    metadonnees: { duree: appel.duration ?? null, enregistrement: appel.recording_url ?? null },
  }, { onConflict: 'entreprise_id,source,source_ref' });

  await marquerVu(entreprise, `${topic || 'appel'} — ${reference}`);

  return new Response(JSON.stringify({ ok: true, demande: demande.id }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
