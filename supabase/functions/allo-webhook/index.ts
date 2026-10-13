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
//
// Le nom de l'appelant ne vient pas avec l'appel : la fonction le demande au
// carnet de contacts d'Allô, avec la clé posée dans Connexions. Celle-ci doit
// porter le droit CRM_READ, en plus de WEBHOOKS_READ_WRITE pour l'installation.
// Le rattachement par numéro s'appuie sur le SQL 34.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLO_SECRET = Deno.env.get('ALLO_SECRET') ?? '';
const ENTREPRISE_ID = Deno.env.get('ENTREPRISE_ID') ?? '';

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/**
 * Normalise un numéro français pour pouvoir le rapprocher d'une fiche client.
 *
 * Même règle, à la lettre, que `normaliser_telephone()` en base (SQL 34). Ici
 * on écrit `demande.telephone`, là-bas on le compare aux fiches : que les deux
 * divergent et un appel ne retrouve plus son client, sans un mot.
 */
function normaliser(tel: string | null | undefined): string | null {
  if (!tel) return null;
  const n = tel.replace(/\(0\)/g, '').replace(/[^0-9+]/g, '');
  if (n.startsWith('+33')) return '0' + n.slice(3);
  if (n.startsWith('0033')) return '0' + n.slice(4);
  if (n.startsWith('33') && n.length === 11) return '0' + n.slice(2);
  return n || null;
}

/** Le format qu'attend l'API d'Allô : +33612345678. */
function versE164(tel: string): string | null {
  const n = normaliser(tel);
  if (!n) return null;
  if (n.startsWith('+')) return n;
  if (/^0[1-9]\d{8}$/.test(n)) return '+33' + n.slice(1);
  return null;
}

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: CORS });

/**
 * Le client qui porte ce numéro, s'il est seul à le porter.
 *
 * La comparaison se fait en base (SQL 34), sur la forme normalisée des deux
 * côtés : la fiche porte le numéro tel qu'on l'a tapé, avec ses espaces, et
 * l'ancienne comparaison exacte ne retrouvait presque jamais personne.
 */
async function tiersDuNumero(entreprise: string, telephone: string): Promise<string | null> {
  const { data, error } = await db.rpc('tiers_par_telephone',
    { p_entreprise: entreprise, p_telephone: telephone });
  if (!error) return (data as string | null) ?? null;

  // SQL 34 pas encore passé : l'ancienne comparaison, qui ne retrouve que les
  // fiches où le numéro a été tapé sans espace. Mieux que rien, en attendant.
  const { data: t } = await db.from('tiers').select('id')
    .eq('entreprise_id', entreprise).eq('telephone', telephone).limit(1).maybeSingle();
  return t?.id ?? null;
}

/** La clé d'API Allô de l'entreprise, posée depuis Connexions. */
async function cleAllo(entreprise: string): Promise<string | null> {
  const { data } = await db.from('connecteur_secret')
    .select('valeur').eq('entreprise_id', entreprise).eq('cle', 'allo_api').maybeSingle();
  return data?.valeur ?? null;
}

/**
 * Un appel à l'API d'Allô avec la clé de l'entreprise.
 *
 * Deux formes d'en-tête, pour la même raison qu'à l'installation : leur
 * documentation montre encore l'ancienne. Un délai borné, parce que le
 * webhook doit répondre à Allô en vingt secondes, recherche comprise.
 */
async function appelerAllo(cle: string, chemin: string, corps: unknown,
                           delaiMs: number): Promise<Response> {
  let r: Response | null = null;
  for (const autorisation of [`Api-Key ${cle}`, cle]) {
    r = await fetch(`https://api.withallo.com${chemin}`, {
      method: corps === undefined ? 'GET' : 'POST',
      headers: { Authorization: autorisation, 'Content-Type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(delaiMs),
    });
    if (r.status !== 401) return r;
  }
  return r!;
}

const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Le nom d'un contact Allô.
 *
 * Leur fiche sépare `name` (le prénom) et `last_name`. Certains contacts
 * importés portent pourtant le nom complet dans `name` : on n'y ajoute pas un
 * nom de famille qu'il contient déjà. Et un contact créé par Allô lui-même,
 * sans nom, porte souvent son numéro à la place : ce n'est pas un nom.
 */
function nomContact(p: Record<string, unknown>): string | null {
  const prenom = texte(p.name ?? p.first_name);
  const famille = texte(p.last_name);
  let complet = !famille ? prenom
    : !prenom ? famille
    : prenom.toLowerCase().includes(famille.toLowerCase()) ? prenom
    : `${prenom} ${famille}`;
  if (!complet && p.company && typeof p.company === 'object') {
    complet = texte((p.company as Record<string, unknown>).name);
  }
  return /\p{L}/u.test(complet) ? complet : null;
}

/** Les personnes d'une réponse de recherche, où que l'API les range. */
function personnes(d: unknown): Record<string, unknown>[] {
  const o = (d ?? {}) as Record<string, unknown>;
  const data = (o.data ?? {}) as Record<string, unknown>;
  for (const c of [data.results, data.people, data.items, o.data, o.results, o.people, o.items]) {
    if (Array.isArray(c)) {
      return c.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
    }
  }
  return [];
}

/** Les numéros d'une fiche contact, chaînes ou objets selon les versions. */
function numerosContact(p: Record<string, unknown>): string[] {
  const brut = p.numbers ?? p.phone_numbers ?? p.phones;
  if (!Array.isArray(brut)) return [];
  return brut.map((n) => {
    if (typeof n === 'string') return n;
    if (!n || typeof n !== 'object') return '';
    const o = n as Record<string, unknown>;
    return texte(o.number ?? o.phone_number ?? o.value ?? o.e164);
  }).filter(Boolean);
}

type Recherche =
  | { statut: 'trouve'; nom: string }
  | { statut: 'absent' }
  | { statut: 'refus' | 'limite' | 'panne'; message: string };

/**
 * Le nom qu'Allô connaît pour ce numéro, dans son carnet de contacts.
 *
 * Il faut à la clé le droit CRM_READ. Le filtre sur le numéro est exact ; on
 * revérifie quand même les numéros rendus, quand il y en a : mieux vaut
 * « sans nom » qu'un nom faux sur la mauvaise personne.
 */
async function contactAllo(cle: string, telephone: string, delaiMs: number): Promise<Recherche> {
  const e164 = versE164(telephone);
  if (!e164) return { statut: 'absent' };

  let r: Response;
  try {
    r = await appelerAllo(cle, '/v2/api/crm/people/search',
      { filters: { phone_number: e164 }, page: 1, size: 5 }, delaiMs);
  } catch (e) {
    return { statut: 'panne', message: `Allô ne répond pas : ${(e as Error).message}` };
  }
  if (r.status === 401 || r.status === 403) {
    return {
      statut: 'refus',
      message: 'Allô refuse à la clé enregistrée la lecture des contacts. Il lui faut le '
        + 'droit CRM_READ : créez une clé qui le porte dans Allô, Réglages → API, puis '
        + 'enregistrez-la dans Batinium, Connexions, carte Allô.',
    };
  }
  if (r.status === 429) {
    return {
      statut: 'limite',
      message: 'Allô limite le nombre de recherches par jour, et la limite est atteinte. '
        + 'Les numéros restants seront cherchés si vous relancez demain.',
    };
  }
  if (!r.ok) {
    return { statut: 'panne', message: `Allô a répondu ${r.status} à la recherche d’un contact.` };
  }

  const cible = normaliser(telephone);
  for (const p of personnes(await r.json().catch(() => null))) {
    const numeros = numerosContact(p);
    if (numeros.length && !numeros.some((n) => normaliser(n) === cible)) continue;
    const nom = nomContact(p);
    if (nom) return { statut: 'trouve', nom };
  }
  return { statut: 'absent' };
}

/**
 * Le nom porté par l'événement lui-même, s'il y en a un.
 *
 * Le format documenté de `call.completed` n'en porte pas. On lit quand même
 * les champs plausibles : s'ils apparaissent un jour, c'est une recherche
 * chez Allô de moins.
 */
function nomDansAppel(appel: AppelAllo): string | null {
  if (texte(appel.caller_name)) return texte(appel.caller_name);
  const contact = appel.contact
    ?? (Array.isArray(appel.contacts) ? appel.contacts[0] : null);
  return contact && typeof contact === 'object'
    ? nomContact(contact as Record<string, unknown>) : null;
}

/** Le membre de la direction qui appelle, ou la réponse qui le refuse. */
async function direction(req: Request): Promise<{ entreprise_id: string } | Response> {
  const jetonUtilisateur = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!jetonUtilisateur) return json({ erreur: 'Authentification requise.' }, 401);

  const { data: utilisateur } = await db.auth.getUser(jetonUtilisateur);
  if (!utilisateur?.user) return json({ erreur: 'Session expirée. Reconnectez-vous.' }, 401);

  const { data: membre } = await db.from('membre')
    .select('entreprise_id, role').eq('user_id', utilisateur.user.id)
    .eq('actif', true).maybeSingle();
  if (!membre || membre.role !== 'direction') return json({ erreur: 'Réservé à la direction.' }, 403);
  return { entreprise_id: membre.entreprise_id };
}

/**
 * Les droits d'une clé Allô : celle qu'on s'apprête à enregistrer, ou à
 * défaut celle qui l'est déjà.
 *
 * Vérifier avant d'enregistrer : une clé fausse posée par-dessus une bonne
 * couperait les enregistrements sans que personne ne sache pourquoi. Et l'état
 * affiché vient d'un vrai échange avec Allô, pas de la présence d'une valeur.
 */
async function droitsAllo(req: Request): Promise<Response> {
  try {
    const membre = await direction(req);
    if (membre instanceof Response) return membre;

    const corps = await req.json().catch(() => ({}));
    const cle = texte(corps?.cle_api) || await cleAllo(membre.entreprise_id);
    if (!cle) return json({ cle: 'aucune', scopes: [] });

    const r = await appelerAllo(cle, '/v2/api/me', undefined, 8000);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json({
        erreur: `Allô ne reconnaît pas cette clé (${d?.error?.message ?? d?.message ?? `réponse ${r.status}`}). `
          + 'Vérifiez qu’elle a été copiée en entier — elle commence par ak_live_ — et '
          + 'qu’elle n’a pas été révoquée.',
      }, 400);
    }
    return json({ cle: 'valide', scopes: d?.data?.scopes ?? d?.scopes ?? [] });
  } catch (e) {
    return json({ erreur: (e as Error).message }, 500);
  }
}

// Par passage : assez pour l'historique d'une petite entreprise, assez peu
// pour tenir dans le temps d'exécution d'une fonction et dans le quota
// quotidien de l'API d'Allô.
const NUMEROS_PAR_PASSAGE = 150;
const EN_PARALLELE = 4;

/**
 * Les noms des appels déjà reçus.
 *
 * Pour les appels arrivés avant ce correctif, ou quand Allô a tardé à
 * répondre pendant l'appel. Un numéro n'est demandé qu'une fois même s'il a
 * appelé dix fois, et les plus récents passent d'abord : ce sont ceux qu'on
 * rappelle.
 *
 * Seuls les appels sans nom et sans client sont concernés. Un client connu
 * a déjà le sien, celui de sa fiche, et un nom saisi à la main n'est jamais
 * remplacé.
 */
async function retrouverNoms(req: Request): Promise<Response> {
  try {
    const membre = await direction(req);
    if (membre instanceof Response) return membre;

    const cle = await cleAllo(membre.entreprise_id);
    if (!cle) {
      return json({
        erreur: 'Aucune clé d’API Allô enregistrée. Ajoutez-en une dans Connexions, carte '
          + 'Allô, avec le droit CRM_READ.',
      }, 400);
    }

    const { data: lignes, error } = await db.from('demande').select('telephone')
      .eq('entreprise_id', membre.entreprise_id).eq('source', 'allo')
      .is('nom', null).is('tiers_id', null).not('telephone', 'is', null)
      .order('recu_le', { ascending: false }).limit(5000);
    if (error) return json({ erreur: error.message }, 500);

    const numeros = [...new Set((lignes ?? []).map((l) => String(l.telephone)))];
    const lot = numeros.slice(0, NUMEROS_PAR_PASSAGE);
    let examines = 0, trouves = 0, nommees = 0, pannes = 0;
    let arret: string | null = null;

    for (let i = 0; i < lot.length && !arret; i += EN_PARALLELE) {
      const tranche = lot.slice(i, i + EN_PARALLELE);
      const resultats = await Promise.all(tranche.map((t) => contactAllo(cle, t, 8000)));
      for (const [j, r] of resultats.entries()) {
        if (r.statut === 'refus' || r.statut === 'limite') { arret = r.message; continue; }
        // Quelques échecs isolés ne doivent pas tout arrêter ; une série dit
        // qu'Allô est en panne, et insister ne ferait que brûler le quota.
        if (r.statut === 'panne') { if (++pannes >= 5) arret = r.message; continue; }
        examines++;
        if (r.statut !== 'trouve') continue;
        trouves++;
        const { data: maj, error: e } = await db.from('demande').update({ nom: r.nom })
          .eq('entreprise_id', membre.entreprise_id).eq('source', 'allo')
          .eq('telephone', tranche[j]).is('nom', null).select('id');
        if (e) return json({ erreur: e.message }, 500);
        nommees += maj?.length ?? 0;
      }
    }

    return json({
      ok: true, numeros: numeros.length, examines, trouves, nommees, pannes,
      restants: numeros.length - examines, arret,
    });
  } catch (e) {
    return json({ erreur: (e as Error).message }, 500);
  }
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

  // Les droits de la clé Allô, et les noms des appels déjà reçus. Mêmes
  // précautions que l'installation : l'appelant prouve qu'il est direction.
  if (adresseAction(req) === 'droits') {
    return await droitsAllo(req);
  }
  if (adresseAction(req) === 'noms') {
    return await retrouverNoms(req);
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

  // Rattachement au client existant, par numéro, quelle que soit la façon dont
  // il a été tapé dans la fiche.
  const tiersId = telephone ? await tiersDuNumero(entreprise, telephone) : null;

  // Le nom. La fin d'appel d'Allô n'en porte pas, seulement le numéro. Un
  // client connu n'en a pas besoin : l'écran lit celui de sa fiche. Pour un
  // inconnu, on le demande au carnet de contacts d'Allô — brièvement, Allô
  // n'attend notre réponse que vingt secondes. Un nom manqué ici se rattrape
  // depuis l'écran des demandes.
  let nom = nomDansAppel(appel);
  if (!nom && !tiersId && telephone) {
    const cle = await cleAllo(entreprise);
    if (cle) {
      const r = await contactAllo(cle, telephone, 4000);
      if (r.statut === 'trouve') nom = r.nom;
    }
  }

  // La demande. `upsert` sur (entreprise_id, source, source_ref) rend l'appel idempotent.
  // Le nom et le client sont absents plutôt que nuls quand on ne les a pas :
  // un webhook rejoué ne doit pas effacer ce qui a été posé entre-temps.
  const { data: demande, error } = await db.from('demande').upsert({
    entreprise_id: entreprise,
    source: 'allo',
    source_ref: reference,
    recu_le: appel.created_at ?? new Date().toISOString(),
    ...(nom ? { nom } : {}),
    telephone,
    besoin: resume.slice(0, 200) || (manque ? 'Appel manqué' : 'Appel reçu'),
    resume,
    transcription,
    enregistrement_url: appel.recording_url ?? null,
    duree_secondes: appel.duration ?? null,
    urgence: urgence(`${resume} ${transcription}`),
    statut: manque ? 'a_rappeler' : 'nouvelle',
    repondu: false,
    ...(tiersId ? { tiers_id: tiersId } : {}),
  }, { onConflict: 'entreprise_id,source,source_ref' }).select('id, tiers_id').single();

  if (error) {
    console.error('Insertion de la demande impossible', error);
    return new Response(JSON.stringify({ erreur: error.message }), { status: 500 });
  }

  // Le fil du client, pour retrouver qui a appelé quand. Il suit le client de
  // la demande telle qu'elle est en base, rattachement manuel compris.
  await db.from('fil').upsert({
    entreprise_id: entreprise,
    ...(demande.tiers_id ? { tiers_id: demande.tiers_id } : {}),
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
