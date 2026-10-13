import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { eur } from '../lib/calcul';
import {
  chargerTousLesDevis, creerDevis, devisDepuisModele, dupliquerDevis, listerDevis,
  listerSites, listerTiers, majDevis, supprimerDevis, type DevisAvecTiers,
} from '../lib/db';
import { IANonConfiguree } from '../lib/ia';
import { creerBrouillonDicte, lireDictee, type PropositionDevis } from '../lib/devisDicte';
import Modale from '../components/Modale';
import Dictee from '../components/Dictee';
import Squelette from '../components/Squelette';
import Survol from '../components/Survol';
import type { Devis, Site, Tiers } from '../lib/types';

const STATUTS: Record<Devis['statut'], string> = {
  brouillon: 'Brouillon', envoye: 'Envoyé', relance: 'Relancé',
  signe: 'Signé', refuse: 'Refusé', expire: 'Expiré',
};

export default function PageDevis() {
  const [devis, setDevis] = useState<DevisAvecTiers[]>([]);
  const [totaux, setTotaux] = useState<Record<string, number>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const [creation, setCreation] = useState(false);
  const [voix, setVoix] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [parStatut, setParStatut] = useState('');
  const [duJour, setDuJour] = useState('');
  const [auJour, setAuJour] = useState('');
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');


  const recharger = useCallback(async () => {
    try {
      // Un seul lot pour tous les devis : la liste s'affiche d'un coup.
      const groupes = await chargerTousLesDevis();
      setDevis(groupes.map((g) => g.devis));
      const t: Record<string, number> = {};
      for (const g of groupes) {
        t[g.devis.id] = g.lignes.reduce(
          (s, l) => s + Number(l.quantite) * Number(l.prix_unitaire_ht)
                      * (1 - Number(l.remise_pct) / 100), 0,
        ) - Number(g.devis.remise_montant ?? 0);
      }
      setTotaux(t);
    } catch (e) { setErreur((e as Error).message); }
    setCharge(true);
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  if (!charge) {
    return (
      <>
        <div className="entete"><h1>Devis</h1></div>
        <Squelette lignes={8} colonnes={7} />
      </>
    );
  }

  const aujourdhui = new Date().toISOString().slice(0, 10);

  const q = recherche.trim().toLowerCase();
  const min = minimum ? Number(minimum) : null;
  const max = maximum ? Number(maximum) : null;

  const visibles = devis
    .filter((d) => !q ||
      `${d.numero} ${d.titre ?? ''} ${d.tiers?.nom ?? ''} ${d.tiers?.ville ?? ''}`
        .toLowerCase().includes(q))
    .filter((d) => !parStatut || d.statut === parStatut)
    .filter((d) => !duJour || d.date_emission >= duJour)
    .filter((d) => !auJour || d.date_emission <= auJour)
    .filter((d) => {
      // Un devis dont le total n'est pas encore calculé ne doit pas disparaître
      // à cause d'un filtre de montant.
      const t = totaux[d.id];
      if (t == null) return min == null && max == null ? true : false;
      return (min == null || t >= min) && (max == null || t <= max);
    });

  const nettoyer = () => {
    setRecherche(''); setParStatut(''); setDuJour(''); setAuJour('');
    setMinimum(''); setMaximum('');
  };
  const filtresActifs = Boolean(q || parStatut || duJour || auJour || minimum || maximum);

  return (
    <>
      <div className="entete">
        <h1>Devis</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="Numéro, client, objet, ville" value={recherche}
                 onChange={(e) => setRecherche(e.target.value)} style={{ width: 260 }} />
          <Survol declencheur={({ ouvert, basculer }) => (
            <button className="action discret" onClick={basculer} aria-expanded={ouvert}>
              Filtres{filtresActifs ? ' ●' : ''}
            </button>
          )}>
            <div style={{ display: 'grid', gap: 12, width: 'min(640px, 80vw)' }}>
              <div>
                <label>Statut</label>
                <select value={parStatut} onChange={(e) => setParStatut(e.target.value)}>
                  <option value="">Tous</option>
                  {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <label>Émis à partir du</label>
                  <input type="date" value={duJour} onChange={(e) => setDuJour(e.target.value)} />
                </div>
                <div>
                  <label>Jusqu’au</label>
                  <input type="date" value={auJour} onChange={(e) => setAuJour(e.target.value)} />
                </div>
              </div>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <label>Montant HT minimum</label>
                  <input type="number" className="num" placeholder="0" value={minimum}
                         onChange={(e) => setMinimum(e.target.value)} />
                </div>
                <div>
                  <label>Maximum</label>
                  <input type="number" className="num" placeholder="—" value={maximum}
                         onChange={(e) => setMaximum(e.target.value)} />
                </div>
              </div>
              <button className="action discret" onClick={nettoyer}>Effacer les filtres</button>
            </div>
          </Survol>
          <button className="action discret" onClick={() => setVoix(true)}>
            Devis à la voix
          </button>
          <button className="action" onClick={() => setCreation(true)}>Nouveau devis</button>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {voix && (
        <Modale titre="Devis à la voix" taille="large" onFermer={() => setVoix(false)}>
          <DevisVoix onErreur={setErreur} onCree={(id) => { setVoix(false); aller(`/devis/${id}`); }} />
        </Modale>
      )}

      {creation && (
        <NouveauDevis onAnnuler={() => setCreation(false)} onErreur={setErreur}
                      onCree={(id) => aller(`/devis/${id}`)} />
      )}

      {visibles.length === 0 ? (
        <div className="vide">
          {devis.length === 0
            ? 'Aucun devis. Créez le premier, ou partez d’une demande.'
            : 'Aucun devis ne correspond à cette recherche.'}
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Numéro</th><th>Client</th><th>Objet</th><th>Émis</th>
              <th className="num">Total HT</th><th>Statut</th><th>Relance</th><th />
            </tr>
          </thead>
          <tbody>
            {visibles.map((d) => {
              const aRelancer = d.statut === 'envoye' &&
                (!d.relance_prochaine_le || d.relance_prochaine_le <= aujourdhui);
              return (
                <tr key={d.id} className="cliquable" onClick={() => aller(`/devis/${d.id}`)}
                    style={aRelancer ? { background: '#fdf7ee' } : undefined}>
                  <td>{d.numero}</td>
                  <td>{d.tiers?.nom ?? '—'}</td>
                  <td>{d.titre ?? '—'}</td>
                  <td className="num ref">{new Date(d.date_emission).toLocaleDateString('fr-FR')}</td>
                  <td className="num">{totaux[d.id] != null ? eur(totaux[d.id]) : '…'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select value={d.statut}
                            onChange={(e) => void majDevis(d.id, { statut: e.target.value as Devis['statut'] }).then(recharger)}>
                      {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="date" value={d.relance_prochaine_le ?? ''}
                           onChange={(e) => void majDevis(d.id, { relance_prochaine_le: e.target.value || null }).then(recharger)} />
                  </td>
                  <td className="sans-impression" onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                    <button className="action discret"
                            onClick={() => void dupliquerDevis(d.id).then((c) => aller(`/devis/${c.id}`))
                              .catch((e) => setErreur((e as Error).message))}>Dupliquer</button>{' '}
                    <button className="action discret"
                            onClick={() => window.confirm(`Supprimer le devis ${d.numero} ?`) &&
                              void supprimerDevis(d.id).then(recharger)}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

function NouveauDevis({ onAnnuler, onCree, onErreur }:
  { onAnnuler: () => void; onCree: (id: string) => void; onErreur: (m: string) => void }) {
  const [clients, setClients] = useState<Tiers[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [tiersId, setTiersId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [titre, setTitre] = useState('');
  const [modele, setModele] = useState('');
  const [modeles, setModeles] = useState<DevisAvecTiers[]>([]);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    listerDevis().then(setModeles).catch(() => setModeles([]));
  }, []);

  useEffect(() => {
    listerTiers().then((t) => setClients(t.filter((x) => x.categorie !== 'fournisseur')))
      .catch((e) => onErreur((e as Error).message));
  }, [onErreur]);

  useEffect(() => {
    if (!tiersId) { setSites([]); setSiteId(''); return; }
    listerSites(tiersId).then((s) => { setSites(s); setSiteId(s[0]?.id ?? ''); })
      .catch((e) => onErreur((e as Error).message));
  }, [tiersId, onErreur]);

  return (
    <div className="panneau" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr auto auto' }}>
      <div>
        <label>Client</label>
        <select value={tiersId} onChange={(e) => setTiersId(e.target.value)}>
          <option value="">Sans client pour l’instant</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
      </div>
      <div>
        <label>Adresse du projet</label>
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={!sites.length}>
          {sites.length === 0 && <option value="">Aucun site</option>}
          {sites.map((s) => <option key={s.id} value={s.id}>{s.adresse}, {s.ville}</option>)}
        </select>
      </div>
      <div>
        <label>Objet</label>
        <input value={titre} onChange={(e) => setTitre(e.target.value)}
               placeholder="Climatisation à condensation" />
      </div>
      <div>
        <label>Partir d’un devis existant</label>
        <select value={modele} onChange={(e) => setModele(e.target.value)}>
          <option value="">Devis vierge</option>
          {modeles.slice(0, 30).map((m) => (
            <option key={m.id} value={m.id}>
              {m.numero} — {m.tiers?.nom ?? m.titre ?? 'sans client'}
            </option>
          ))}
        </select>
      </div>
      <button className="action" disabled={envoi} onClick={() => {
        setEnvoi(true);
        const cible = { tiers_id: tiersId || null, site_id: siteId || null, titre: titre || null };
        const p = modele
          ? devisDepuisModele(modele, cible)
          : creerDevis(cible);
        void p.then((d) => onCree(d.id))
          .catch((e) => { onErreur((e as Error).message); setEnvoi(false); });
      }}>Créer</button>
      <button className="action discret" onClick={onAnnuler}>Annuler</button>
    </div>
  );
}


// --- Devis à la voix --------------------------------------------------------

/**
 * Dicter un chantier, obtenir un brouillon chiffré.
 *
 * Le devis créé n'est rattaché à personne : on choisit le client ensuite,
 * depuis l'éditeur. C'est ce qui rend le geste sans risque — dicter au bord
 * d'une route ne doit engager aucune fiche client.
 */
function DevisVoix({ onCree, onErreur }: {
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
        ? `${(e as Error).message} En attendant, « Nouveau devis » fait la même chose à la main.`
        : (e as Error).message);
    }
    setAnalyse(false);
  }

  async function creer() {
    if (!lu) return;
    setCreation(true);
    try { onCree((await creerBrouillonDicte(lu, dit)).devisId); }
    catch (e) { onErreur((e as Error).message); }
    setCreation(false);
  }

  const reconnues = (lu?.lignes ?? []).filter((l) => l.reference).length;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p className="statut">
        Décrivez le chantier à voix haute : les pièces, les machines, les quantités, ce
        qu’il y a à poser. Batinium cherche vos références au catalogue et ramène leurs
        prix. Le brouillon obtenu n’est rattaché à aucun client — vous choisirez le sien
        dans l’éditeur.
      </p>

      <div>
        <label>Ce que vous dictez</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'start' }}>
          <textarea rows={6} value={dit} style={{ flex: 1 }}
                    placeholder="Un mono-split de deux virgule cinq kilowatts dans le séjour, deux mono-splits de deux kilowatts dans les chambres, quatorze mètres de liaison frigorifique, la pose et la mise en service…"
                    onChange={(e) => setDit(e.target.value)} />
          <Dictee onErreur={onErreur}
                  onTexte={(t) => setDit((d) => (d ? `${d} ${t}` : t))} />
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
          <div>
            <label>Titre proposé</label>
            <input value={lu.titre} onChange={(e) => setLu({ ...lu, titre: e.target.value })} />
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Référence</th>
                <th>Désignation</th>
                <th className="num" style={{ width: 80 }}>Qté</th>
                <th style={{ width: 80 }}>Unité</th>
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
                    <input value={l.unite} style={{ padding: '3px 5px', fontSize: 12 }}
                           onChange={(e) => setLu({ ...lu, lignes: lu.lignes.map((x, j) =>
                             (j === i ? { ...x, unite: e.target.value } : x)) })} />
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
            {reconnues} ligne(s) sur {lu.lignes.length} reconnue(s) au catalogue : elles
            arriveront avec leur prix, leur unité et leur taux de TVA. Les autres restent
            à zéro — un zéro se voit, un prix inventé ne se voit pas.
          </p>

          <div>
            <button className="action" disabled={creation || lu.lignes.length === 0}
                    onClick={() => void creer()}>
              {creation ? 'Création…' : `Créer le brouillon (${lu.lignes.length} ligne${lu.lignes.length > 1 ? 's' : ''})`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
