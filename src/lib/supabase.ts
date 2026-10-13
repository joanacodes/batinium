import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** Pour les rares appels que le client Supabase ne sait pas faire : l'envoi
    par morceaux des gros fichiers (envoiParMorceaux.ts). */
export const adresseSupabase = url;
export const clePublique = key;

if (!url || !key) {
  throw new Error(
    'Configuration Supabase absente. Vérifiez .env.local puis relancez npm run dev.',
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
