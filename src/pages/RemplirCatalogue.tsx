import { useMemo, useState } from 'react';
import { aller } from '../lib/router';
import { eur } from '../lib/calcul';
import { deviner, lireCsv, nombre, type Tableau } from '../lib/csv';
import {
  importerProduitsBrouillon, type ProduitImporte, type ResultatCatalogue,
} from '../lib/db';
import type { Famille, Nature } from '../lib/types';
import { demanderIAFichier, IANonConfiguree } from '../lib/ia';
import FilAriane from '../components/FilAriane';

/**
 * Remplir le catalogue depuis un fichier ou un devis collé.
 *
 * Rien n'est publié : chaque référence lue devient un brouillon, invisible du
 * catalogue et du sélecteur de lignes de devis tant qu'elle n'a pas été relue.
 * C'est la seule façon d'accepter une lecture approximative — et toute lecture
 * automatique l'est — sans abîmer le catalogue, qui sert ensuite à chiffrer.
 *
 * Deux lectures, selon ce qu'on donne à l'écran :
 *   — un tableau (CSV, TSV, cellules copiées d'Excel), dont les colonnes sont
 *     reconnues puis corrigées à la main ;
 *   — un texte libre, typiquement un devis collé depuis un PDF, dont on
 *     extrait les lignes chiffrées.
 * Dans les deux cas, tout se passe dans le navigateur : aucun fichier ne part.
 */

const FAMILLES: Famille[] = [
  'mono_split', 'multi_split', 'gainable', 'console', 'cassette', 'groupe_eau',
  'accessoire', 'fourniture', 'plomberie', 'electricite', 'pose', 'phonique', 'logistique',
];

const SYNONYMES: Record<string, string[]> = {
  reference:   ['reference', 'refarticle', 'code', 'codearticle', 'sku', 'ean'],
  designation: ['designation', 'libelle', 'produit', 'article', 'intitule', 'prestation', 'nom'],
  description: ['description', 'detail', 'caracteristique', 'commentaire', 'note'],
  unite:       ['unite', 'unitemesure', 'unitedevente'],
  achat:       ['prixachat', 'prixdachat', 'tarifachat', 'prixfournisseur', 'achatht', 'cout'],
  vente:       ['prixvente', 'prixunitaire', 'puht', 'prixht', 'tarif', 'venteht', 'prixpublic'],
  famille:     ['famille', 'categorie', 'gamme', 'typeproduit', 'rubrique'],
};

/** Familles reconnues d'après un intitulé libre venu d'un autre logiciel. */
const INDICES_FAMILLE: [RegExp, Famille][] = [
  [/multi.?split|bi.?split|tri.?split/i, 'multi_split'],
  [/mono.?split|split mural|mural/i,     'mono_split'],
  [/gainable/i,                          'gainable'],
  [/console/i,                           'console'],
  [/cassette/i,                          'cassette'],
  [/ballon|chauffe.?eau|thermodynamique|groupe d.?eau/i, 'groupe_eau'],
  [/plomberie|évacuation|evacuation|condensat/i, 'plomberie'],
  [/electric|électric|disjonct|câbl|cabl/i, 'electricite'],
  [/pose|installation|main.?d.?oeuvre|main.?d.?œuvre|forfait/i, 'pose'],
  [/phonique|acoustique|antivibratile/i, 'phonique'],
  [/livraison|transport|déplacement|deplacement|location/i, 'logistique'],
];

function familleDepuis(texte: string, defaut: Famille): Famille {
  for (const [motif, f] of INDICES_FAMILLE) if (motif.test(texte)) return f;
  return defaut;
}

/** Une pose ne se stocke pas : la nature change le comportement dans le devis. */
function natureDepuis(texte: string): Nature {
  if (/déplacement|deplacement|transport|livraison/i.test(texte)) return 'deplacement';
  if (/pose|installation|main.?d.?oeuvre|main.?d.?œuvre|mise en service|dépose|depose/i.test(texte)) {
    return 'pose';
  }
  return 'fourniture';
}

const UNITES = /^(u|un|pce|pcs|ens|ml|m|m2|m²|m3|m³|h|j|kg|l|forfait|ft|lot)$/i;

interface Brouillon {
  cle: string;
  garde: boolean;
  reference: string;
  designation: string;
  description: string;
  unite: string;
  famille: Famille;
  nature: Nature;
  achat: number | null;
  vente: number | null;
}

const estNombre = (c: string) =>
  /^[-+]?[\d\s\u00a0.,€%]+$/.test(c) && /\d/.test(c) && nombre(c) != null;

/**
 * Extraction d'un devis collé.
 *
 * Une ligne de devis sortie d'un PDF garde presque toujours ses colonnes,
 * séparées par une tabulation ou par plusieurs espaces. On découpe là-dessus :
 * la première cellule qui n'est pas un nombre est la désignation, les nombres
 * sont la quantité, le prix unitaire et le total, dans cet ordre habituel.
 *
 * Sans séparation de colonnes, on se rabat sur les nombres de fin de ligne,
 * mais seulement s'ils portent un euro ou des centimes : sinon « Daikin
 * FTXM35 » finirait avec un prix de 35 €.
 */
function lignesDepuisTexte(texte: string, familleDefaut: Famille): Brouillon[] {
  const rejets = /^(total|sous.?total|tva|net à payer|net a payer|acompte|remise|montant|devis|facture|client|adresse|date|conditions|signature|page|désignation|designation|réf|ref\b|qté|qte|quantité|quantite|p\.?u\.?|prix)/i;
  const sortie: Brouillon[] = [];

  texte.split(/\r?\n/).forEach((brute, i) => {
    const t = brute.trim();
    if (t.length < 4 || rejets.test(t) || !/[a-zA-Zà-ÿ]{3}/.test(t)) return;

    const cellules = t.split(/\t|\s{2,}/).map((c) => c.trim()).filter(Boolean);
    let designation = '';
    let unite = '';
    const nombres: number[] = [];

    if (cellules.length >= 2) {
      for (const c of cellules) {
        if (estNombre(c)) { const n = nombre(c); if (n != null) nombres.push(n); }
        else if (UNITES.test(c)) unite = c;
        else if (!designation) designation = c;
      }
    } else {
      // Une seule colonne : on ne coupe que sur un vrai prix, euro ou centimes.
      const m = t.match(/^(.*?)[\s.·:]+((?:\d[\d\s\u00a0.]*(?:,\d{1,2})?\s*(?:€|EUR)?[\s|]*){1,4})$/);
      if (!m || !/€|,\d{2}/.test(m[2])) return;
      designation = m[1].trim();
      for (const brut of m[2].split(/\s{2,}|\|/)) {
        const n = nombre(brut);
        if (n != null) nombres.push(n);
      }
    }

    if (!designation || designation.length < 3 || nombres.length === 0) return;

    // Désignation, quantité, prix unitaire, total : le prix unitaire est
    // l'avant-dernier nombre dès qu'il y en a trois, le dernier sinon.
    const vente = nombres.length >= 3 ? nombres[nombres.length - 2] : nombres[nombres.length - 1];

    sortie.push({
      cle: `t${i}`,
      garde: true,
      reference: '',
      designation,
      description: '',
      unite: unite || 'U',
      famille: familleDepuis(designation, familleDefaut),
      nature: natureDepuis(designation),
      achat: null,
      vente,
    });
  });

  return sortie;
}

export default function PageRemplirCatalogue() {
  const [tableau, setTableau] = useState<Tableau | null>(null);
  const [texte, setTexte] = useState('');
  const [nomFichier, setNomFichier] = useState('');
  const [correspondance, setCorrespondance] = useState<Record<string, number>>({});
  const [familleDefaut, setFamilleDefaut] = useState<Famille>('fourniture');
  const [sens, setSens] = useState<'vente' | 'achat'>('vente');
  const [coefficient, setCoefficient] = useState('');
  const [retouches, setRetouches] = useState<Record<string, Partial<Brouillon>>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<ResultatCatalogue | null>(null);
  const [encours, setEncours] = useState(false);
  const [analyse, setAnalyse] = useState(false);
  const [parIA, setParIA] = useState<Brouillon[] | null>(null);

  function recommencer() {
    setTableau(null); setTexte(''); setNomFichier('');
    setCorrespondance({}); setRetouches({}); setResultat(null); setErreur(null);
    setParIA(null);
  }

  /** Un tableau si les colonnes tiennent debout, un texte libre sinon. */
  function analyser(contenu: string, nom: string) {
    setErreur(null); setResultat(null); setRetouches({}); setParIA(null);
    const t = lireCsv(contenu);
    if (t.entetes.length >= 2 && t.lignes.length > 0) {
      setTableau(t); setTexte(''); setNomFichier(nom);
      const auto: Record<string, number> = {};
      t.entetes.forEach((h, i) => {
        const champ = deviner(h, SYNONYMES);
        if (champ && auto[champ] === undefined) auto[champ] = i;
      });
      setCorrespondance(auto);
      if (auto.designation === undefined) {
        setErreur('Aucune colonne de désignation reconnue : indiquez-la ci-dessous.');
      }
    } else {
      setTableau(null); setTexte(contenu); setNomFichier(nom);
    }
  }

  /**
   * Oriente la lecture selon le fichier, sans demander à l'utilisateur.
   *
   * Un CSV n'a aucun besoin d'un modèle : c'est déjà structuré, la lecture est
   * instantanée et rien ne sort du poste. Un PDF ou une photo, personne ne sait
   * les découper avec des règles. Poser la question aurait fait porter à
   * l'utilisateur un arbitrage technique qui ne le regarde pas.
   */
  async function lireFichier(f: File | undefined) {
    if (!f) return;
    setErreur(null);

    const nom = f.name.toLowerCase();
    if (/\.(xlsx|xls|ods)$/.test(nom)) {
      return setErreur(
        'Les tableurs ne se lisent pas directement. Dans Excel : « Fichier », '
        + '« Enregistrer sous », « CSV (séparateur point-virgule) ». Le fichier obtenu '
        + 'se lit ici sans appel payant et sans que vos tarifs sortent de votre poste.');
    }

    if (/\.(csv|tsv|txt)$/.test(nom) || f.type.startsWith('text/')) {
      return analyser(await f.text(), f.name);
    }

    if (f.type === 'application/pdf' || f.type.startsWith('image/')) {
      return analyserFichierParIA(f);
    }

    setErreur(`Type de fichier non reconnu : ${f.type || nom}. `
      + 'CSV, TSV, texte, PDF ou image.');
  }

  /** Envoie le fichier à la passerelle et remplit le tableau de relecture. */
  async function analyserFichierParIA(f: File) {
    setAnalyse(true); setErreur(null); setRetouches({});
    try {
      const lignes = await demanderIAFichier<{
        reference: string | null; designation: string; description: string | null;
        unite: string; prix_achat_ht: number | null; prix_vente_ht: number | null;
        famille: Famille; nature: Nature;
      }[]>('catalogue', f);

      const lues = lignes
        .filter((l) => l.designation?.trim())
        .map((l, i) => ({
          cle: `ia${i}`,
          garde: true,
          reference: l.reference ?? '',
          designation: l.designation.trim(),
          description: l.description ?? '',
          unite: l.unite || 'U',
          famille: FAMILLES.includes(l.famille) ? l.famille : familleDefaut,
          nature: (['fourniture', 'pose', 'deplacement'] as Nature[]).includes(l.nature)
            ? l.nature : natureDepuis(l.designation),
          achat: l.prix_achat_ht,
          vente: l.prix_vente_ht,
        }));

      if (lues.length === 0) {
        setErreur('Le modèle n’a rien reconnu dans ce fichier. '
          + 'S’il s’agit d’un scan, vérifiez qu’il est lisible.');
      } else {
        setParIA(lues);
        setTexte(' ');
        setTableau(null);
        setNomFichier(`${f.name} — lu par l’IA`);
      }
    } catch (e) {
      setErreur(e instanceof IANonConfiguree
        ? `${(e as Error).message} En attendant, un CSV se lit sans elle.`
        : (e as Error).message);
    }
    setAnalyse(false);
  }

  const lus = useMemo<Brouillon[]>(() => {
    // Ce que le modèle a lu prend le pas sur la lecture par règles : on ne
    // l'appelle que quand les règles n'ont pas suffi.
    if (parIA) return parIA;
    if (texte) return lignesDepuisTexte(texte, familleDefaut);
    if (!tableau) return [];

    const valeur = (ligne: string[], champ: string) => {
      const i = correspondance[champ];
      return i === undefined ? '' : (ligne[i] ?? '').trim();
    };

    return tableau.lignes.flatMap((ligne, i) => {
      const designation = valeur(ligne, 'designation');
      if (!designation) return [];
      const brute = `${designation} ${valeur(ligne, 'famille')}`;
      return [{
        cle: `c${i}`,
        garde: true,
        reference: valeur(ligne, 'reference'),
        designation,
        description: valeur(ligne, 'description'),
        unite: valeur(ligne, 'unite') || 'U',
        famille: familleDepuis(brute, familleDefaut),
        nature: natureDepuis(designation),
        achat: nombre(valeur(ligne, 'achat')),
        vente: nombre(valeur(ligne, 'vente')),
      }];
    });
  }, [tableau, texte, correspondance, familleDefaut, parIA]);

  /**
   * Les prix, une fois le sens de lecture appliqué.
   *
   * Un catalogue fournisseur donne des prix d'achat, un devis des prix de
   * vente. Le coefficient permet de fabriquer le prix manquant à la volée,
   * ce qui évite de reprendre à la main des centaines de lignes.
   */
  const coef = nombre(coefficient);
  const preparees = useMemo(() => lus.map((b) => {
    const r = { ...b, ...(retouches[b.cle] ?? {}) };
    let { achat, vente } = r;
    if (sens === 'achat') {
      if (achat == null) achat = vente;
      vente = coef && achat != null ? Math.round(achat * coef * 100) / 100 : (r.vente ?? 0);
    } else if (coef && achat == null && vente != null) {
      achat = Math.round((vente / coef) * 100) / 100;
    }
    return { ...r, achat: achat ?? null, vente: vente ?? 0 };
  }), [lus, retouches, sens, coef]);

  const retenues = preparees.filter((b) => b.garde && b.designation.trim());
  const retoucher = (cle: string, patch: Partial<Brouillon>) =>
    setRetouches((r) => ({ ...r, [cle]: { ...(r[cle] ?? {}), ...patch } }));

  async function creer() {
    setEncours(true); setErreur(null);
    const lot: ProduitImporte[] = retenues.map((b) => ({
      reference: b.reference.trim() || null,
      designation: b.designation.trim(),
      description: b.description.trim() || null,
      famille: b.famille,
      nature: b.nature,
      unite: b.unite.trim() || 'U',
      prix_achat_ht: b.achat,
      prix_vente_ht: b.vente ?? 0,
    }));
    try {
      setResultat(await importerProduitsBrouillon(lot, texte ? 'analyse_texte' : 'import_csv'));
    } catch (e) { setErreur((e as Error).message); }
    setEncours(false);
  }

  return (
    <>
      <FilAriane etapes={[
        { libelle: 'Aujourd’hui', vers: '/bord' },
        { libelle: 'Catalogue', vers: '/catalogue' },
        { libelle: 'Remplir le catalogue' },
      ]} />

      <div className="entete">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="action discret" onClick={() => aller('/catalogue')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 18l-6-6 6-6" />
            </svg>
            Catalogue
          </button>
          <h1>Remplir le catalogue</h1>
        </div>
        {(tableau || texte) && (
          <button className="action discret" onClick={recommencer}>Recommencer</button>
        )}
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {resultat ? (
        <>
          <div className="panneau" style={{ display: 'block' }}>
            <h2 style={{ marginBottom: 8 }}>
              {resultat.crees} brouillon{resultat.crees > 1 ? 's' : ''} créé{resultat.crees > 1 ? 's' : ''}
            </h2>
            <p className="statut">
              Ils n’apparaissent ni au catalogue ni dans le sélecteur de lignes de devis :
              relisez-les d’abord, puis publiez ceux qui tiennent. Les prix d’achat manquants
              se voient tout de suite, et ce sont eux qui font la marge.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="action" onClick={() => aller('/catalogue')}>
                Relire les brouillons
              </button>
              <button className="action discret" onClick={recommencer}>
                Importer un autre fichier
              </button>
            </div>
          </div>

          {resultat.ignores.length > 0 && (
            <>
              <h2 style={{ margin: '20px 0 8px' }}>
                {resultat.ignores.length} ligne{resultat.ignores.length > 1 ? 's' : ''} laissée{resultat.ignores.length > 1 ? 's' : ''} de côté
              </h2>
              <table>
                <thead><tr><th>Désignation</th><th style={{ width: 300 }}>Raison</th></tr></thead>
                <tbody>
                  {resultat.ignores.map((x, i) => (
                    <tr key={i}><td>{x.designation}</td><td className="statut">{x.raison}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="statut" style={{ marginTop: 8 }}>
                Une référence déjà présente au catalogue n’est jamais réécrite. Si le prix
                a changé, modifiez la référence existante : c’est elle que portent les
                anciens devis.
              </p>
            </>
          )}
        </>
      ) : !tableau && !texte ? (
        <>
          <div className="panneau" style={{ display: 'block' }}>
            <h2 style={{ marginBottom: 8 }}>Déposez un fichier</h2>
            <p className="statut" style={{ marginBottom: 12 }}>
              Un export de votre ancien logiciel, un tarif fournisseur, un devis reçu.
              Batinium choisit tout seul comment le lire : un tableau se lit avec des
              règles, dans votre navigateur et sans rien envoyer ; un PDF ou une photo
              partent au modèle, parce qu’aucune règle ne sait les découper.
            </p>

            <label className="depot" style={{ display: 'block', textAlign: 'center',
                                              padding: 26 }}>
              <input type="file" style={{ display: 'none' }}
                     accept=".csv,.tsv,.txt,.pdf,image/*,text/csv,application/pdf"
                     onChange={(e) => void lireFichier(e.target.files?.[0])} />
              {analyse ? 'Lecture en cours…' : 'Choisir un fichier'}
            </label>

            <p className="statut" style={{ marginTop: 12 }}>
              <strong>CSV, TSV, texte</strong> — lu sur place, instantané, rien ne sort.<br />
              <strong>PDF, photo</strong> — lu par le modèle. Nécessite la passerelle IA.<br />
              <strong>Excel</strong> — enregistrez d’abord en CSV : « Fichier », « Enregistrer
              sous », « CSV (séparateur point-virgule) ». Un clic de plus, et le tableau
              est lu sans appel payant ni envoi de vos tarifs.
            </p>
          </div>

          <div className="panneau" style={{ display: 'block',
                                            borderLeft: '3px solid var(--bleu)' }}>
            <h3 style={{ marginBottom: 6 }}>Rien n’est publié directement</h3>
            <p className="statut">
              Quelle que soit la lecture, les références arrivent en <strong>brouillon</strong> :
              invisibles du catalogue et du sélecteur de lignes de devis tant qu’elles n’ont
              pas été relues. Une lecture automatique se trompe — et une erreur qui s’écrit
              toute seule dans un catalogue se retrouve ensuite dans tous les devis.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="panneau" style={{ display: 'block' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'end', flexWrap: 'wrap' }}>
              <span className="statut" style={{ minWidth: 200, paddingBottom: 7 }}>
                {nomFichier} — {tableau
                  ? `${tableau.lignes.length} lignes, ${tableau.entetes.length} colonnes`
                  : 'lecture ligne à ligne'}
              </span>
              <div style={{ width: 200 }}>
                <label>Les prix lus sont</label>
                <select value={sens} onChange={(e) => setSens(e.target.value as 'vente' | 'achat')}>
                  <option value="vente">des prix de vente</option>
                  <option value="achat">des prix d’achat</option>
                </select>
              </div>
              <div style={{ width: 150 }}>
                <label>Coefficient</label>
                <input type="number" step="0.01" className="num" placeholder="1,35"
                       value={coefficient} onChange={(e) => setCoefficient(e.target.value)} />
              </div>
              <div style={{ width: 180 }}>
                <label>Famille par défaut</label>
                <select value={familleDefaut}
                        onChange={(e) => setFamilleDefaut(e.target.value as Famille)}>
                  {FAMILLES.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
            <p className="statut" style={{ marginTop: 8 }}>
              {sens === 'achat'
                ? 'Le prix de vente sera calculé en appliquant le coefficient au prix d’achat.'
                : 'Le prix d’achat sera déduit du prix de vente si un coefficient est donné. Sans prix d’achat, la marge de ces références restera invisible.'}
            </p>
          </div>

          {tableau && (
            <div className="panneau" style={{ display: 'block' }}>
              <h3 style={{ marginBottom: 8 }}>Colonnes reconnues</h3>
              <div style={{ display: 'grid', gap: 10,
                            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
                {Object.keys(SYNONYMES).map((champ) => (
                  <div key={champ}>
                    <label>
                      {champ === 'vente' ? 'Prix de vente'
                        : champ === 'achat' ? 'Prix d’achat'
                        : champ.charAt(0).toUpperCase() + champ.slice(1)}
                      {champ === 'designation' && ' (obligatoire)'}
                    </label>
                    <select value={correspondance[champ] ?? ''}
                            onChange={(e) => setCorrespondance((c) => {
                              const n = { ...c };
                              if (e.target.value === '') delete n[champ];
                              else n[champ] = Number(e.target.value);
                              return n;
                            })}>
                      <option value="">—</option>
                      {tableau.entetes.map((h, i) => (
                        <option key={i} value={i}>{h || `Colonne ${i + 1}`}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 style={{ margin: '20px 0 8px' }}>
            {retenues.length} référence{retenues.length > 1 ? 's' : ''} à créer en brouillon
          </h2>

          {preparees.length === 0 ? (
            <div className="vide">
              Rien de reconnu. Si c’est un tableau, indiquez la colonne de désignation
              ci-dessus ; si c’est un texte, vérifiez que chaque ligne porte un prix.
            </div>
          ) : (
            <div className="tableau-defilant">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 34 }} />
                    <th style={{ width: 130 }}>Référence</th>
                    <th>Désignation</th>
                    <th style={{ width: 130 }}>Famille</th>
                    <th style={{ width: 110 }}>Nature</th>
                    <th style={{ width: 60 }}>Unité</th>
                    <th className="num" style={{ width: 105 }}>Achat HT</th>
                    <th className="num" style={{ width: 105 }}>Vente HT</th>
                    <th className="num" style={{ width: 80 }}>Marge</th>
                  </tr>
                </thead>
                <tbody>
                  {preparees.map((b) => {
                    const marge = b.achat != null && b.vente
                      ? ((b.vente - b.achat) / b.vente) * 100 : null;
                    return (
                      <tr key={b.cle} style={b.garde ? undefined : { opacity: 0.45 }}>
                        <td>
                          <input type="checkbox" style={{ width: 'auto' }} checked={b.garde}
                                 aria-label="Retenir cette ligne"
                                 onChange={(e) => retoucher(b.cle, { garde: e.target.checked })} />
                        </td>
                        <td>
                          <input value={b.reference} placeholder="auto"
                                 onChange={(e) => retoucher(b.cle, { reference: e.target.value })}
                                 style={{ padding: '3px 5px', fontSize: 12 }} />
                        </td>
                        <td>
                          <input value={b.designation}
                                 onChange={(e) => retoucher(b.cle, { designation: e.target.value })}
                                 style={{ padding: '3px 5px' }} />
                        </td>
                        <td>
                          <select value={b.famille} style={{ padding: '3px 5px', fontSize: 12 }}
                                  onChange={(e) => retoucher(b.cle,
                                    { famille: e.target.value as Famille })}>
                            {FAMILLES.map((f) => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </td>
                        <td>
                          <select value={b.nature} style={{ padding: '3px 5px', fontSize: 12 }}
                                  onChange={(e) => retoucher(b.cle,
                                    { nature: e.target.value as Nature })}>
                            <option value="fourniture">Fourniture</option>
                            <option value="pose">Pose</option>
                            <option value="deplacement">Déplacement</option>
                          </select>
                        </td>
                        <td>
                          <input value={b.unite}
                                 onChange={(e) => retoucher(b.cle, { unite: e.target.value })}
                                 style={{ padding: '3px 5px', fontSize: 12 }} />
                        </td>
                        <td>
                          <input type="number" step="0.01" className="num" value={b.achat ?? ''}
                                 onChange={(e) => retoucher(b.cle, {
                                   achat: e.target.value ? Number(e.target.value) : null })}
                                 style={{ padding: '3px 5px' }} />
                        </td>
                        <td>
                          <input type="number" step="0.01" className="num" value={b.vente ?? ''}
                                 onChange={(e) => retoucher(b.cle, {
                                   vente: e.target.value ? Number(e.target.value) : null })}
                                 style={{ padding: '3px 5px' }} />
                        </td>
                        <td className="num statut">
                          {marge != null ? `${marge.toFixed(0)} %` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 14,
                        flexWrap: 'wrap' }}>
            <button className="action" disabled={encours || retenues.length === 0}
                    onClick={() => void creer()}>
              {encours ? 'Création…' : `Créer ${retenues.length} brouillon${retenues.length > 1 ? 's' : ''}`}
            </button>
            <span className="statut">
              Vente cumulée {eur(retenues.reduce((s, b) => s + (b.vente ?? 0), 0))}.
              {' '}{retenues.filter((b) => b.achat == null).length} référence(s) sans prix d’achat.
            </span>
          </div>
        </>
      )}
    </>
  );
}
