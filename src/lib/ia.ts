import { supabase } from './supabase';

/**
 * Le côté navigateur de la passerelle IA.
 *
 * Aucune clé ici, et il n'y en aura jamais : tout ce que la page charge est
 * lisible par qui ouvre les outils de développement. On appelle une fonction
 * serveur, qui détient la clé et qui n'accepte qu'une liste fermée de tâches.
 *
 * Ce module ne fait rien d'autre que transporter. Il n'écrit pas en base :
 * le modèle propose, l'écran affiche, une personne décide. C'est le même
 * principe que les brouillons du catalogue.
 */

export type TacheIA =
  | 'assistant' | 'catalogue' | 'devis' | 'formulaire' | 'plaque' | 'resume_appel'
  | 'caviardage' | 'traduction';

export class IANonConfiguree extends Error {}

/**
 * Envoie un contenu à la passerelle et rend son texte brut.
 *
 * Les erreurs sont volontairement bavardes : quand ça ne marche pas, c'est
 * presque toujours que la fonction n'est pas déployée ou que la clé manque,
 * et deviner ça depuis un « échec » est une perte de temps.
 */
export async function demanderIA(
  tache: TacheIA, contenu: string,
  fichier?: { media_type: string; data: string },
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('ia', {
    body: { tache, contenu, fichier },
  });

  if (error) {
    const message = String(error.message ?? error);
    // Quand la fonction n'existe pas, Supabase ne rend pas un 404 propre mais
    // « Failed to send a request to the Edge Function ». Le message brut ne
    // dit rien à personne : on le traduit en ce qu'il faut faire.
    if (/not found|404|failed to send|failed to fetch|networkerror|functionsfetcherror/i
        .test(message)) {
      throw new IANonConfiguree(
        'La passerelle IA n’est pas déployée sur votre projet Supabase. '
        + 'Les commandes se trouvent dans Connexions → Passerelle IA.');
    }
    throw new Error(message);
  }
  if (data?.erreur) {
    if (/clé du modèle/i.test(String(data.erreur))) throw new IANonConfiguree(String(data.erreur));
    throw new Error(String(data.erreur));
  }
  return String(data?.resultat ?? '');
}

/**
 * La même chose, en attendant du JSON.
 *
 * Un modèle rend parfois du texte autour de son JSON malgré la consigne. On
 * récupère donc le premier objet ou tableau complet plutôt que d'échouer sur
 * une phrase de politesse.
 */
/**
 * Envoie un fichier au modèle.
 *
 * Un PDF et une photo de tarif partent tels quels : les convertir en texte
 * dans le navigateur demanderait des bibliothèques lourdes et rendrait un
 * résultat moins bon qu'une lecture directe.
 */
export async function demanderIAFichier<T>(tache: TacheIA, fichier: File): Promise<T> {
  const data = await new Promise<string>((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resoudre(String(lecteur.result).split(',')[1] ?? '');
    lecteur.onerror = () => rejeter(new Error('Fichier illisible.'));
    lecteur.readAsDataURL(fichier);
  });
  return extraireJson<T>(await demanderIA(tache, '', {
    media_type: fichier.type || 'application/octet-stream', data,
  }));
}

export async function demanderIAJson<T>(tache: TacheIA, contenu: string): Promise<T> {
  return extraireJson<T>(await demanderIA(tache, contenu));
}

function extraireJson<T>(brut: string): T {
  const debut = brut.search(/[[{]/);
  const fin = Math.max(brut.lastIndexOf(']'), brut.lastIndexOf('}'));
  if (debut === -1 || fin <= debut) {
    throw new Error('Le modèle n’a pas répondu au format attendu. Réessayez.');
  }
  try {
    return JSON.parse(brut.slice(debut, fin + 1)) as T;
  } catch {
    throw new Error('La réponse du modèle est illisible. Réessayez.');
  }
}

/**
 * Contrôle de santé de la passerelle.
 *
 * Ne consomme rien : la fonction répond avant d'appeler le modèle. Un
 * diagnostic qui coûte un appel payant est un diagnostic qu'on n'ose pas
 * relancer, et qu'on finit par ne plus consulter.
 */
export async function diagnosticIA(): Promise<{
  deployee: boolean; cle: boolean; modele?: string; taches?: string[]; message?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('ia', {
      body: { tache: '__diagnostic__' },
    });
    if (error) {
      const m = String(error.message ?? error);
      if (/not found|404|failed to send|failed to fetch|networkerror|functionsfetcherror/i.test(m)) {
        return { deployee: false, cle: false, message: 'Fonction non déployée.' };
      }
      return { deployee: false, cle: false, message: m };
    }
    return {
      deployee: Boolean(data?.deployee),
      cle: Boolean(data?.cle),
      modele: data?.modele,
      taches: data?.taches,
    };
  } catch (e) {
    return { deployee: false, cle: false, message: (e as Error).message };
  }
}

/**
 * Contrôle de santé du webhook Allô.
 *
 * On interroge la fonction, on ne devine pas depuis les données. Compter les
 * demandes portant la source « allo » ne prouverait rien : elles peuvent venir
 * d'un jeu de démonstration, d'un import, ou d'une saisie à la main.
 *
 * Un GET ne crée aucune demande et n'a pas besoin de la clé — c'est ce que la
 * fonction répond avant toute autre chose.
 */
export async function diagnosticAllo(): Promise<{
  deployee: boolean; secret: boolean; entreprise: boolean; message?: string;
}> {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  try {
    const r = await fetch(`${base}/functions/v1/allo-webhook`, { method: 'GET' });
    if (r.status === 404) {
      return { deployee: false, secret: false, entreprise: false,
               message: 'Fonction non déployée.' };
    }
    if (!r.ok) {
      // Déployée mais dans une version antérieure au contrôle de santé : elle
      // répond 405 ou 401, ce qui prouve déjà qu'elle est là.
      return { deployee: true, secret: false, entreprise: false,
               message: `Déployée, mais sans contrôle de santé (réponse ${r.status}). `
                 + 'Redéployez-la pour en savoir plus.' };
    }
    const d = await r.json();
    return {
      deployee: Boolean(d?.deployee),
      secret: Boolean(d?.secret),
      entreprise: Boolean(d?.entreprise),
    };
  } catch (e) {
    return { deployee: false, secret: false, entreprise: false,
             message: `Injoignable : ${(e as Error).message}` };
  }
}

// --- Dictée -----------------------------------------------------------------

/**
 * La dictée passe par le navigateur, pas par la passerelle.
 *
 * Chrome sait transcrire la parole sans qu'on paie ni qu'on déploie quoi que
 * ce soit. Contrepartie à connaître : dans Chrome, l'audio transite par les
 * serveurs de Google. Pour une note de chantier c'est sans conséquence ; pour
 * un contenu sensible, il faudra passer par une transcription côté serveur —
 * ce sera un ajout à la passerelle, pas une réécriture.
 */
interface MoteurDictee {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type FabriqueDictee = new () => MoteurDictee;

function fabrique(): FabriqueDictee | null {
  const w = window as unknown as {
    SpeechRecognition?: FabriqueDictee;
    webkitSpeechRecognition?: FabriqueDictee;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const dicteeDisponible = () => fabrique() !== null;

export interface SessionDictee { arreter: () => void }

/**
 * Démarre une dictée. `onTexte` reçoit le texte définitif au fil de l'eau,
 * `onProvisoire` ce que le moteur croit entendre — utile pour montrer que ça
 * écoute, sans quoi on parle dans le vide en se demandant si ça marche.
 */
export function dicter(o: {
  onTexte: (texte: string) => void;
  onProvisoire?: (texte: string) => void;
  onFin?: () => void;
  onErreur?: (message: string) => void;
  langue?: string;
}): SessionDictee | null {
  const Moteur = fabrique();
  if (!Moteur) return null;

  const moteur = new Moteur();
  moteur.lang = o.langue ?? 'fr-FR';
  moteur.continuous = true;
  moteur.interimResults = true;

  moteur.onresult = (e) => {
    let definitif = '';
    let provisoire = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const morceau = e.results[i][0].transcript;
      if (e.results[i].isFinal) definitif += morceau;
      else provisoire += morceau;
    }
    if (definitif) o.onTexte(definitif);
    if (provisoire && o.onProvisoire) o.onProvisoire(provisoire);
  };

  moteur.onerror = (e) => {
    const messages: Record<string, string> = {
      'not-allowed': 'Le micro est refusé. Autorisez-le dans les réglages du navigateur.',
      'no-speech': 'Rien n’a été entendu.',
      'audio-capture': 'Aucun micro détecté.',
      network: 'La transcription a besoin d’une connexion.',
    };
    o.onErreur?.(messages[e.error] ?? `Dictée interrompue : ${e.error}`);
  };

  moteur.onend = () => o.onFin?.();
  moteur.start();

  return { arreter: () => moteur.stop() };
}
