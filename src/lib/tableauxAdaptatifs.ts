/**
 * Les tableaux qui ne tiennent pas dans l'écran deviennent des cartes.
 *
 * Jusqu'ici, sur téléphone, un tableau gardait au moins 620 px de large et
 * devait défiler de côté. En pratique il poussait toute la page hors de
 * l'écran, et le téléphone dézoomait le tout jusqu'à l'illisible. Fabrice ne
 * veut plus voir de tableau dépasser, ni sur téléphone ni sur tablette.
 *
 * Plutôt que d'annoter à la main chaque cellule de la soixantaine de tableaux
 * de l'application, ce module le fait pour tous :
 * - chaque cellule reçoit le titre de sa colonne (`data-libelle`), que la
 *   feuille de style affiche devant la valeur en mode carte ;
 * - un tableau passe en cartes (`data-cartes`) quand il ne tiendrait pas dans
 *   la largeur de son conteneur, ou quand il a trop de colonnes pour un
 *   téléphone — tenir de justesse en écrasant chaque colonne sur trois lettres
 *   n'est pas tenir ;
 * - et il redevient un tableau dès que la place revient (tablette tournée,
 *   fenêtre agrandie, menu latéral replié).
 *
 * L'impression n'est pas concernée : les cartes ne s'appliquent qu'à l'écran.
 */

/** Au-delà, sur téléphone, un tableau se lit mieux en cartes même s'il tient. */
const COLONNES_MAX_TELEPHONE = 4;
const LARGEUR_TELEPHONE = 720;

/**
 * Une ligne dont une cellule couvre au moins trois colonnes — titre de lot,
 * détail déplié — n'est pas un enregistrement comme les autres : quand les
 * cartes se rangent sur plusieurs colonnes, elle prend toute la largeur. Sans
 * ça, un titre de lot se poserait à côté de ses propres lignes.
 */
const COLONNES_LIGNE_LARGE = 3;

/**
 * Un conteneur peut changer de largeur sans que la fenêtre bouge : menu
 * latéral replié, bloc qu'on déplie, fenêtre qui s'ouvre. On ne réagit qu'à
 * la largeur : un tableau passé en cartes grandit en hauteur, et réagir à
 * cette hauteur relancerait la mesure qui l'a provoquée.
 */
const observes = new Set<Element>();
const largeursVues = new WeakMap<Element, number>();
const surveillance = new ResizeObserver((entrees) => {
  let changement = false;
  for (const e of entrees) {
    const largeur = Math.round(e.contentRect.width);
    if (largeursVues.get(e.target) !== largeur) {
      largeursVues.set(e.target, largeur);
      changement = true;
    }
  }
  if (changement) toutAjuster();
});

/** Le titre de chaque colonne, en tenant compte des cellules fusionnées. */
function titresDeColonnes(table: HTMLTableElement): string[] {
  const ligne = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!ligne) return [];
  const titres: string[] = [];
  for (const th of Array.from(ligne.cells)) {
    // Le titre visible, sans la bulle d'aide qui l'accompagne parfois quand
    // la souris passe dessus au moment de la mesure.
    const copie = th.cloneNode(true) as HTMLElement;
    copie.querySelectorAll('.bulle').forEach((b) => b.remove());
    const texte = (th.getAttribute('aria-label') ?? copie.textContent ?? '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < Math.max(1, th.colSpan); i++) titres.push(texte);
  }
  return titres;
}

function etiqueter(table: HTMLTableElement, titres: string[]): void {
  if (!titres.length) return;
  for (const corps of Array.from(table.tBodies).concat(table.tFoot ? [table.tFoot] : [])) {
    for (const tr of Array.from(corps.rows)) {
      let colonne = 0;
      let large = false;
      for (const td of Array.from(tr.cells)) {
        // Une étiquette posée à la main dans la page l'emporte. On ne réécrit
        // pas une étiquette inchangée : la mesure repasse à chaque frappe dans
        // un champ du tableau, et chaque écriture refait les styles.
        const libelle = titres[colonne] ?? '';
        if (!td.hasAttribute('data-libelle-manuel') && td.getAttribute('data-libelle') !== libelle) {
          td.setAttribute('data-libelle', libelle);
        }
        if (td.colSpan >= COLONNES_LIGNE_LARGE) large = true;
        colonne += Math.max(1, td.colSpan);
      }
      tr.toggleAttribute('data-ligne-large', large);
    }
  }
}

/** La largeur utile du conteneur : sa boîte, moins ses marges intérieures. */
function largeurDisponible(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

function ajuster(table: HTMLTableElement): void {
  // Un tableau peut s'en remettre à la page : `data-cartes="jamais"` le garde
  // en tableau quoi qu'il arrive (il doit alors savoir tenir seul).
  if (table.dataset.cartes === 'jamais') return;
  const parent = table.parentElement;
  if (!parent || !table.isConnected) return;

  if (!observes.has(parent)) {
    observes.add(parent);
    surveillance.observe(parent);
  }

  const titres = titresDeColonnes(table);
  etiqueter(table, titres);

  const telephone = window.innerWidth <= LARGEUR_TELEPHONE;
  const tropDeColonnes = telephone && titres.length > COLONNES_MAX_TELEPHONE;

  // On mesure toujours le tableau sous sa forme de tableau : en cartes, il
  // tient forcément, et on ne saurait jamais quand revenir en arrière. Les
  // deux écritures se font dans la même image, l'écran ne clignote pas.
  table.removeAttribute('data-cartes');
  const deborde = table.offsetWidth > largeurDisponible(parent) + 1;
  // Un conteneur qui s'élargit avec son contenu (case flexible, bloc en
  // ligne) contient toujours son tableau, même quand les deux sortent de
  // l'écran : c'est alors le bord de l'écran qui tranche.
  const horsEcran = table.getBoundingClientRect().right + window.scrollX
    > document.documentElement.clientWidth + 1;
  if (deborde || horsEcran || tropDeColonnes) table.setAttribute('data-cartes', '');
}

let enAttente = false;

function toutAjuster(): void {
  if (enAttente) return;
  enAttente = true;
  requestAnimationFrame(() => {
    enAttente = false;
    // Un conteneur sorti de la page n'a plus rien à dire ; le garder en
    // surveillance le garderait en mémoire, page après page, toute la journée.
    for (const el of observes) {
      if (!el.isConnected) {
        surveillance.unobserve(el);
        observes.delete(el);
      }
    }
    document.querySelectorAll('table').forEach((t) => ajuster(t as HTMLTableElement));
  });
}

/**
 * À appeler une fois au démarrage. Les tableaux apparaissent et changent à
 * chaque navigation et à chaque chargement de données : on les surveille,
 * plutôt que de demander à chaque page d'y penser.
 *
 * On n'observe que les ajouts et les textes, pas les attributs : sinon nos
 * propres `data-cartes` et `data-libelle` relanceraient la surveillance sans
 * fin. Les changements de largeur sans changement de contenu passent par
 * `surveillance`, ci-dessus.
 */
export function installerTableauxAdaptatifs(): void {
  new MutationObserver(toutAjuster)
    .observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', toutAjuster);
  window.addEventListener('orientationchange', toutAjuster);
  toutAjuster();
}
