import { useMemo, useState } from 'react';
import { aller } from '../lib/router';
import { deviner, lireCsv, nombre, date as lireDate, type Tableau } from '../lib/csv';
import { importerDevis, type DevisImporte, type ResultatImport } from '../lib/db';

/**
 * Reprise des devis d'un autre logiciel.
 *
 * Le format n'est pas imposé : on lit le fichier, on montre ce qu'on a compris,
 * et on laisse corriger la correspondance des colonnes avant d'écrire quoi que
 * ce soit. Un import qui devine sans montrer est un import qu'on ne peut pas
 * vérifier.
 */

const CHAMPS: { cle: string; libelle: string; obligatoire?: boolean; aide?: string }[] = [
  { cle: 'numero',      libelle: 'Numéro du devis d’origine', obligatoire: true,
    aide: 'Le numéro tel qu’il figurait dans votre ancien logiciel. Il regroupe les lignes : toutes celles qui le portent forment un même devis.' },
  { cle: 'date',        libelle: 'Date d’émission' },
  { cle: 'client',      libelle: 'Nom du client', obligatoire: true },
  { cle: 'email',       libelle: 'E-mail du client' },
  { cle: 'telephone',   libelle: 'Téléphone' },
  { cle: 'adresse',     libelle: 'Adresse du chantier' },
  { cle: 'code_postal', libelle: 'Code postal' },
  { cle: 'ville',       libelle: 'Ville' },
  { cle: 'objet',       libelle: 'Objet du devis' },
  { cle: 'lot',         libelle: 'Lot' },
  { cle: 'sous_lot',    libelle: 'Sous-lot' },
  { cle: 'designation', libelle: 'Désignation', obligatoire: true },
  { cle: 'description', libelle: 'Description' },
  { cle: 'quantite',    libelle: 'Quantité', obligatoire: true },
  { cle: 'unite',       libelle: 'Unité' },
  { cle: 'prix',        libelle: 'Prix unitaire HT', obligatoire: true },
  { cle: 'tva',         libelle: 'Taux de TVA' },
];

const SYNONYMES: Record<string, string[]> = {
  numero: ['numero', 'numdevis', 'ndevis', 'reference', 'refdevis', 'piece', 'document'],
  date: ['date', 'dateemission', 'dateedition', 'datedudevis'],
  client: ['client', 'nomclient', 'raisonsociale', 'tiers', 'destinataire'],
  email: ['email', 'mail', 'courriel'],
  telephone: ['telephone', 'tel', 'portable', 'mobile'],
  adresse: ['adresse', 'adressechantier', 'rue', 'voie'],
  code_postal: ['codepostal', 'cp'],
  ville: ['ville', 'commune'],
  objet: ['objet', 'titre', 'libelledevis', 'intitule'],
  lot: ['lot', 'chapitre', 'categorie', 'poste'],
  sous_lot: ['souslot', 'souschapitre', 'sousposte'],
  designation: ['designation', 'libelle', 'produit', 'article', 'prestation'],
  description: ['description', 'detail', 'commentaire', 'notes'],
  quantite: ['quantite', 'qte', 'qty', 'nombre'],
  unite: ['unite', 'un', 'unitemesure'],
  prix: ['prixunitaire', 'puht', 'pu', 'prixht', 'prixunitaireht', 'tarif'],
  tva: ['tva', 'tauxtva', 'txtva'],
};

export default function PageImport() {
  const [tableau, setTableau] = useState<Tableau | null>(null);
  const [nomFichier, setNomFichier] = useState('');
  const [correspondance, setCorrespondance] = useState<Record<string, number>>({});
  const [statutParDefaut, setStatutParDefaut] = useState<'signe' | 'refuse' | 'expire'>('signe');
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<ResultatImport | null>(null);
  const [encours, setEncours] = useState(false);
  const [colle, setColle] = useState('');

  function analyser(texte: string, nom: string) {
    setErreur(null); setResultat(null);
    const t = lireCsv(texte);
    if (t.entetes.length < 2) {
      return setErreur('Ce fichier ne ressemble pas à un tableau. Exportez en CSV depuis Excel ou votre ancien logiciel.');
    }
    setTableau(t);
    setNomFichier(nom);

    // Correspondance devinée d'après les en-têtes
    const auto: Record<string, number> = {};
    t.entetes.forEach((h, i) => {
      const champ = deviner(h, SYNONYMES);
      if (champ && auto[champ] === undefined) auto[champ] = i;
    });
    setCorrespondance(auto);
  }

  async function lireFichier(f: File | undefined) {
    if (!f) return;
    const texte = await f.text();
    analyser(texte, f.name);
  }

  const valeur = (ligne: string[], champ: string): string | undefined => {
    const i = correspondance[champ];
    return i === undefined ? undefined : ligne[i];
  };

  // Regroupement des lignes en devis, dans l'ordre du fichier
  const devisPrepares = useMemo<DevisImporte[]>(() => {
    if (!tableau) return [];
    const carte = new Map<string, DevisImporte>();

    for (const ligne of tableau.lignes) {
      const numero = (valeur(ligne, 'numero') ?? '').trim();
      const designation = (valeur(ligne, 'designation') ?? '').trim();
      if (!numero || !designation) continue;

      if (!carte.has(numero)) {
        carte.set(numero, {
          numero,
          date_emission: lireDate(valeur(ligne, 'date')),
          client: (valeur(ligne, 'client') ?? '').trim(),
          email: valeur(ligne, 'email') || null,
          telephone: valeur(ligne, 'telephone') || null,
          adresse: valeur(ligne, 'adresse') || null,
          code_postal: valeur(ligne, 'code_postal') || null,
          ville: valeur(ligne, 'ville') || null,
          objet: valeur(ligne, 'objet') || null,
          statut: statutParDefaut,
          lignes: [],
        });
      }

      carte.get(numero)!.lignes.push({
        lot: valeur(ligne, 'lot') || null,
        sous_lot: valeur(ligne, 'sous_lot') || null,
        designation,
        description: valeur(ligne, 'description') || null,
        quantite: nombre(valeur(ligne, 'quantite')) ?? 1,
        unite: valeur(ligne, 'unite') || 'U',
        prix_unitaire_ht: nombre(valeur(ligne, 'prix')) ?? 0,
        taux_tva: nombre(valeur(ligne, 'tva')),
      });
    }
    return [...carte.values()];
  }, [tableau, correspondance, statutParDefaut]);

  const manquants = CHAMPS.filter((c) => c.obligatoire && correspondance[c.cle] === undefined);
  const totalHt = devisPrepares.reduce((s, d) =>
    s + d.lignes.reduce((x, l) => x + l.quantite * l.prix_unitaire_ht, 0), 0);

  async function lancer() {
    setEncours(true); setErreur(null);
    try { setResultat(await importerDevis(devisPrepares)); }
    catch (e) { setErreur((e as Error).message); }
    setEncours(false);
  }

  return (
    <>
      <div className="entete">
        <h1>Importer d’anciens devis</h1>
        {tableau && (
          <button className="action discret" onClick={() => {
            setTableau(null); setResultat(null); setColle('');
          }}>Recommencer</button>
        )}
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {!tableau && (
        <>
          <div className="panneau" style={{ display: 'block' }}>
            <h2 style={{ marginBottom: 8 }}>Le fichier</h2>
            <p className="statut" style={{ marginBottom: 12 }}>
              Un fichier CSV, avec une ligne par ligne de devis. Depuis Tolteck, Excel ou
              n’importe quel tableur : « Enregistrer sous », puis « CSV ». Les colonnes
              peuvent porter n’importe quel intitulé, elles seront reconnues ou corrigées
              à l’étape suivante.
            </p>
            <input type="file" accept=".csv,.tsv,.txt,text/csv"
                   onChange={(e) => void lireFichier(e.target.files?.[0])} />
          </div>

          <div className="panneau" style={{ display: 'block' }}>
            <h2 style={{ marginBottom: 8 }}>Ou coller directement</h2>
            <p className="statut" style={{ marginBottom: 8 }}>
              Sélectionnez les cellules dans Excel, copiez, collez ici. Le séparateur
              est deviné tout seul.
            </p>
            <textarea rows={7} value={colle} onChange={(e) => setColle(e.target.value)}
                      placeholder={'Numéro;Date;Client;Désignation;Qté;PU HT\\nDEV-2025-014;12/03/2025;M. Durand;Mono-split 2,5 kW;1;1290'} />
            <button className="action" style={{ marginTop: 10 }} disabled={!colle.trim()}
                    onClick={() => analyser(colle, 'collé')}>
              Analyser
            </button>
          </div>

          <div className="panneau" style={{ display: 'block', borderLeft: '3px solid var(--bleu)' }}>
            <h3 style={{ marginBottom: 6 }}>Ce que l’import fait, et ce qu’il ne fait pas</h3>
            <p className="statut">
              <strong>Le numéro du devis dans votre ancien logiciel est conservé tel quel.</strong>{' '}
              Si Tolteck avait émis « DEV-2026/07-0056 », le devis portera ce numéro exact
              dans Batinium, et non un nouveau. C’est ce qui permet de retrouver l’archive
              papier ou l’écriture comptable correspondante.
            </p>
            <p className="statut">
              Un numéro déjà présent dans Batinium est ignoré, jamais écrasé. Le taux de TVA
              du fichier est repris et marqué comme forcé, parce que c’est celui qui a
              réellement été facturé : le moteur ne le recalcule pas rétroactivement.
              Les clients absents sont créés, ceux qui existent sont retrouvés par leur nom.
            </p>
          </div>
        </>
      )}

      {tableau && !resultat && (
        <>
          <div className="panneau" style={{ display: 'block' }}>
            <h2 style={{ marginBottom: 8 }}>Correspondance des colonnes</h2>
            <p className="statut" style={{ marginBottom: 12 }}>
              {nomFichier} · {tableau.lignes.length} lignes · séparateur «{' '}
              {tableau.separateur === '\t' ? 'tabulation' : tableau.separateur} ».
              Vérifiez chaque ligne : ce qui est mal associé sera mal importé.
            </p>

            <table>
              <thead>
                <tr><th style={{ width: 230 }}>Champ Batinium</th>
                  <th style={{ width: 280 }}>Colonne du fichier</th>
                  <th>Exemple lu</th></tr>
              </thead>
              <tbody>
                {CHAMPS.map((c) => {
                  const i = correspondance[c.cle];
                  const exemple = i === undefined ? '' : tableau.lignes[0]?.[i] ?? '';
                  const absent = c.obligatoire && i === undefined;
                  return (
                    <tr key={c.cle} style={absent ? { background: '#fdf3f2' } : undefined}>
                      <td>
                        {c.libelle}
                        {c.obligatoire && <span style={{ color: 'var(--alerte)' }}> *</span>}
                        {c.aide && <div className="fiche">{c.aide}</div>}
                      </td>
                      <td>
                        <select value={i ?? ''} onChange={(e) => setCorrespondance((m) => {
                          const n = { ...m };
                          if (e.target.value === '') delete n[c.cle];
                          else n[c.cle] = Number(e.target.value);
                          return n;
                        })}>
                          <option value="">— non importé —</option>
                          {tableau.entetes.map((h, j) => (
                            <option key={j} value={j}>{h || `Colonne ${j + 1}`}</option>
                          ))}
                        </select>
                      </td>
                      <td className="ref">{exemple}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ display: 'flex', gap: 12, alignItems: 'end', marginTop: 14 }}>
              <div style={{ width: 240 }}>
                <label>Statut à donner aux devis importés</label>
                <select value={statutParDefaut}
                        onChange={(e) => setStatutParDefaut(e.target.value as typeof statutParDefaut)}>
                  <option value="signe">Signés</option>
                  <option value="refuse">Refusés</option>
                  <option value="expire">Expirés</option>
                </select>
              </div>
              <p className="statut" style={{ flex: 1 }}>
                Il s’agit d’archives : les marquer « signés » évite qu’ils remontent
                dans les devis à relancer.
              </p>
            </div>
          </div>

          {manquants.length > 0 ? (
            <div className="erreur">
              Champs obligatoires non associés : {manquants.map((c) => c.libelle).join(', ')}.
            </div>
          ) : (
            <>
              <h2 style={{ margin: '20px 0 8px' }}>Ce qui sera créé</h2>
              <div style={{ display: 'grid', gap: 12, marginBottom: 12,
                            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                <Chiffre libelle="Devis" valeur={devisPrepares.length} />
                <Chiffre libelle="Lignes"
                         valeur={devisPrepares.reduce((s, d) => s + d.lignes.length, 0)} />
                <Chiffre libelle="Clients distincts"
                         valeur={new Set(devisPrepares.map((d) => d.client.toLowerCase())).size} />
                <Chiffre libelle="Total HT"
                         valeur={totalHt.toLocaleString('fr-FR', {
                           minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'} />
              </div>

              <table>
                <thead>
                  <tr><th>Numéro</th><th>Date</th><th>Client</th><th>Objet</th>
                    <th className="num">Lignes</th><th className="num">Total HT</th></tr>
                </thead>
                <tbody>
                  {devisPrepares.slice(0, 30).map((d) => {
                    const ht = d.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht, 0);
                    return (
                      <tr key={d.numero}>
                        <td>{d.numero}</td>
                        <td className="num ref">
                          {d.date_emission
                            ? new Date(d.date_emission).toLocaleDateString('fr-FR')
                            : <span style={{ color: 'var(--alerte)' }}>date illisible</span>}
                        </td>
                        <td>{d.client || <span style={{ color: 'var(--alerte)' }}>sans client</span>}</td>
                        <td>{d.objet ?? '—'}</td>
                        <td className="num">{d.lignes.length}</td>
                        <td className="num">
                          {ht.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {devisPrepares.length > 30 && (
                <p className="statut" style={{ marginTop: 8 }}>
                  Les 30 premiers sont affichés, les {devisPrepares.length} seront importés.
                </p>
              )}

              <button className="action" style={{ marginTop: 14 }} disabled={encours}
                      onClick={() => void lancer()}>
                {encours ? 'Import en cours…' : `Importer ${devisPrepares.length} devis`}
              </button>
            </>
          )}
        </>
      )}

      {resultat && (
        <div className="panneau" style={{ display: 'block',
                                          borderLeft: `3px solid ${resultat.crees > 0 ? 'var(--vert)' : 'var(--alerte)'}` }}>
          <h2 style={{ marginBottom: 8 }}>Import terminé</h2>
          <p>
            {resultat.crees} devis créé{resultat.crees > 1 ? 's' : ''},{' '}
            {resultat.clientsCrees} client{resultat.clientsCrees > 1 ? 's' : ''} ajouté
            {resultat.clientsCrees > 1 ? 's' : ''}.
          </p>

          {resultat.ignores.length > 0 && (
            <>
              <h3 style={{ margin: '12px 0 6px' }}>
                {resultat.ignores.length} ligne{resultat.ignores.length > 1 ? 's' : ''} écartée
                {resultat.ignores.length > 1 ? 's' : ''}
              </h3>
              <table>
                <thead><tr><th>Numéro</th><th>Raison</th></tr></thead>
                <tbody>
                  {resultat.ignores.slice(0, 40).map((x, i) => (
                    <tr key={i}><td>{x.numero}</td><td className="statut">{x.raison}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="action" onClick={() => aller('/devis')}>Voir les devis</button>
            <button className="action discret" onClick={() => {
              setTableau(null); setResultat(null); setColle('');
            }}>Importer un autre fichier</button>
          </div>
        </div>
      )}
    </>
  );
}

function Chiffre({ libelle, valeur }: { libelle: string; valeur: number | string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--filet)',
                  padding: '12px 14px' }}>
      <div className="statut">{libelle}</div>
      <div className="num" style={{ fontSize: 23, fontWeight: 600, textAlign: 'left' }}>
        {valeur}
      </div>
    </div>
  );
}
