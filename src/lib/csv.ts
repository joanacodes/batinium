/**
 * Lecture de fichiers CSV et TSV, sans dépendance.
 * Gère les guillemets, les guillemets doublés à l'intérieur d'un champ,
 * les sauts de ligne dans un champ, et les fins de ligne Windows.
 */

export interface Tableau {
  entetes: string[];
  lignes: string[][];
  separateur: string;
}

/** Devine le séparateur en comparant leur régularité sur les premières lignes. */
export function devinerSeparateur(texte: string): string {
  const echantillon = texte.split(/\r?\n/).slice(0, 8).filter(Boolean);
  const candidats = [';', ',', '\t', '|'];
  let meilleur = ';';
  let meilleurScore = -1;

  for (const sep of candidats) {
    const comptes = echantillon.map((l) => decouper(l, sep).length);
    if (comptes.length === 0 || comptes[0] < 2) continue;
    // Un bon séparateur donne le même nombre de colonnes à chaque ligne.
    const regulier = comptes.every((c) => c === comptes[0]);
    const score = (regulier ? 100 : 0) + comptes[0];
    if (score > meilleurScore) { meilleurScore = score; meilleur = sep; }
  }
  return meilleur;
}

function decouper(ligne: string, sep: string): string[] {
  const champs: string[] = [];
  let courant = '';
  let entreGuillemets = false;

  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (entreGuillemets) {
      if (c === '"') {
        if (ligne[i + 1] === '"') { courant += '"'; i++; }
        else entreGuillemets = false;
      } else courant += c;
    } else if (c === '"') {
      entreGuillemets = true;
    } else if (c === sep) {
      champs.push(courant);
      courant = '';
    } else courant += c;
  }
  champs.push(courant);
  return champs;
}

export function lireCsv(texte: string, separateur?: string): Tableau {
  // Le BOM des exports Excel fausse le premier en-tête.
  const propre = texte.replace(/^\uFEFF/, '');
  const sep = separateur ?? devinerSeparateur(propre);

  // Découpage en lignes, en respectant les sauts à l'intérieur des guillemets.
  const brutes: string[] = [];
  let courant = '';
  let entreGuillemets = false;
  for (let i = 0; i < propre.length; i++) {
    const c = propre[i];
    if (c === '"') {
      entreGuillemets = !entreGuillemets;
      courant += c;
    } else if ((c === '\n' || c === '\r') && !entreGuillemets) {
      if (c === '\r' && propre[i + 1] === '\n') i++;
      brutes.push(courant);
      courant = '';
    } else courant += c;
  }
  if (courant.trim()) brutes.push(courant);

  const utiles = brutes.filter((l) => l.trim() !== '');
  if (utiles.length === 0) return { entetes: [], lignes: [], separateur: sep };

  const entetes = decouper(utiles[0], sep).map((h) => h.trim());
  const lignes = utiles.slice(1).map((l) => {
    const champs = decouper(l, sep).map((c) => c.trim());
    // On aligne sur le nombre d'en-têtes : ni trou ni débordement.
    while (champs.length < entetes.length) champs.push('');
    return champs.slice(0, entetes.length);
  });

  return { entetes, lignes, separateur: sep };
}

/** Convertit « 1 234,56 € » en 1234.56. Les exports français sont pleins de ça. */
export function nombre(v: string | undefined): number | null {
  if (v == null) return null;
  const propre = v
    .replace(/\s|\u00a0|€|%/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')   // séparateur de milliers à la française
    .replace(',', '.');
  if (propre === '') return null;
  const n = Number(propre);
  return Number.isFinite(n) ? n : null;
}

/** Accepte 12/03/2026, 2026-03-12, 12-03-26. Retourne AAAA-MM-JJ. */
export function date(v: string | undefined): string | null {
  if (!v?.trim()) return null;
  const t = v.trim();

  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const [, j, mo, a] = m;
    const annee = a.length === 2 ? `20${a}` : a;
    return `${annee}-${mo.padStart(2, '0')}-${j.padStart(2, '0')}`;
  }
  return null;
}

/**
 * Reconnaît automatiquement une colonne d'après son en-tête.
 * Les exports de Tolteck, EBP ou Excel n'ont jamais les mêmes intitulés.
 */
export function deviner(entete: string, synonymes: Record<string, string[]>): string | null {
  const n = entete.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  for (const [champ, mots] of Object.entries(synonymes)) {
    if (mots.some((m) => n === m || n.includes(m))) return champ;
  }
  return null;
}
