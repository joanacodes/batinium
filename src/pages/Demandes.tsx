import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import {
  ajouterFil, creerDevis, devisDepuisModele, enregistrerDemande, enregistrerSite,
  enregistrerTiers, fusionnerDemandes, listerDemandes, listerDevis, marquerRepondu,
  supprimerDemande, type DemandeAvecTiers, type DevisAvecTiers,
} from '../lib/db';
import { estDirection, voitLesPrix } from '../lib/session';
import type { Demande } from '../lib/types';
import Modale from '../components/Modale';
import Bulle from '../components/Bulle';
import Dictee from '../components/Dictee';
import { IANonConfiguree } from '../lib/ia';
import { creerBrouillonDicte, lireDictee, type PropositionDevis } from '../lib/devisDicte';
import { audioDemande, compteRenduNoms, retrouverNomsAllo } from '../lib/connecteurs';

/**
 * Le nom à afficher : celui de la demande, sinon celui de la fiche client.
 *
 * Un appel d'un client connu arrive sans nom — Allô n'envoie que le numéro —
 * mais rattaché à sa fiche. Le nom y est déjà : on le lit, on ne le recopie
 * pas, et il suit la fiche si elle est corrigée.
 */
const nomDe = (d: DemandeAvecTiers): string | null => d.nom?.trim() || d.tiers?.nom || null;

const STATUTS: Record<Demande['statut'], string> = {
  nouvelle: 'Nouvelle', a_rappeler: 'À rappeler', qualifiee: 'Qualifiée',
  a_visiter: 'À visiter', devisee: 'Devisée', perdue: 'Perdue', spam: 'Écartée',
};

export default function PageDemandes() {
  const [demandes, setDemandes] = useState<DemandeAvecTiers[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const [saisie, setSaisie] = useState(false);
  const [filtre, setFiltre] = useState<'attente' | 'ouvertes' | 'toutes'>('attente');
  const [selection, setSelection] = useState<string[]>([]);
  const [recherche, setRecherche] = useState('');
  const [dicter, setDicter] = useState<DemandeAvecTiers | null>(null);
  const [deplies, setDeplies] = useState<Set<string>>(new Set());
  const [edition, setEdition] = useState<DemandeAvecTiers | null>(null);
  const [aDeviser, setADeviser] = useState<DemandeAvecTiers | null>(null);
  const [modeles, setModeles] = useState<DevisAvecTiers[]>([]);
  const [chercheNoms, setChercheNoms] = useState(false);
  const [retourNoms, setRetourNoms] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try { setDemandes(await listerDemandes()); }
    catch (e) { setErreur((e as Error).message); }
    setCharge(true);
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  /*
   * Rafraîchissement automatique.
   *
   * Un appel arrive pendant qu'on regarde l'écran : sans ça, il faut recharger
   * la page pour le voir, et on finit par ne plus regarder l'écran du tout.
   *
   * Deux déclencheurs plutôt qu'un. Le retour sur l'onglet couvre le cas le
   * plus fréquent — on décroche, on raccroche, on revient — et il ne coûte
   * rien. Le minuteur couvre le reste, à trente secondes : assez court pour
   * qu'un appel apparaisse pendant qu'on le termine, assez long pour ne pas
   * interroger la base deux mille fois par jour.
   *
   * On ne rafraîchit pas quand l'onglet est caché : recharger une page que
   * personne ne regarde, c'est de la dépense pure.
   */
  useEffect(() => {
    const rafraichir = () => { if (!document.hidden) void recharger(); };
    const minuteur = window.setInterval(rafraichir, 30_000);
    window.addEventListener('focus', rafraichir);
    document.addEventListener('visibilitychange', rafraichir);
    return () => {
      window.clearInterval(minuteur);
      window.removeEventListener('focus', rafraichir);
      document.removeEventListener('visibilitychange', rafraichir);
    };
  }, [recharger]);

  async function chercherNoms() {
    setChercheNoms(true); setRetourNoms(null);
    try {
      setRetourNoms(compteRenduNoms(await retrouverNomsAllo()));
      await recharger();
    } catch (e) { setErreur((e as Error).message); }
    setChercheNoms(false);
  }

  async function basculerRepondu(d: DemandeAvecTiers) {
    setDemandes((p) => p.map((x) => (x.id === d.id ? { ...x, repondu: !x.repondu } : x)));
    try { await marquerRepondu(d.id, !d.repondu); }
    catch (e) { setErreur((e as Error).message); void recharger(); }
  }

  async function patcher(d: DemandeAvecTiers, patch: Partial<Demande>) {
    setDemandes((p) => p.map((x) => (x.id === d.id ? { ...x, ...patch } : x)));
    try { await enregistrerDemande({ id: d.id, ...patch }); }
    catch (e) { setErreur((e as Error).message); }
  }

  /** Ouvre le choix : devis vierge, ou reprise d'un devis déjà fait. */
  async function proposerDevis(d: DemandeAvecTiers) {
    setADeviser(d);
    try { setModeles(await listerDevis()); }
    catch (e) { setErreur((e as Error).message); }
  }

  /** Une demande devient client + site + devis en un clic. */
  async function convertir(d: DemandeAvecTiers, modeleId?: string) {
    try {
      let tiersId = d.tiers_id;
      let siteId: string | null = null;

      if (!tiersId) {
        const t = await enregistrerTiers({
          type: 'particulier', categorie: 'client',
          nom: d.nom ?? d.telephone ?? 'Client sans nom',
          email: d.email, telephone: d.telephone, adresse: d.adresse,
        });
        tiersId = t.id;
        await enregistrerDemande({ id: d.id, tiers_id: tiersId });
      }
      if (d.adresse) {
        const s = await enregistrerSite({ tiers_id: tiersId, adresse: d.adresse, usage_local: 'habitation' });
        siteId = s.id;
      }
      const devis = modeleId
        ? await devisDepuisModele(modeleId, {
            tiers_id: tiersId, site_id: siteId, demande_id: d.id,
            titre: d.besoin?.slice(0, 80) ?? null,
          })
        : await creerDevis({
            tiers_id: tiersId, site_id: siteId, demande_id: d.id,
            titre: d.besoin?.slice(0, 80) ?? null,
          });
      await enregistrerDemande({ id: d.id, statut: 'devisee', repondu: true, repondu_le: new Date().toISOString() });
      await ajouterFil({
        tiers_id: tiersId, demande_id: d.id, devis_id: devis.id,
        type: 'systeme', sujet: `Devis ${devis.numero} créé depuis la demande`,
      });
      aller(`/devis/${devis.id}`);
    } catch (e) { setErreur((e as Error).message); }
  }

  /**
   * Le cas type : un client écrit, puis rappelle. Deux demandes pour un seul
   * besoin. On garde la plus ancienne et on lui verse tout le contenu de l'autre.
   */
  async function fusionner() {
    const [x, y] = selection;
    const a = demandes.find((d) => d.id === x);
    const b = demandes.find((d) => d.id === y);
    if (!a || !b) return;
    const [garde, absorbe] = new Date(a.recu_le) <= new Date(b.recu_le) ? [a, b] : [b, a];
    if (!window.confirm(
      `Les deux demandes seront réunies en une seule, datée du ${new Date(garde.recu_le).toLocaleDateString('fr-FR')}. ` +
      'Les coordonnées, résumés et transcriptions sont conservés. Continuer ?',
    )) return;
    try {
      await fusionnerDemandes(garde.id, absorbe.id);
      setSelection([]);
      void recharger();
    } catch (e) { setErreur((e as Error).message); }
  }

  function basculerSelection(id: string) {
    setSelection((p) => p.includes(id) ? p.filter((x) => x !== id)
      : p.length >= 2 ? [p[1], id] : [...p, id]);
  }

  if (!charge) return null;

  const aujourdhui = new Date().toISOString().slice(0, 10);
  const q = recherche.trim().toLowerCase();
  const visibles = demandes
    .filter((d) => {
      if (filtre === 'toutes') return true;
      if (['perdue', 'spam'].includes(d.statut)) return false;
      if (filtre === 'attente') return !d.repondu;
      return d.statut !== 'devisee';
    })
    .filter((d) => !q ||
      `${nomDe(d) ?? ''} ${d.telephone ?? ''} ${d.email ?? ''} ${d.besoin ?? ''} ${d.adresse ?? ''} ${d.resume ?? ''}`
        .toLowerCase().includes(q));
  // Les appels qu'une recherche chez Allô pourrait nommer : sans nom, et sans
  // client dont on lirait le sien. Mêmes critères que le serveur, pour que le
  // compte affiché sur le bouton soit celui qu'il traitera.
  const sansNom = demandes.filter((d) =>
    d.source === 'allo' && d.nom == null && !d.tiers_id && d.telephone).length;

  return (
    <>
      <div className="entete">
        <h1>Demandes</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="Nom, téléphone, e-mail, besoin" value={recherche}
                 onChange={(e) => setRecherche(e.target.value)} style={{ width: 250 }} />
          <select value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)} style={{ width: 190 }}>
            <option value="attente">Sans réponse</option>
            <option value="ouvertes">En cours</option>
            <option value="toutes">Toutes</option>
          </select>
          {selection.length === 2 && (
            <button className="action discret" onClick={() => void fusionner()}>
              Fusionner les deux
            </button>
          )}
          {estDirection() && sansNom > 0 && (
            <button className="action discret" disabled={chercheNoms}
                    onClick={() => void chercherNoms()}
                    title="Cherche le nom de ces appelants dans vos contacts Allô">
              {chercheNoms ? 'Recherche des noms…' : `Retrouver les noms (${sansNom})`}
            </button>
          )}
          <button className="action" onClick={() => setSaisie(true)}>Noter un appel</button>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}
      {retourNoms && (
        <div className="panneau" style={{ display: 'flex', gap: 12, alignItems: 'center',
                                          borderLeft: '3px solid var(--bleu)' }}>
          <span style={{ flex: 1 }}>{retourNoms}</span>
          <button className="action discret" onClick={() => setRetourNoms(null)}>Fermer</button>
        </div>
      )}

      {saisie && (
        <Saisie onAnnuler={() => setSaisie(false)} onErreur={setErreur}
                onCree={() => { setSaisie(false); void recharger(); }} />
      )}

      {edition && (
        <Modale titre={`Modifier la demande${nomDe(edition) ? ` de ${nomDe(edition)}` : ''}`}
                taille="large" onFermer={() => setEdition(null)}>
          {/* On retire les objets joints avant de passer au formulaire : `tiers`
              vient d'une jointure, ce n'est pas une colonne de `demande`, et
              le renvoyer à l'enregistrement faisait échouer la requête avec
              « Could not find the 'tiers' column ». */}
          <Saisie demande={sansJointures(edition)} onAnnuler={() => setEdition(null)}
                  onErreur={setErreur}
                  onCree={() => { setEdition(null); void recharger(); }} />
        </Modale>
      )}

      {aDeviser && (
        <Modale titre={`Devis pour ${nomDe(aDeviser) ?? aDeviser.telephone ?? 'ce client'}`}
                taille="large" onFermer={() => setADeviser(null)}>
          <p className="statut" style={{ marginBottom: 12 }}>
            Repartir d’un devis déjà fait est presque toujours plus rapide que de tout
            reprendre : les lots, les lignes et l’échéancier sont copiés, il ne reste
            qu’à ajuster les quantités.
          </p>

          <button className="action" style={{ marginBottom: 16 }}
                  onClick={() => { const d = aDeviser; setADeviser(null); void convertir(d); }}>
            Partir d’un devis vierge
          </button>

          {modeles.length === 0 ? (
            <p className="statut">Aucun devis existant à reprendre.</p>
          ) : (
            <>
              <h3 style={{ marginBottom: 8 }}>Ou reprendre un devis existant</h3>
              <table>
                <thead>
                  <tr><th>Numéro</th><th>Client d’origine</th><th>Objet</th>
                    <th style={{ width: 110 }}>Émis</th><th style={{ width: 110 }} /></tr>
                </thead>
                <tbody>
                  {modeles.slice(0, 25).map((m) => (
                    <tr key={m.id} className="cliquable"
                        onClick={() => { const d = aDeviser; setADeviser(null); void convertir(d, m.id); }}>
                      <td>{m.numero}</td>
                      <td>{m.tiers?.nom ?? '—'}</td>
                      <td>{m.titre ?? '—'}</td>
                      <td className="num ref">
                        {new Date(m.date_emission).toLocaleDateString('fr-FR')}
                      </td>
                      <td><span className="statut">reprendre</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Modale>
      )}

      <p className="statut" style={{ marginBottom: 12 }}>
        La case « Répondu » est le cœur du suivi : tant qu’elle est vide, quelqu’un attend.
        Si la même personne écrit puis appelle, cochez les deux lignes à gauche et fusionnez-les :
        vous obtenez une seule demande avec toutes les coordonnées et les deux échanges.
      </p>

      {visibles.length === 0 ? (
        <div className="vide">
          {q ? 'Aucune demande ne correspond à cette recherche.' : 'Rien en attente.'}
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              {/* Deux cases côte à côte sans intitulé ne se distinguaient pas :
                  on ne savait ni laquelle faisait quoi, ni qu'elles faisaient
                  deux choses différentes. Chacune a maintenant son en-tête, et
                  les colonnes sont réduites à la largeur d'une case. */}
              <th style={{ width: 46, textAlign: 'center' }}>
                <Bulle texte="Cochez deux lignes de la même personne, puis « Fusionner » : les deux demandes n’en font plus qu’une.">
                  <span style={{ cursor: 'help', borderBottom: '1px dotted var(--filet)' }}>
                    Fusion
                  </span>
                </Bulle>
              </th>
              <th style={{ width: 58, textAlign: 'center' }}>
                <Bulle texte="Cochez quand vous avez rappelé ou répondu. Tant que la case est vide, quelqu’un attend.">
                  <span style={{ cursor: 'help', borderBottom: '1px dotted var(--filet)' }}>
                    Traité
                  </span>
                </Bulle>
              </th>
              <th style={{ width: 74 }}>Reçue</th>
              <th>Nom</th>
              <th>Coordonnées</th>
              <th>Besoin</th>
              <th style={{ width: 118 }}>Rappeler le</th>
              <th style={{ width: 130 }}>Statut</th>
              <th className="sans-impression" />
            </tr>
          </thead>
          <tbody>
            {visibles.map((d) => {
              const retard = d.rappeler_le && d.rappeler_le <= aujourdhui && !d.repondu;
              return (
                <tr key={d.id} style={
                  selection.includes(d.id) ? { background: 'var(--bleu-pale)' }
                    : retard ? { background: '#fdf3f2' } : undefined
                }>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ width: 'auto' }}
                           checked={selection.includes(d.id)}
                           onChange={() => basculerSelection(d.id)}
                           aria-label={`Sélectionner ${nomDe(d) ?? 'cette demande'} pour la fusionner`}
                           title="Sélectionner pour fusionner" />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={d.repondu} style={{ width: 'auto' }}
                           onChange={() => void basculerRepondu(d)}
                           aria-label={`Marquer la demande de ${nomDe(d) ?? 'ce client'} comme traitée`}
                           title="Marquer comme traité" />
                  </td>
                  <td className="num ref">
                    {new Date(d.recu_le).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                  </td>
                  {/* Affichage, pas saisie.
                      La version précédente ouvrait un champ sur chaque cellule :
                      illisible, et surtout dangereux — un caractère effacé par
                      mégarde partait en base sans que personne le voie. On
                      modifie maintenant par un geste voulu, dans une fenêtre. */}
                  <td>
                    {nomDe(d)
                      ? <strong>{nomDe(d)}</strong>
                      : <span className="statut">sans nom</span>}
                  </td>
                  <td className="ref">
                    {d.telephone && (
                      <div><a href={`tel:${d.telephone.replace(/\s/g, '')}`}>{d.telephone}</a></div>
                    )}
                    {d.email && (
                      <div style={{ wordBreak: 'break-all' }}>
                        <a href={`mailto:${d.email}`}>{d.email}</a>
                      </div>
                    )}
                    {!d.telephone && !d.email && <span className="statut">aucune coordonnée</span>}
                  </td>
                  <td>
                    <Besoin demande={d} deplie={deplies.has(d.id)}
                            onBasculer={() => setDeplies((x) => {
                              const n = new Set(x);
                              if (n.has(d.id)) n.delete(d.id); else n.add(d.id);
                              return n;
                            })}
                             />
                  </td>
                  <td>
                    <input type="date" value={d.rappeler_le ?? ''}
                           onChange={(e) => void patcher(d, { rappeler_le: e.target.value || null })} />
                  </td>
                  <td>
                    <select value={d.statut}
                            onChange={(e) => void patcher(d, { statut: e.target.value as Demande['statut'] })}>
                      {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className="sans-impression" style={{ whiteSpace: 'nowrap' }}>
                    <button className="action discret" style={{ padding: '2px 9px' }}
                            title="Corriger le nom, le téléphone, l’adresse"
                            onClick={() => setEdition(d)}>
                      Modifier
                    </button>{' '}
                    {voitLesPrix() && (
                      <BoutonDevis onDicter={() => setDicter(d)}
                                   onEcrire={() => void proposerDevis(d)} />
                    )}{' '}
                    <button className="action discret"
                            onClick={() => window.confirm('Supprimer cette demande ?') &&
                              void supprimerDemande(d.id).then(recharger)}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {dicter && (
        <Modale titre={`Devis pour ${nomDe(dicter) ?? 'cette demande'}`} taille="large"
                onFermer={() => setDicter(null)}>
          <DevisDepuisDemande demande={dicter} onErreur={setErreur}
                              onCree={(id) => {
                                void patcher(dicter, { statut: 'devisee' });
                                setDicter(null);
                                aller(`/devis/${id}`);
                              }} />
        </Modale>
      )}

    </>
  );
}

/**
 * Ne garde que les colonnes de la table.
 *
 * Les listes rendent des objets enrichis — `tiers`, `chantier` — pratiques à
 * l'affichage et refusés à l'écriture. Les laisser passer ne donne pas une
 * erreur claire mais un message sur un « schema cache » que personne ne peut
 * relier à sa cause.
 */
function sansJointures(d: DemandeAvecTiers): Partial<Demande> {
  const { tiers: _tiers, ...colonnes } = d as DemandeAvecTiers & { tiers?: unknown };
  return colonnes as Partial<Demande>;
}

/**
 * Le même formulaire pour noter un appel et pour corriger une demande.
 *
 * Deux écrans qui saisissent les mêmes champs finissent toujours par
 * diverger : l'un gagne un champ que l'autre n'a pas, et on ne sait plus
 * lequel fait autorité.
 */
function Saisie({ demande, onAnnuler, onCree, onErreur }: {
  demande?: Partial<Demande>;
  onAnnuler: () => void;
  onCree: () => void;
  onErreur: (m: string) => void;
}) {
  const [d, setD] = useState<Partial<Demande>>(
    demande ?? { source: 'telephone', urgence: 'projet', statut: 'nouvelle' });
  const [envoi, setEnvoi] = useState(false);
  const champ = (k: keyof Demande, v: string) => setD((p) => ({ ...p, [k]: v }));

  async function enregistrer() {
    setEnvoi(true);
    try { await enregistrerDemande(d); onCree(); }
    catch (e) { onErreur((e as Error).message); setEnvoi(false); }
  }

  return (
    <div className="panneau" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
      <div><label>Nom</label><input value={d.nom ?? ''} onChange={(e) => champ('nom', e.target.value)} /></div>
      <div><label>Téléphone</label><input value={d.telephone ?? ''} onChange={(e) => champ('telephone', e.target.value)} /></div>
      <div><label>E-mail</label><input value={d.email ?? ''} onChange={(e) => champ('email', e.target.value)} /></div>
      <div>
        <label>Urgence</label>
        <select value={d.urgence} onChange={(e) => champ('urgence', e.target.value)}>
          <option value="panne">Panne</option>
          <option value="saison">Saison</option>
          <option value="projet">Projet</option>
        </select>
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <label>Adresse</label><input value={d.adresse ?? ''} onChange={(e) => champ('adresse', e.target.value)} />
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <label>Besoin</label>
        <input value={d.besoin ?? ''} onChange={(e) => champ('besoin', e.target.value)}
               placeholder="Clim 3 chambres, maison 1970, RDC" />
      </div>
      <div style={{ gridColumn: 'span 4' }}>
        <label>Notes ou transcription</label>
        <textarea rows={2} value={d.transcription ?? ''} onChange={(e) => champ('transcription', e.target.value)} />
      </div>
      <div style={{ gridColumn: 'span 4', display: 'flex', gap: 8 }}>
        <button className="action" onClick={() => void enregistrer()} disabled={envoi}>Enregistrer</button>
        <button className="action discret" onClick={onAnnuler}>Annuler</button>
      </div>
    </div>
  );
}


// --- Devis dicté depuis une demande -----------------------------------------

/**
 * Le geste le plus courant du métier, enfin en une fois.
 *
 * Fabrice ouvre une demande, relit ce que la personne a dit au téléphone,
 * dicte ce qu'il faut poser, et obtient un brouillon chiffré rattaché au bon
 * client et à la bonne demande. Avant : lire la demande, ouvrir Devis, créer,
 * chercher le client, ajouter les lignes une par une.
 *
 * La transcription reste sous les yeux pendant la dictée. C'est elle qu'on
 * traduit en lignes — la masquer obligerait à la retenir.
 */
function DevisDepuisDemande({ demande, onCree, onErreur }: {
  demande: DemandeAvecTiers;
  onCree: (id: string) => void;
  onErreur: (m: string) => void;
}) {
  const [dit, setDit] = useState('');
  const [lu, setLu] = useState<PropositionDevis | null>(null);
  const [analyse, setAnalyse] = useState(false);
  const [creation, setCreation] = useState(false);

  async function analyser() {
    if (!dit.trim()) return;
    setAnalyse(true);
    try { setLu(await lireDictee(dit)); }
    catch (e) {
      onErreur(e instanceof IANonConfiguree
        ? `${(e as Error).message} En attendant, « Faire le devis » ouvre l’éditeur à la main.`
        : (e as Error).message);
    }
    setAnalyse(false);
  }

  async function creer() {
    if (!lu) return;
    setCreation(true);
    try {
      const r = await creerBrouillonDicte(lu, dit, {
        tiers_id: demande.tiers_id,
        demande_id: demande.id,
      });
      onCree(r.devisId);
    } catch (e) { onErreur((e as Error).message); }
    setCreation(false);
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="panneau" style={{ display: 'block', margin: 0,
                                        borderLeft: '3px solid var(--bleu)' }}>
        <span className="statut">Ce que la personne a dit</span>
        <p style={{ margin: '4px 0 0' }}>{demande.besoin ?? '—'}</p>
        {demande.adresse && <p className="statut">{demande.adresse}</p>}
        {demande.transcription && (
          <details className="fiche" style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--bleu)' }}>
              Transcription complète de l’appel
            </summary>
            <p style={{ whiteSpace: 'pre-line', marginTop: 6 }}>{demande.transcription}</p>
          </details>
        )}
      </div>

      {!demande.tiers_id && (
        <p className="statut" style={{ color: '#b8860b' }}>
          Cette demande n’est rattachée à aucune fiche client. Le brouillon sera créé sans
          client : vous le choisirez dans l’éditeur, existant ou nouveau.
        </p>
      )}

      <div>
        <label>Ce qu’il faut poser</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'start' }}>
          <textarea rows={5} value={dit} style={{ flex: 1 }}
                    placeholder="Dictez : un mono-split de deux virgule cinq dans le séjour, deux de deux kilowatts dans les chambres, la pose et la mise en service…"
                    onChange={(e) => setDit(e.target.value)} />
          <Dictee onErreur={onErreur} onTexte={(t) => setDit((d) => (d ? `${d} ${t}` : t))} />
        </div>
      </div>

      <div>
        <button className="action" disabled={!dit.trim() || analyse}
                onClick={() => void analyser()}>
          {analyse ? 'Lecture…' : 'Transformer en lignes'}
        </button>
      </div>

      {lu && (
        <>
          <table>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Référence</th>
                <th>Désignation</th>
                <th className="num" style={{ width: 80 }}>Qté</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {lu.lignes.map((l, i) => (
                <tr key={i}>
                  <td className="ref">
                    {l.reference
                      ? <span className="jeton" data-r="recu">{l.reference}</span>
                      : <span className="statut">à compléter</span>}
                  </td>
                  <td>
                    <input value={l.designation} style={{ padding: '3px 5px' }}
                           onChange={(e) => setLu({ ...lu, lignes: lu.lignes.map((x, j) =>
                             (j === i ? { ...x, designation: e.target.value } : x)) })} />
                  </td>
                  <td>
                    <input type="number" step="0.5" className="num" value={l.quantite}
                           style={{ padding: '3px 5px' }}
                           onChange={(e) => setLu({ ...lu, lignes: lu.lignes.map((x, j) =>
                             (j === i ? { ...x, quantite: Number(e.target.value) } : x)) })} />
                  </td>
                  <td>
                    <button className="action discret" style={{ padding: '2px 7px' }}
                            onClick={() => setLu({ ...lu,
                              lignes: lu.lignes.filter((_, j) => j !== i) })}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="statut">
            {lu.lignes.filter((l) => l.reference).length} sur {lu.lignes.length} reconnue(s)
            au catalogue : elles arriveront avec leur prix. Le devis sera rattaché à cette
            demande, et son statut passera à « devisée ».
          </p>

          <div>
            <button className="action" disabled={creation || lu.lignes.length === 0}
                    onClick={() => void creer()}>
              {creation ? 'Création…' : 'Créer le brouillon'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}


// --- Le besoin, avec son audio et son texte complet -------------------------

/**
 * La colonne la plus lue de l'écran, et la plus serrée.
 *
 * Un besoin dicté par Allô fait souvent trois lignes ; la colonne en montrait
 * deux et coupait au milieu d'une phrase. On affiche donc un extrait, avec
 * « tout lire » qui déplie la ligne entière — sans ouvrir de fenêtre, parce
 * qu'on est en train de parcourir une liste.
 *
 * L'enregistrement reste chez Allô : Batinium n'en garde que l'adresse. Un
 * appel de trois minutes pèse deux mégaoctets ; sur mille appels, ce sont deux
 * gigaoctets stockés deux fois, pour rien.
 */
function Besoin({ demande, deplie, onBasculer }: {
  demande: DemandeAvecTiers;
  deplie: boolean;
  onBasculer: () => void;
}) {
  const texte = demande.besoin ?? demande.resume ?? '';
  const long = texte.length > 110;

  return (
    <>
      <div style={deplie ? { whiteSpace: 'pre-line' } : undefined}>
        {deplie || !long ? (texte || '—') : `${texte.slice(0, 110)}…`}
      </div>

      {long && (
        <button className="lien-discret" onClick={onBasculer}>
          {deplie ? 'réduire' : 'tout lire'}
        </button>
      )}

      {demande.adresse && <div className="fiche">{demande.adresse}</div>}

      {demande.enregistrement_url && <Ecoute demandeId={demande.id} />}

      {demande.transcription && (
        <details className="fiche" open={deplie}>
          <summary style={{ cursor: 'pointer', color: 'var(--bleu)' }}>
            Transcription de l’appel
          </summary>
          <p style={{ whiteSpace: 'pre-line', marginTop: 4 }}>{demande.transcription}</p>
        </details>
      )}
    </>
  );
}

/**
 * Un seul bouton pour faire un devis, deux façons de le remplir.
 *
 * Deux boutons côte à côte obligeaient à choisir avant de savoir ce qu'on
 * allait faire, et volaient la place de la colonne « besoin » — celle qu'on
 * lit vraiment.
 */
function BoutonDevis({ onDicter, onEcrire }: { onDicter: () => void; onEcrire: () => void }) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}
          onMouseEnter={() => setOuvert(true)}
          onMouseLeave={() => setOuvert(false)}>
      <button className="action discret" onClick={() => setOuvert(!ouvert)}>
        Faire un devis
      </button>
      {ouvert && (
        <span className="choix-devis">
          <button onClick={() => { setOuvert(false); onDicter(); }}>
            À la voix
            <em>Dictez, Batinium chiffre depuis le catalogue</em>
          </button>
          <button onClick={() => { setOuvert(false); onEcrire(); }}>
            À la main
            <em>Ouvre l’éditeur, vide</em>
          </button>
        </span>
      )}
    </span>
  );
}


/**
 * L'écoute d'un appel, sur place.
 *
 * Le fichier n'est pas demandé tant qu'on ne clique pas : sur une liste de
 * vingt demandes, charger vingt enregistrements coûterait quarante mégaoctets
 * pour un seul qu'on écoutera.
 *
 * Et quand ça échoue, on le dit. Un lecteur figé à 0:00 laisse croire à un
 * appel vide alors que le problème est ailleurs.
 */
function Ecoute({ demandeId }: { demandeId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // L'adresse locale occupe la mémoire du navigateur tant qu'on ne la relâche
  // pas. Sur une journée d'écoutes, ça se voit.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function charger() {
    setCharge(true); setErreur(null);
    try { setUrl(await audioDemande(demandeId)); }
    catch (e) { setErreur((e as Error).message); }
    setCharge(false);
  }

  if (url) {
    return (
      <audio controls autoPlay src={url}
             style={{ width: '100%', maxWidth: 240, height: 32, marginTop: 6 }} />
    );
  }

  return (
    <div style={{ marginTop: 6 }}>
      <button className="action discret" style={{ padding: '3px 10px', fontSize: 13 }}
              disabled={charge} onClick={() => void charger()}>
        {charge ? 'Chargement…' : '▶ Écouter l’appel'}
      </button>
      {erreur && (
        <div className="statut" style={{ color: 'var(--alerte)', marginTop: 4 }}>{erreur}</div>
      )}
    </div>
  );
}
