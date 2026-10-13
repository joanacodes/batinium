import { useCallback, useEffect, useState } from 'react';
import { estDirection } from '../lib/session';
import {
  exporterTout, manifesteFichiers, metaExport, nomFichier, TABLES, telecharger, versCsv,
  type ResultatTable,
} from '../lib/export';
import {
  anonymiserTiers, listerEffacements, listerTiers, porteeEffacement, purgerJournalIA,
  type Effacement,
} from '../lib/db';
import type { Tiers } from '../lib/types';

/**
 * Les données : les sortir, les effacer, expliquer ce qu'on garde.
 *
 * Un écran de conformité qui ne serait qu'un texte n'aurait aucune valeur :
 * ce qui compte, c'est de pouvoir faire les gestes. Sortir ses données à tout
 * moment, effacer ce qu'on a le droit d'effacer, et montrer ce qu'on garde et
 * pourquoi.
 */
export default function PageDonnees() {
  const [onglet, setOnglet] = useState<'export' | 'effacement' | 'registre'>('export');
  const [erreur, setErreur] = useState<string | null>(null);

  return (
    <>
      <div className="entete"><h1>Données</h1></div>
      {erreur && <div className="erreur">{erreur}</div>}

      <div className="onglets">
        <button aria-current={onglet === 'export'} onClick={() => setOnglet('export')}>
          Exporter
        </button>
        <button aria-current={onglet === 'effacement'} onClick={() => setOnglet('effacement')}>
          Droit à l’effacement
        </button>
        <button aria-current={onglet === 'registre'} onClick={() => setOnglet('registre')}>
          Ce que Batinium conserve
        </button>
      </div>

      {onglet === 'export' ? <Export onErreur={setErreur} />
        : onglet === 'effacement' ? <Effacer onErreur={setErreur} />
        : <Registre />}
    </>
  );
}

// --- Export -----------------------------------------------------------------

function Export({ onErreur }: { onErreur: (m: string) => void }) {
  const [progres, setProgres] = useState<string | null>(null);
  const [dernier, setDernier] = useState<ResultatTable[] | null>(null);

  async function manifeste() {
    setProgres('Signature des liens…');
    try {
      const liste = await manifesteFichiers();
      if (liste.length === 0) onErreur('Aucun fichier joint pour l’instant.');
      else telecharger(nomFichier('fichiers', 'csv'), versCsv(liste), 'text/csv');
    } catch (e) { onErreur((e as Error).message); }
    setProgres(null);
  }

  async function exporter(format: 'json' | 'csv') {
    setProgres('Préparation…');
    try {
      const tables = await exporterTout((nom, i, total) =>
        setProgres(`${nom} — ${i} sur ${total}`));
      setDernier(tables);

      if (format === 'json') {
        const contenu: Record<string, unknown> = { _export: metaExport(tables) };
        for (const t of tables) contenu[t.nom] = t.lignes;
        telecharger(nomFichier('export', 'json'),
          JSON.stringify(contenu, null, 2), 'application/json');
      }
    } catch (e) { onErreur((e as Error).message); }
    setProgres(null);
  }

  return (
    <>
      <div className="panneau" style={{ display: 'block' }}>
        <h3 style={{ marginBottom: 8 }}>Tout sortir</h3>
        <p className="statut" style={{ marginBottom: 12 }}>
          Un fichier JSON contenant l’intégralité de vos données : clients, devis,
          factures, chantiers, heures, achats. C’est le format qu’exige l’article 20
          du RGPD pour la portabilité, et c’est aussi votre assurance — une
          application de gestion dont on ne peut pas extraire ses données est un
          piège, quelle que soit la qualité du reste.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="action" disabled={!!progres} onClick={() => void exporter('json')}>
            {progres ? 'Export en cours…' : 'Exporter tout en JSON'}
          </button>
          {progres && <span className="statut">{progres}</span>}
        </div>
      </div>

      <div className="panneau" style={{ display: 'block' }}>
        <h3 style={{ marginBottom: 8 }}>Les fichiers joints</h3>
        <p className="statut" style={{ marginBottom: 12 }}>
          Photos de chantier, attestations, scans de factures : ce sont des mégaoctets
          de binaire, ils ne peuvent pas entrer dans un JSON, et le navigateur ne sait
          pas fabriquer une archive sans dépendance. Le manifeste donne la liste
          complète avec, pour chaque fichier, un lien de téléchargement{' '}
          <strong>valable trois semaines</strong> — de quoi les récupérer un par un, ou en
          lot avec n’importe quel outil.
        </p>
        <button className="action discret" disabled={!!progres}
                onClick={() => void manifeste()}>
          Télécharger le manifeste des fichiers
        </button>
        <p className="statut" style={{ marginTop: 10 }}>
          Pour tout récupérer d’un coup, la ligne de commande Supabase le fait aussi :
        </p>
        <pre className="bloc-code">{`npx supabase storage cp -r ss://documents ./fichiers
npx supabase storage cp -r ss://catalogue ./photos-catalogue`}</pre>
      </div>

      <h2 style={{ margin: '20px 0 8px' }}>Table par table, pour Excel</h2>
      <p className="statut" style={{ marginBottom: 10 }}>
        Séparateur point-virgule : c’est celui qu’attend Excel en français. Avec une
        virgule, tout arrive dans une seule colonne et l’export a l’air cassé.
      </p>
      <div className="tableau-defilant">
        <table>
          <thead>
            <tr>
              <th>Table</th>
              <th className="num" style={{ width: 100 }}>Lignes</th>
              <th style={{ width: 130 }} className="sans-impression" />
            </tr>
          </thead>
          <tbody>
            {TABLES.map((t) => {
              const resultat = dernier?.find((x) => x.nom === t.nom);
              return (
                <tr key={t.nom}>
                  <td>
                    {t.libelle}
                    <div className="ref">{t.nom}</div>
                    {resultat?.erreur && (
                      <div className="statut" style={{ color: 'var(--alerte)' }}>
                        Non lisible avec vos droits
                      </div>
                    )}
                  </td>
                  <td className="num">
                    {resultat ? resultat.lignes.length : <span className="statut">—</span>}
                  </td>
                  <td className="sans-impression">
                    {resultat && resultat.lignes.length > 0 && (
                      <button className="action discret" style={{ padding: '2px 9px' }}
                              onClick={() => telecharger(nomFichier(t.nom, 'csv'),
                                versCsv(resultat.lignes), 'text/csv')}>
                        CSV
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!dernier && (
        <p className="statut" style={{ marginTop: 8 }}>
          Lancez d’abord l’export ci-dessus : les comptes et les boutons CSV
          apparaîtront ensuite.
        </p>
      )}
    </>
  );
}

// --- Droit à l'effacement ---------------------------------------------------

function Effacer({ onErreur }: { onErreur: (m: string) => void }) {
  const [clients, setClients] = useState<Tiers[]>([]);
  const [cible, setCible] = useState<Tiers | null>(null);
  const [motif, setMotif] = useState('');
  const [resultat, setResultat] = useState<string | null>(null);
  const [travail, setTravail] = useState(false);
  const [portee, setPortee] = useState<
    { factures: number; devis: number; liberation: string | null } | null>(null);

  // La portée s'annonce avant le clic, pas après : un acte irréversible dont
  // on découvre l'étendue une fois fait est un piège.
  useEffect(() => {
    if (!cible) { setPortee(null); return; }
    porteeEffacement(cible.id).then(setPortee).catch(() => setPortee(null));
  }, [cible]);

  useEffect(() => {
    listerTiers().then(setClients).catch((e) => onErreur((e as Error).message));
  }, [onErreur]);

  if (!estDirection()) {
    return (
      <div className="vide">
        L’anonymisation d’une fiche relève de la direction. C’est un acte
        irréversible qui engage l’entreprise.
      </div>
    );
  }

  async function anonymiser() {
    if (!cible) return;
    setTravail(true);
    try {
      setResultat(await anonymiserTiers(cible.id, motif || null));
      setCible(null); setMotif('');
      listerTiers().then(setClients).catch(() => undefined);
    } catch (e) { onErreur((e as Error).message); }
    setTravail(false);
  }

  return (
    <>
      <div className="panneau" style={{ display: 'block', borderLeft: '3px solid #b8860b' }}>
        <h3 style={{ marginBottom: 6 }}>Effacer n’est pas supprimer</h3>
        <p className="statut">
          Le droit à l’effacement existe, mais il n’est pas absolu : l’article 17.3.b du
          RGPD réserve le cas d’une obligation légale, et l’article L. 123-22 du code de
          commerce impose de conserver les pièces comptables <strong>dix ans</strong>.
          Supprimer un client qui a une facture serait à la fois illégal et destructeur —
          la facture perdrait son destinataire et la série comptable son sens.
        </p>
        <p className="statut">
          Et il y a une raison de fond : <strong>une facture doit porter le nom et
          l’adresse de son destinataire</strong>. C’est une mention obligatoire. Effacer
          le nom d’un client facturé ne protège pas ses données, ça rend la facture non
          conforme et l’entreprise en défaut.
        </p>
        <p className="statut">
          Batinium fait donc deux choses différentes selon la fiche.{' '}
          <strong>Sans facture émise</strong> — un prospect, un client devisé mais jamais
          facturé — tout part : nom, coordonnées, adresses, notes.{' '}
          <strong>Avec facture émise</strong>, seul ce qui n’est pas exigé par la facture
          s’efface : e-mail, téléphone, notes, contraintes d’accès, transcriptions et
          enregistrements d’appel. Le nom et l’adresse restent jusqu’à la fin du délai de
          conservation, et Batinium vous dit à quelle date. C’est <strong>irréversible</strong>.
        </p>
      </div>

      {resultat && (
        <div className="panneau" style={{ display: 'block',
                                          borderLeft: '3px solid var(--vert)' }}>
          <strong>Fait.</strong> <span className="statut">{resultat}</span>
        </div>
      )}

      <div className="panneau" style={{ display: 'block' }}>
        <label>Fiche à anonymiser</label>
        <select value={cible?.id ?? ''}
                onChange={(e) => setCible(clients.find((c) => c.id === e.target.value) ?? null)}>
          <option value="">—</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.nom}{c.ville ? ` — ${c.ville}` : ''}</option>
          ))}
        </select>

        {portee && cible && (
          <div style={{ marginTop: 12, padding: 10,
                        borderLeft: `3px solid ${portee.factures > 0 ? '#b8860b' : 'var(--vert)'}`,
                        background: 'var(--papier)' }}>
            {portee.factures === 0 ? (
              <>
                <strong>Effacement complet possible.</strong>{' '}
                <span className="statut">
                  Aucune facture émise pour cette fiche
                  {portee.devis > 0 && `, ${portee.devis} devis qui resteront sans identité`}.
                  Le nom et les coordonnées disparaîtront.
                </span>
              </>
            ) : (
              <>
                <strong>Effacement partiel seulement.</strong>{' '}
                <span className="statut">
                  {portee.factures} facture(s) émise(s) : le nom et l’adresse doivent être
                  conservés
                  {portee.liberation &&
                    ` jusqu’au ${new Date(portee.liberation).toLocaleDateString('fr-FR')}`}.
                  E-mail, téléphone, notes, transcriptions et enregistrements seront
                  effacés dès maintenant.
                </span>
              </>
            )}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <label>Motif, consigné au registre</label>
          <input value={motif} placeholder="Demande du client par courriel du 3 septembre"
                 onChange={(e) => setMotif(e.target.value)} />
          <p className="statut">
            Un responsable de traitement doit pouvoir montrer ce qu’il a fait, quand,
            et à la demande de qui.
          </p>
        </div>

        <button className="action" style={{ marginTop: 12 }} disabled={!cible || travail}
                onClick={() => {
                  const message = portee && portee.factures > 0
                    ? `Effacement partiel de « ${cible?.nom} » ?\n\nLe nom et l’adresse `
                      + 'seront conservés : ce sont des mentions obligatoires de ses '
                      + 'factures. Tout le reste sera effacé. Irréversible.'
                    : `Anonymiser « ${cible?.nom} » ?\n\nSon identité et ses coordonnées `
                      + 'seront effacées. Irréversible.';
                  if (window.confirm(message)) void anonymiser();
                }}>
          {travail ? 'En cours…' : 'Anonymiser cette fiche'}
        </button>
      </div>
    </>
  );
}

// --- Ce que Batinium conserve ----------------------------------------------

const REGISTRE = [
  { quoi: 'Clients et prospects', pourquoi: 'Établir des devis, exécuter les chantiers',
    duree: '3 ans après le dernier contact pour un prospect, 10 ans après la dernière facture pour un client' },
  { quoi: 'Devis et factures', pourquoi: 'Obligation comptable et fiscale',
    duree: '10 ans (article L. 123-22 du code de commerce)' },
  { quoi: 'Appels et transcriptions', pourquoi: 'Qualifier une demande entrante',
    duree: 'Jusqu’à la clôture de la demande, effaçables à tout moment' },
  { quoi: 'Photos de chantier', pourquoi: 'Preuve de l’état des lieux et de l’exécution',
    duree: '10 ans, durée de la garantie décennale' },
  { quoi: 'Heures pointées', pourquoi: 'Suivi du temps et coût de revient',
    duree: '5 ans (article L. 3245-1 du code du travail)' },
  { quoi: 'Rémunérations', pourquoi: 'Prévisionnel de masse salariale',
    duree: '5 ans, direction seule' },
  { quoi: 'Documents de vigilance des sous-traitants', pourquoi: 'Obligation de vigilance',
    duree: '5 ans après la fin de la relation' },
  { quoi: 'Appels à l’assistant IA', pourquoi: 'Coût, explicabilité, traçabilité',
    duree: 'Contenu effacé au bout de 30 jours, trace conservée' },
];

function Registre() {
  const [effacements, setEffacements] = useState<Effacement[]>([]);
  const [purge, setPurge] = useState<number | null>(null);

  const recharger = useCallback(() => {
    listerEffacements().then(setEffacements).catch(() => setEffacements([]));
  }, []);
  useEffect(recharger, [recharger]);

  return (
    <>
      <p className="statut" style={{ marginBottom: 12 }}>
        Ce tableau est le point de départ d’un registre des traitements. Il décrit ce
        que Batinium conserve et pourquoi. Il ne remplace pas le registre que le RGPD
        impose de tenir : il vous donne de quoi l’écrire sans repartir de zéro.
      </p>

      <table>
        <thead>
          <tr>
            <th style={{ width: 240 }}>Donnée</th>
            <th>Pourquoi</th>
            <th style={{ width: 300 }}>Combien de temps</th>
          </tr>
        </thead>
        <tbody>
          {REGISTRE.map((r) => (
            <tr key={r.quoi}>
              <td><strong>{r.quoi}</strong></td>
              <td className="statut">{r.pourquoi}</td>
              <td className="statut">{r.duree}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ margin: '22px 0 8px' }}>Journal de l’assistant</h2>
      <div className="panneau" style={{ display: 'block' }}>
        <p className="statut" style={{ marginBottom: 10 }}>
          Chaque question posée à l’assistant est tracée avec son coût en jetons. Le
          contenu envoyé — qui peut contenir des noms et des adresses — s’efface à la
          demande, la trace reste pour le comptage.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="action discret"
                  onClick={() => void purgerJournalIA(30).then(setPurge).catch(() => setPurge(0))}>
            Effacer le contenu de plus de 30 jours
          </button>
          {purge != null && (
            <span className="statut">{purge} appel(s) purgé(s).</span>
          )}
        </div>
      </div>

      <h2 style={{ margin: '22px 0 8px' }}>Registre des effacements</h2>
      {effacements.length === 0 ? (
        <p className="statut">Aucune demande d’effacement traitée.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Traité le</th>
              <th style={{ width: 200 }}>Fiche</th>
              <th style={{ width: 240 }}>Motif</th>
              <th>Conservé, et pourquoi</th>
            </tr>
          </thead>
          <tbody>
            {effacements.map((e) => (
              <tr key={e.id}>
                <td className="num ref">
                  {new Date(e.traite_le).toLocaleDateString('fr-FR')}
                </td>
                <td>{e.nom_efface}</td>
                <td className="statut">{e.motif ?? '—'}</td>
                <td className="statut">{e.conserve ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
