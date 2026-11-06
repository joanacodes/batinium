import { supabase } from './supabase';
import type { Membre } from './types';

/**
 * L'apparence de Batinium : un thème et un ton.
 *
 * Le thème est celui de l'entreprise, choisi par la direction pour toute
 * l'équipe (`entreprise.theme`, SQL 41) : c'est l'image de l'entreprise, la
 * même sur tous les téléphones. Le ton — clair, sombre, ou celui du téléphone —
 * est un confort de lecture, il se règle par personne (`membre.ton`).
 *
 * Rien n'est gardé dans le navigateur (règle 9) : tout vient de la base à
 * l'ouverture. Avant que la base ait répondu, l'écran est en graphite et
 * citron, au ton du téléphone : c'est aussi ce que voit l'écran de connexion.
 */

export type Theme = 'citron' | 'cobalt' | 'minuit';
export type Ton = 'auto' | 'clair' | 'sombre';

export const THEMES: { cle: Theme; nom: string; detail: string }[] = [
  { cle: 'citron', nom: 'Graphite et citron', detail: 'Graphite, un seul vert citron. Police Bricolage Grotesque.' },
  { cle: 'cobalt', nom: 'Cobalt', detail: 'Bleu cobalt vif, formes rondes. Police Sora.' },
  { cle: 'minuit', nom: 'Minuit', detail: 'Bleu nuit, sobre. Polices Geist et Geist Mono.' },
];

export const TONS: { cle: Ton; nom: string }[] = [
  { cle: 'auto', nom: 'Automatique' },
  { cle: 'clair', nom: 'Clair' },
  { cle: 'sombre', nom: 'Sombre' },
];

export const THEME_PAR_DEFAUT: Theme = 'citron';
export const TON_PAR_DEFAUT: Ton = 'auto';

export function estTheme(v: unknown): v is Theme {
  return v === 'citron' || v === 'cobalt' || v === 'minuit';
}

export function estTon(v: unknown): v is Ton {
  return v === 'auto' || v === 'clair' || v === 'sombre';
}

let themeCourant: Theme = THEME_PAR_DEFAUT;
let tonCourant: Ton = TON_PAR_DEFAUT;
let ecoute = false;
const abonnes = new Set<() => void>();

const requeteSombre = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/** Le ton réellement affiché : « auto » résolu d'après le système. */
export function tonEffectif(ton: Ton = tonCourant): 'clair' | 'sombre' {
  if (ton !== 'auto') return ton;
  return requeteSombre()?.matches ? 'sombre' : 'clair';
}

export function themeActuel(): Theme { return themeCourant; }
export function tonActuel(): Ton { return tonCourant; }

/** Prévient un composant à chaque changement (le sélecteur du rail, la page Apparence). */
export function surChangement(f: () => void): () => void {
  abonnes.add(f);
  return () => { abonnes.delete(f); };
}

/**
 * Pose le thème et le ton sur <html>. Le CSS fait le reste (src/index.css).
 *
 * Le ton automatique est résolu ici plutôt qu'en CSS : sinon chaque thème
 * aurait dû écrire ses couleurs sombres deux fois, une fois pour « sombre »
 * et une fois dans une requête média pour « auto », et les deux copies
 * auraient fini par diverger.
 */
export function appliquerApparence(theme: Theme, ton: Ton): void {
  themeCourant = theme;
  tonCourant = ton;
  const racine = document.documentElement;
  const effectif = tonEffectif(ton);
  racine.dataset.theme = theme;
  racine.dataset.ton = effectif;

  // La couleur de la barre du navigateur sur téléphone suit la barre du haut
  // de Batinium, sinon un bandeau blanc surmonte un écran sombre.
  const surface = getComputedStyle(racine).getPropertyValue('--surface').trim();
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  if (surface) meta.content = surface;

  // Écouter le système une seule fois, pour toute la vie de la page : un
  // téléphone passe en sombre le soir, Batinium doit suivre sans recharger.
  const requete = requeteSombre();
  if (!ecoute && requete) {
    ecoute = true;
    requete.addEventListener('change', () => {
      if (tonCourant === 'auto') appliquerApparence(themeCourant, 'auto');
    });
  }
  abonnes.forEach((f) => f());
}

export interface EtatApparence {
  theme: Theme;
  ton: Ton;
  /** Faux tant que le SQL 41 n'a pas été exécuté : rien ne peut s'enregistrer. */
  installee: boolean;
}

const manque41 = (message: string) =>
  /column .*theme.* does not exist|theme.* n'existe pas|42703|Could not find the function|function .* does not exist|PGRST202|schema cache/i
    .test(message);

/**
 * Lit le thème de l'entreprise et le ton du membre, et les applique.
 *
 * L'installation se constate par la requête elle-même (règle 13) : si la
 * colonne `entreprise.theme` n'existe pas, PostgREST le dit, et c'est le
 * seul signe qu'on retient — pas l'absence d'une valeur.
 */
export async function chargerApparence(m: Membre): Promise<EtatApparence> {
  const ton = estTon(m.ton) ? m.ton : TON_PAR_DEFAUT;
  const { data, error } = await supabase
    .from('entreprise')
    .select('theme')
    .eq('id', m.entreprise_id)
    .maybeSingle();
  if (error) {
    appliquerApparence(THEME_PAR_DEFAUT, ton);
    if (manque41(error.message)) return { theme: THEME_PAR_DEFAUT, ton, installee: false };
    throw new Error(error.message);
  }
  const brut = (data as { theme?: unknown } | null)?.theme;
  const theme = estTheme(brut) ? brut : THEME_PAR_DEFAUT;
  appliquerApparence(theme, ton);
  return { theme, ton, installee: true };
}

/** Le SQL 41 est-il passé ? Constaté par une vraie requête sur la colonne, jamais déduit. */
export async function apparenceInstallee(entrepriseId: string): Promise<boolean> {
  const { error } = await supabase.from('entreprise').select('theme').eq('id', entrepriseId).maybeSingle();
  if (!error) return true;
  if (manque41(error.message)) return false;
  throw new Error(error.message);
}

const MESSAGE_SQL41 =
  'Ce choix vaut pour cette session : pour qu’il soit retenu, exécutez le SQL 41 dans Supabase.';

/**
 * Change le thème de toute l'entreprise. Réservé à la direction, et c'est la
 * base qui le refuse aux autres (choisir_theme, SQL 41), pas l'écran.
 *
 * Le thème s'applique tout de suite, même si l'enregistrement échoue : on
 * voit ce qu'on choisit. L'échec, lui, est dit (règle 13).
 */
export async function choisirTheme(theme: Theme): Promise<void> {
  appliquerApparence(theme, tonCourant);
  const { error } = await supabase.rpc('choisir_theme', { p_theme: theme });
  if (error) throw new Error(manque41(error.message) ? MESSAGE_SQL41 : error.message);
}

/** Change son propre ton. Ouvert à tous, ne touche qu'à sa propre ligne (choisir_ton, SQL 41). */
export async function choisirTon(ton: Ton): Promise<void> {
  appliquerApparence(themeCourant, ton);
  const { error } = await supabase.rpc('choisir_ton', { p_ton: ton });
  if (error) throw new Error(manque41(error.message) ? MESSAGE_SQL41 : error.message);
}
