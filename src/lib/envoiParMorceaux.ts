/**
 * L'envoi d'un gros fichier par morceaux, qui reprend où il s'était arrêté.
 *
 * Une vidéo de 300 Mo envoyée d'un seul tenant sur la 4G d'un chantier : la
 * moindre coupure — un sous-sol, une cage d'escalier — et tout est à refaire,
 * sans que personne ne sache où l'envoi en était. Supabase conseille l'envoi
 * « reprenable » au-delà de 6 Mo : le fichier part en morceaux de 6 Mo, et
 * après une coupure on demande au serveur ce qu'il a reçu, puis on repart de
 * là. On ne perd jamais plus d'un morceau, et on sait à chaque instant combien
 * est parti.
 *
 * L'envoi s'ouvre en annonçant la taille du fichier, avant le premier octet :
 * un fichier au-delà de la limite du projet est refusé tout de suite, pas
 * après dix minutes. `ouvrirEnvoi` permet de le faire avant d'écrire quoi que
 * ce soit d'autre (une note, une demande), qui resterait sinon sans ses photos.
 *
 * C'est le protocole tus 1.0 (tus.io), que Supabase Storage sert sous
 * /storage/v1/upload/resumable. Écrit ici plutôt que pris dans la
 * bibliothèque tus-js-client : il n'en faut que l'ouverture, l'envoi d'un
 * morceau et la reprise, et le projet n'ajoute pas de dépendance sans raison
 * impérieuse.
 *
 * Ce qu'il ne fait pas : reprendre après un rechargement de la page. Il
 * faudrait garder l'adresse de l'envoi dans le navigateur, ce que la règle 9
 * exclut. Une coupure de plus de trois minutes d'affilée arrête l'envoi, qui
 * repartira de zéro.
 */

import { adresseSupabase, clePublique, supabase } from './supabase';

/** Imposé par Supabase : chaque morceau fait 6 Mo, sauf le dernier. */
export const TAILLE_MORCEAU = 6 * 1024 * 1024;

/**
 * Les attentes entre deux essais, en millisecondes : un peu plus de trois
 * minutes en tout. Le compte repart de zéro à chaque morceau qui passe : seule
 * une coupure de trois minutes d'affilée arrête l'envoi.
 */
const ATTENTES = [1000, 2000, 5000, 10000, 20000, 30000, 30000, 30000, 30000, 30000];

/**
 * Le temps laissé à une requête avant de la tenir pour perdue. Une connexion
 * qui cale ne lève pas toujours d'erreur : sans délai, l'envoi attendrait
 * indéfiniment. Trois minutes pour un morceau, c'est 6 Mo à 0,3 Mbit/s.
 */
const DELAI_MORCEAU = 180_000;
const DELAI_ECHANGE = 30_000;

/** Un échec qu'un nouvel essai ne réglera pas : droits, taille refusée, réseau perdu trop longtemps. */
class Refus extends Error {}

/** Un refus qu'un nouvel essai peut lever : surcharge, conflit de reprise, jeton à rafraîchir. */
function passager(statut: number): boolean {
  return statut >= 500 || [401, 408, 409, 423, 429].includes(statut);
}

/**
 * Un refus pour la taille. Le serveur tus répond 413 ; Supabase peut aussi
 * le dire en toutes lettres (« The object exceeded the maximum allowed size »).
 * Dans les deux cas, la même explication : où relever la limite.
 */
function refusDeTaille(statut: number, motif: string): boolean {
  return statut === 413 || /maximum (allowed )?size|too large|exceeded/i.test(motif);
}

function trop(fichier: File): Refus {
  return new Refus(`« ${fichier.name} » pèse ${Math.round(fichier.size / 1048576)} Mo : c'est `
    + 'au-delà de la limite de taille du projet Supabase. Elle se relève dans Supabase, '
    + 'Storage → Settings, avec l’offre Pro.');
}

/** Le serveur rend parfois du JSON ({ message }), parfois du texte. */
async function motifDe(r: Response): Promise<string> {
  const texte = (await r.text().catch(() => '')).trim();
  try {
    const j = JSON.parse(texte) as { message?: string; error?: string };
    return j.message || j.error || texte;
  } catch {
    return texte || `réponse ${r.status}`;
  }
}

async function enTetes(): Promise<Record<string, string>> {
  // Relue à chaque requête : un envoi de dix minutes peut survivre à son
  // jeton, et getSession() rend un jeton rafraîchi s'il a expiré.
  const { data } = await supabase.auth.getSession();
  const jeton = data.session?.access_token;
  if (!jeton) throw new Refus('Session expirée : reconnectez-vous, puis renvoyez le fichier.');
  return { 'Tus-Resumable': '1.0.0', authorization: `Bearer ${jeton}`, apikey: clePublique };
}

/** Les métadonnées tus : « clé valeur-en-base64 », séparées par des virgules. */
function metadonnees(valeurs: Record<string, string>): string {
  return Object.entries(valeurs).map(([cle, valeur]) => {
    let binaire = '';
    for (const octet of new TextEncoder().encode(valeur)) binaire += String.fromCharCode(octet);
    return `${cle} ${btoa(binaire)}`;
  }).join(',');
}

/** fetch, avec un délai. Pas AbortSignal.timeout : absent des iPad d'avant iOS 16. */
async function requete(adresse: string, init: RequestInit, delai: number): Promise<Response> {
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), delai);
  try {
    return await fetch(adresse, { ...init, signal: controle.signal });
  } finally {
    clearTimeout(minuterie);
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Après un échec : un refus remonte tel quel ; un échec passager fait
 * attendre avant l'essai suivant, jusqu'à épuisement des attentes.
 */
async function patienter(e: unknown, essais: number, quoi: string): Promise<number> {
  if (e instanceof Refus) throw e;
  if (essais >= ATTENTES.length) {
    throw new Refus(`${quoi} n’aboutit pas : la connexion ne tient pas. Réessayez avec un `
      + 'meilleur réseau, en Wi-Fi si possible.');
  }
  await pause(ATTENTES[essais]);
  return essais + 1;
}

/**
 * La position annoncée par le serveur, si elle est lisible. Une valeur
 * illisible ne doit jamais passer pour un nombre : un NaN ferait croire la
 * boucle terminée, et un fichier tronqué serait déclaré envoyé.
 */
function positionDe(r: Response, taille: number): number | null {
  const brut = r.headers.get('Upload-Offset');
  if (brut === null) return null;
  const n = Number(brut);
  return Number.isInteger(n) && n >= 0 && n <= taille ? n : null;
}

/**
 * Ouvre l'envoi de `fichier` dans `seau`, sous `chemin`, sans rien envoyer :
 * Supabase vérifie la taille et les droits, et rend l'adresse où envoyer les
 * morceaux. Valable vingt-quatre heures.
 */
export async function ouvrirEnvoi(seau: string, chemin: string, fichier: File): Promise<string> {
  const point = `${adresseSupabase}/storage/v1/upload/resumable`;
  const nom = `« ${fichier.name} »`;
  for (let essais = 0; ;) {
    try {
      const r = await requete(point, {
        method: 'POST',
        headers: {
          ...(await enTetes()),
          'Upload-Length': String(fichier.size),
          'Upload-Metadata': metadonnees({
            bucketName: seau, objectName: chemin,
            contentType: fichier.type || 'application/octet-stream', cacheControl: '3600',
          }),
        },
      }, DELAI_ECHANGE);
      if (!r.ok) {
        const motif = await motifDe(r);
        if (refusDeTaille(r.status, motif)) throw trop(fichier);
        if (passager(r.status)) throw new Error(motif);
        throw new Refus(`Supabase refuse ${nom} : ${motif}`);
      }
      const lieu = r.headers.get('Location');
      if (!lieu) throw new Refus(`Supabase n’a pas rendu d’adresse pour envoyer ${nom}.`);
      return new URL(lieu, point).toString();
    } catch (e) {
      essais = await patienter(e, essais, `L’envoi de ${nom}`);
    }
  }
}

/**
 * Envoie `fichier` par morceaux, à l'adresse d'un envoi déjà ouvert ou en
 * l'ouvrant. Ne rend la main qu'une fois le fichier entier reçu par Supabase,
 * ou sur une erreur à afficher telle quelle.
 */
export async function envoyerParMorceaux(
  seau: string, chemin: string, fichier: File,
  onProgression?: (envoye: number, total: number) => void,
  adresseOuverte?: string,
): Promise<void> {
  const nom = `« ${fichier.name} »`;
  let adresse = adresseOuverte ?? await ouvrirEnvoi(seau, chemin, fichier);
  /** Ce que Supabase a reçu, en octets : la seule position qui fasse foi. */
  let recu = 0;
  /** Après une coupure, on ne suppose rien : on demande au serveur. */
  let aRecaler = false;
  let essais = 0;

  onProgression?.(0, fichier.size);
  while (recu < fichier.size) {
    try {
      if (aRecaler) {
        const r = await requete(adresse, { method: 'HEAD', headers: await enTetes(), cache: 'no-store' },
          DELAI_ECHANGE);
        if (r.status === 404 || r.status === 410) {
          // L'envoi a disparu chez Supabase (expiré) : il repart de zéro.
          adresse = await ouvrirEnvoi(seau, chemin, fichier);
          recu = 0;
          aRecaler = false;
          onProgression?.(0, fichier.size);
          continue;
        }
        if (!r.ok) {
          if (passager(r.status)) throw new Error(await motifDe(r));
          throw new Refus(`Supabase interrompt l’envoi de ${nom} : ${await motifDe(r)}`);
        }
        const position = positionDe(r, fichier.size);
        if (position === null) throw new Error('position de reprise illisible');
        recu = position;
        aRecaler = false;
        essais = 0;
        onProgression?.(recu, fichier.size);
        continue;
      }

      const morceau = fichier.slice(recu, recu + TAILLE_MORCEAU);
      const r = await requete(adresse, {
        method: 'PATCH',
        headers: {
          ...(await enTetes()),
          'Upload-Offset': String(recu),
          'Content-Type': 'application/offset+octet-stream',
        },
        body: morceau,
      }, DELAI_MORCEAU);
      if (!r.ok) {
        const motif = await motifDe(r);
        if (refusDeTaille(r.status, motif)) throw trop(fichier);
        if (passager(r.status)) throw new Error(motif);
        throw new Refus(`Supabase interrompt l’envoi de ${nom} : ${motif}`);
      }
      recu = positionDe(r, fichier.size) ?? recu + morceau.size;
      essais = 0;
      onProgression?.(recu, fichier.size);
    } catch (e) {
      essais = await patienter(e, essais,
        `L’envoi de ${nom} (${Math.floor((100 * recu) / fichier.size)} % parti)`);
      // Le morceau a pu arriver sans que la réponse revienne : on demande.
      aRecaler = true;
    }
  }
}
