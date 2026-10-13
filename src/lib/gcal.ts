import { jetonGoogle, oublierJetonGoogle } from './session';

/**
 * Google Agenda, en lecture et en écriture, depuis le navigateur.
 * Même jeton que la boîte mail : un seul consentement Google pour les deux.
 */

const API = 'https://www.googleapis.com/calendar/v3';

export interface EvenementGoogle {
  id: string;
  titre: string;
  debut: Date;
  fin: Date;
  journeeEntiere: boolean;
  lieu?: string;
  lien?: string;
}

async function appel<T>(chemin: string, init?: RequestInit): Promise<T> {
  const jeton = jetonGoogle();
  if (!jeton) throw new Error('NON_CONNECTE');
  const r = await fetch(`${API}${chemin}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jeton}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (r.status === 401 || r.status === 403) {
    oublierJetonGoogle();
    throw new Error('JETON_EXPIRE');
  }
  if (!r.ok) throw new Error(`Google Agenda a répondu ${r.status}.`);
  return (await r.json()) as T;
}

interface BrutGoogle {
  id: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

export async function evenements(debut: Date, fin: Date): Promise<EvenementGoogle[]> {
  const r = await appel<{ items?: BrutGoogle[] }>(
    `/calendars/primary/events?singleEvents=true&orderBy=startTime` +
    `&timeMin=${debut.toISOString()}&timeMax=${fin.toISOString()}&maxResults=250`,
  );
  return (r.items ?? []).map((e) => ({
    id: e.id,
    titre: e.summary ?? '(sans titre)',
    debut: new Date(e.start?.dateTime ?? e.start?.date ?? Date.now()),
    fin: new Date(e.end?.dateTime ?? e.end?.date ?? Date.now()),
    journeeEntiere: !e.start?.dateTime,
    lieu: e.location,
    lien: e.htmlLink,
  }));
}

/** Pousse une intervention vers l'agenda Google, pour qu'elle sonne sur le téléphone. */
export async function creerEvenement(o: {
  titre: string; debut: Date; fin: Date; lieu?: string; description?: string;
}): Promise<string> {
  const r = await appel<{ id: string }>('/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify({
      summary: o.titre,
      location: o.lieu,
      description: o.description,
      start: { dateTime: o.debut.toISOString(), timeZone: 'Europe/Paris' },
      end: { dateTime: o.fin.toISOString(), timeZone: 'Europe/Paris' },
    }),
  });
  return r.id;
}
