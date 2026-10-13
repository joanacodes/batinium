import { jetonGoogle, oublierJetonGoogle } from './session';

/**
 * Lecture de la boîte Gmail depuis le navigateur, avec le jeton Google obtenu
 * à la connexion. Aucun serveur intermédiaire, donc aucun mot de passe stocké.
 *
 * Ce qui répond au besoin de Fabrice : un fil est « à répondre » quand le
 * dernier message vient du client. S'il a répondu après lui, c'est traité.
 */

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface FilGmail {
  threadId: string;
  messageId: string;
  expediteur: string;
  email: string;
  destinataire: string;
  sujet: string;
  extrait: string;
  date: Date;
  /** Le dernier message du fil vient du client : il attend une réponse. */
  aRepondre: boolean;
  lien: string;
}

async function appel<T>(chemin: string): Promise<T> {
  const jeton = jetonGoogle();
  if (!jeton) throw new Error('NON_CONNECTE');
  const r = await fetch(`${API}${chemin}`, { headers: { Authorization: `Bearer ${jeton}` } });
  if (r.status === 401 || r.status === 403) {
    oublierJetonGoogle();
    throw new Error('JETON_EXPIRE');
  }
  if (!r.ok) throw new Error(`Gmail a répondu ${r.status}.`);
  return (await r.json()) as T;
}

interface Entete { name: string; value: string }
interface MessageGmail {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  labelIds?: string[];
  payload?: { headers?: Entete[]; mimeType?: string; body?: Corps; parts?: Partie[] };
}

const entete = (m: MessageGmail, nom: string): string =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === nom.toLowerCase())?.value ?? '';

/** Extrait l'adresse d'un en-tête « Prénom Nom <adresse@exemple.fr> ». */
export function adresseSeule(brut: string): string {
  const m = brut.match(/<([^>]+)>/);
  return (m ? m[1] : brut).trim().toLowerCase();
}

export function nomSeul(brut: string): string {
  const m = brut.match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : adresseSeule(brut);
}

/**
 * Récupère les derniers fils de la boîte de réception.
 * On lit le dernier message de chaque fil : s'il n'est pas de nous, il attend
 * une réponse. C'est le point rouge de la rubrique 38 du cahier des charges.
 */
export async function derniersFils(maximum = 25): Promise<FilGmail[]> {
  const liste = await appel<{ messages?: { id: string; threadId: string }[] }>(
    `/messages?maxResults=${maximum}&q=${encodeURIComponent('in:inbox -category:promotions -category:social')}`,
  );
  const messages = liste.messages ?? [];

  const details = await Promise.all(
    messages.map((m) =>
      appel<MessageGmail>(
        `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      ).catch(() => null),
    ),
  );

  const fils = new Map<string, FilGmail>();
  for (const m of details) {
    if (!m) continue;
    const de = entete(m, 'From');
    const envoye = (m.labelIds ?? []).includes('SENT');
    const fil: FilGmail = {
      threadId: m.threadId,
      messageId: m.id,
      expediteur: nomSeul(de),
      email: adresseSeule(de),
      destinataire: adresseSeule(entete(m, 'To')),
      sujet: entete(m, 'Subject') || '(sans objet)',
      extrait: m.snippet ?? '',
      date: new Date(Number(m.internalDate)),
      aRepondre: !envoye,
      lien: `https://mail.google.com/mail/u/0/#inbox/${m.threadId}`,
    };
    const existant = fils.get(m.threadId);
    if (!existant || fil.date > existant.date) fils.set(m.threadId, fil);
  }

  return [...fils.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
}

export const SCOPES_GMAIL = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');


// --- Corps complet d'un message ---------------------------------------------

interface Corps { data?: string; size?: number }
interface Partie { mimeType?: string; body?: Corps; parts?: Partie[] }

/** Gmail encode en base64 « URL », avec - et _ au lieu de + et /. */
function decoder(data: string): string {
  try {
    const normal = data.replace(/-/g, '+').replace(/_/g, '/');
    const binaire = atob(normal);
    // Le corps est en UTF-8 : sans cette conversion, les accents sortent
    // en mojibake et les étiquettes « Numéro de téléphone » ne matchent plus.
    return new TextDecoder('utf-8').decode(
      Uint8Array.from(binaire, (c) => c.charCodeAt(0)),
    );
  } catch { return ''; }
}

/** Descend dans les parties jusqu'au texte. Le HTML n'est gardé qu'en dernier recours. */
function texteDe(partie: Partie): string {
  if (partie.mimeType === 'text/plain' && partie.body?.data) return decoder(partie.body.data);
  for (const p of partie.parts ?? []) {
    const t = texteDe(p);
    if (t) return t;
  }
  if (partie.mimeType === 'text/html' && partie.body?.data) {
    // Les balises retirées, mais les retours à la ligne conservés : c'est sur
    // eux que repose la lecture « étiquette : valeur ».
    return decoder(partie.body.data)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ');
  }
  return '';
}

/**
 * Le texte entier d'un message.
 *
 * L'extrait de la liste est tronqué à deux cents caractères : suffisant pour
 * décider si un message attend une réponse, insuffisant pour y lire les
 * coordonnées d'un formulaire, qui arrivent souvent après. On ne le demande
 * donc qu'au moment d'en avoir besoin — une requête de plus, une seule fois.
 */
export async function corpsComplet(messageId: string): Promise<string> {
  const m = await appel<MessageGmail>(`/messages/${messageId}?format=full`);
  return m.payload ? texteDe(m.payload as Partie) : '';
}
