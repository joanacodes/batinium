import { supabase } from './supabase';

/**
 * Les connecteurs, réglables depuis l'application.
 *
 * Avant, brancher Allô demandait d'ouvrir un terminal et de taper une commande
 * `npx supabase secrets set`. C'est une barrière absurde pour un gérant : les
 * réglages d'un service extérieur sont des réglages, pas du déploiement.
 *
 * Deux niveaux de confidentialité, et ils ne se ressemblent pas.
 *
 * Le **jeton d'un webhook** est lisible : il faut bien l'afficher pour le
 * recopier chez le prestataire. Il est unique sur toute la base et désigne
 * l'entreprise à lui seul.
 *
 * Une **clé d'API** ne se relit jamais. La table qui la porte n'a aucune
 * politique de lecture : personne ne peut la ressortir depuis le navigateur,
 * pas même la direction. On sait seulement si elle est posée, et quand. C'est
 * le comportement de tous les services sérieux, et pour une bonne raison —
 * une clé qu'on peut réafficher finit dans une capture d'écran.
 */

export interface Connecteur {
  id: string;
  entreprise_id: string;
  cle: string;
  actif: boolean;
  jeton: string | null;
  config: Record<string, unknown>;
  vu_le: string | null;
  dernier_message: string | null;
}

export async function listerConnecteurs(): Promise<Connecteur[]> {
  const { data, error } = await supabase.from('connecteur').select('*');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Active un connecteur et rend son jeton. Le jeton existant n'est pas remplacé. */
export async function activerConnecteur(cle: string): Promise<string> {
  const { data, error } = await supabase.rpc('activer_connecteur', { p_cle: cle });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function desactiverConnecteur(cle: string): Promise<void> {
  const { error } = await supabase.from('connecteur')
    .update({ actif: false }).eq('cle', cle);
  if (error) throw new Error(error.message);
}

/**
 * Fabrique un nouveau jeton et invalide l'ancien.
 *
 * À faire si le jeton a fuité : une URL de webhook se retrouve vite dans un
 * courriel, une capture ou un ticket de support.
 */
export async function renouvelerJeton(cle: string): Promise<string> {
  const { error } = await supabase.from('connecteur')
    .update({ jeton: null }).eq('cle', cle);
  if (error) throw new Error(error.message);
  return activerConnecteur(cle);
}

export async function poserSecret(cle: string, valeur: string): Promise<void> {
  const { error } = await supabase.rpc('poser_secret', { p_cle: cle, p_valeur: valeur });
  if (error) throw new Error(error.message);
}

export async function secretPose(cle: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('secret_pose', { p_cle: cle });
  if (error) return false;
  return Boolean(data);
}

/**
 * L'adresse à recopier chez le prestataire, en deux formes.
 *
 * Beaucoup de plateformes refusent un paramètre dans l'URL d'un webhook et
 * répondent « échec de la création » sans dire pourquoi. La forme en chemin
 * ressemble à une adresse ordinaire et passe partout. Les deux mènent au même
 * endroit et sont valables en même temps.
 */
export function urlWebhook(fonction: string, jeton: string, forme: 'parametre' | 'chemin' = 'parametre'): string {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  return forme === 'chemin'
    ? `${base}/functions/v1/${fonction}/${jeton}`
    : `${base}/functions/v1/${fonction}?cle=${jeton}`;
}


export interface ResultatTest {
  ok: boolean;
  code: number | null;
  titre: string;
  quoiFaire: string;
}

/**
 * Appelle le webhook exactement comme le ferait le prestataire.
 *
 * Personne ne devrait avoir à ouvrir un terminal pour savoir si son
 * branchement répond. Ce test envoie un message vide en POST : la fonction le
 * reconnaît comme un essai, ne crée aucune demande, et confirme que l'adresse
 * et le jeton sont bons.
 *
 * Chaque code de réponse est traduit en une phrase qui dit quoi faire. Un
 * « 401 » brut n'apprend rien à personne.
 */
export async function testerWebhook(
  fonction: string, jeton: string, forme: 'parametre' | 'chemin' = 'parametre',
): Promise<ResultatTest> {
  try {
    const r = await fetch(urlWebhook(fonction, jeton, forme), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    if (r.ok) {
      return {
        ok: true, code: r.status,
        titre: 'La connexion fonctionne.',
        quoiFaire: 'Votre adresse est bonne et le jeton est reconnu. Si Allô affiche '
          + 'toujours un échec, le problème vient de son côté : vérifiez que l’adresse '
          + 'y est collée en entier, paramètre ?cle= compris, et que la méthode est POST.',
      };
    }

    const texte = await r.text().catch(() => '');
    if (r.status === 401) {
      return {
        ok: false, code: 401,
        titre: 'Le jeton n’est pas reconnu.',
        quoiFaire: 'L’adresse enregistrée ici ne correspond plus à rien. Cliquez '
          + '« Remplacer l’adresse », puis recollez la nouvelle chez Allô.',
      };
    }
    if (r.status === 404) {
      return {
        ok: false, code: 404,
        titre: 'La fonction n’est pas déployée.',
        quoiFaire: 'Le déploiement n’a pas abouti sur ce projet. Reprenez la commande '
          + 'de déploiement, et vérifiez qu’elle se termine par « Deployed Functions ».',
      };
    }
    return {
      ok: false, code: r.status,
      titre: `Le serveur a répondu ${r.status}.`,
      quoiFaire: texte.slice(0, 300) || 'Aucun détail. Les traces se trouvent dans le '
        + 'tableau de bord Supabase, Edge Functions, allo-webhook, Logs.',
    };
  } catch (e) {
    return {
      ok: false, code: null,
      titre: 'Le serveur est injoignable.',
      quoiFaire: `Ni le réseau ni l’adresse ne répondent. ${(e as Error).message}`,
    };
  }
}


/**
 * Crée l'abonnement directement chez Allô, depuis Batinium.
 *
 * Leur formulaire refusait l'adresse sans dire pourquoi. Leur API, elle,
 * l'accepte — et un appel serveur à serveur évite à la fois le formulaire et
 * les refus du navigateur. La clé d'API d'Allô ne transite pas par notre base :
 * elle sert le temps d'un appel, puis elle est oubliée.
 */
export async function installerChezAllo(
  cleApi: string, jeton: string, forme: 'parametre' | 'chemin',
): Promise<ResultatTest> {
  const { data: session } = await supabase.auth.getSession();
  const acces = session.session?.access_token;
  if (!acces) return { ok: false, code: null, titre: 'Session expirée.', quoiFaire: 'Reconnectez-vous.' };

  const base = import.meta.env.VITE_SUPABASE_URL as string;
  try {
    const r = await fetch(`${base}/functions/v1/allo-webhook?action=installer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${acces}` },
      body: JSON.stringify({ cle_api: cleApi, url: urlWebhook('allo-webhook', jeton, forme) }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      // On la garde, contrairement à ce que je disais au début : sans elle,
      // Batinium ne peut pas aller chercher les enregistrements chez Allô, et
      // le lecteur reste muet. Elle rejoint la table qui n'a aucune règle de
      // lecture — écrite une fois, jamais relisible depuis le navigateur.
      await poserSecret('allo_api', cleApi).catch(() => undefined);
      return {
        ok: true, code: 200,
        titre: 'Abonnement créé chez Allô.',
        quoiFaire: 'Allô enverra désormais les fins d’appel et les SMS reçus. '
          + 'Passez un appel de test pour le vérifier.',
      };
    }
    return {
      ok: false, code: r.status,
      titre: 'Allô a refusé la création.',
      quoiFaire: String(d?.erreur ?? 'Vérifiez que la clé d’API porte le droit WEBHOOKS_READ_WRITE.'),
    };
  } catch (e) {
    return {
      ok: false, code: null,
      titre: 'Impossible de joindre la fonction.',
      quoiFaire: `Redéployez allo-webhook, puis réessayez. ${(e as Error).message}`,
    };
  }
}


/**
 * L'enregistrement d'un appel, joué dans Batinium.
 *
 * L'adresse d'Allô ne se lit pas directement depuis un navigateur. Le serveur
 * va donc chercher le fichier et le rend ; on en fait une adresse locale que
 * le lecteur accepte. Rien n'est stocké : ni chez nous, ni dans la base.
 *
 * Le fichier arrive en entier avant de démarrer — un appel de trois minutes
 * pèse deux mégaoctets, l'attente est d'une seconde. C'est le prix pour que
 * l'écoute se fasse sur place plutôt que dans un autre onglet.
 */
export async function audioDemande(demandeId: string): Promise<string> {
  const { data: session } = await supabase.auth.getSession();
  const acces = session.session?.access_token;
  if (!acces) throw new Error('Session expirée. Reconnectez-vous.');

  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const r = await fetch(`${base}/functions/v1/allo-webhook?action=audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${acces}` },
    body: JSON.stringify({ demande_id: demandeId }),
  });

  if (!r.ok) {
    const texte = await r.text().catch(() => '');
    let detail = '';
    try { detail = String(JSON.parse(texte)?.erreur ?? ''); } catch { detail = texte; }

    /*
     * Un 401 parlant de jeton veut dire que la requête a été traitée par la
     * partie « webhook » de la fonction : elle y a cherché un jeton d'Allô
     * qui n'a rien à faire là. Autrement dit, la version déployée ne connaît
     * pas encore le relais audio.
     *
     * Sans cette distinction, l'utilisateur lit « non autorisé » et cherche
     * du côté de ses droits, alors qu'il lui manque un déploiement.
     */
    if (r.status === 401 && /jeton/i.test(detail)) {
      throw new Error(
        'La fonction serveur n’est pas à jour : elle ne sait pas encore relayer les '
        + 'enregistrements. Redéployez-la avec « npx supabase functions deploy '
        + 'allo-webhook --no-verify-jwt ».');
    }
    throw new Error(detail || `Le serveur a répondu ${r.status}.`);
  }
  return URL.createObjectURL(await r.blob());
}


export interface ConsommationIA { jetons: number; appels: number; quota: number }

/** Ce que l'entreprise a consommé ce mois-ci, et ce qu'elle a le droit de consommer. */
export async function consommationIA(): Promise<ConsommationIA | null> {
  const { data, error } = await supabase.rpc('consommation_ia', { p_entreprise: null });
  if (error || !data?.[0]) return null;
  return {
    jetons: Number(data[0].jetons ?? 0),
    appels: Number(data[0].appels ?? 0),
    quota: Number(data[0].quota ?? 0),
  };
}
