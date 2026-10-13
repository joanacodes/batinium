import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import {
  enregistrerTiers, fusionnerTiers, listerChantiers, listerDevis, listerDoublons, listerSites,
  listerTiers,
} from '../lib/db';
import type { Doublon, Site, Tiers } from '../lib/types';
import ChampAdresse from '../components/ChampAdresse';

const CATEGORIES: Record<Tiers['categorie'], string> = {
  prospect: 'Prospect', client: 'Client', fournisseur: 'Fournisseur', sous_traitant: 'Sous-traitant',
};

export default function PageClients() {
  const [clients, setClients] = useState<Tiers[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState(false);
  const [filtre, setFiltre] = useState('');
  const [doublons, setDoublons] = useState<Doublon[]>([]);
  // Les devis et chantiers sont chargés ici plutôt que déduits ailleurs :
  // un voyant qui dépend d'un appel séparé finit toujours par être vide.
  const [devis, setDevis] = useState<{ tiers_id: string | null; statut: string }[]>([]);
  const [chantiers, setChantiers] = useState<{ tiers_id: string; statut: string }[]>([]);
  const [fusion, setFusion] = useState<{ garde: string; absorbe: string } | null>(null);

  const recharger = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([listerTiers(), listerSites()]);
      setClients(t.filter((x) => x.categorie === 'client' || x.categorie === 'prospect'));
      setSites(s);
      setDoublons(await listerDoublons().catch(() => []));
      setDevis(await listerDevis().catch(() => []));
      setChantiers(await listerChantiers().catch(() => []));
    } catch (e) { setErreur((e as Error).message); }
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  const q = filtre.trim().toLowerCase();
  const visibles = q
    ? clients.filter((c) => `${c.nom} ${c.email ?? ''} ${c.telephone ?? ''} ${c.ville ?? ''}`.toLowerCase().includes(q))
    : clients;

  return (
    <>
      <div className="entete">
        <h1>Clients</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="Nom, e-mail, téléphone, ville" value={filtre}
                 onChange={(e) => setFiltre(e.target.value)} style={{ width: 260 }} />
          <button className="action discret" onClick={() => setFusion({ garde: '', absorbe: '' })}>
            Fusionner
          </button>
          <button className="action" onClick={() => setNouveau(true)}>Nouveau client</button>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {doublons.length > 0 && (
        <div className="panneau" style={{ display: 'block', borderLeft: '3px solid #b8860b' }}>
          <h3 style={{ marginBottom: 6 }}>
            {doublons.length} doublon{doublons.length > 1 ? 's' : ''} probable{doublons.length > 1 ? 's' : ''}
          </h3>
          {doublons.map((d) => (
            <div key={`${d.a}-${d.b}`} style={{ display: 'flex', gap: 10, alignItems: 'center',
                                                padding: '5px 0' }}>
              <span style={{ flex: 1 }}>
                <strong>{d.nom_a}</strong> et <strong>{d.nom_b}</strong>
                <span className="statut"> — {d.motif}</span>
              </span>
              <button className="action discret"
                      onClick={() => setFusion({ garde: d.a, absorbe: d.b })}>Fusionner</button>
            </div>
          ))}
        </div>
      )}

      {fusion && (
        <Fusion clients={clients} initial={fusion} onErreur={setErreur}
                onAnnuler={() => setFusion(null)}
                onFait={() => { setFusion(null); void recharger(); }} />
      )}

      {nouveau && (
        <Formulaire onAnnuler={() => setNouveau(false)} onErreur={setErreur}
                    onEnregistre={() => { setNouveau(false); void recharger(); }} />
      )}

      {visibles.length === 0 ? (
        <div className="vide">Aucun client. Les prospects arrivent aussi depuis la boîte mail.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 150 }} title="Devis et chantiers de ce client">Suivi</th>
              <th>Nom</th><th>Catégorie</th><th>Coordonnées</th><th>Ville</th>
              <th className="num">Sites</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((c) => (
              <tr key={c.id} className="cliquable" onClick={() => aller(`/clients/${c.id}`)}>
                <td>
                  <Voyants
                    devis={devis.filter((d) => d.tiers_id === c.id)}
                    chantiers={chantiers.filter((x) => x.tiers_id === c.id)}
                  />
                </td>
                <td>{c.nom}</td>
                <td className="statut">{CATEGORIES[c.categorie]}</td>
                <td className="ref">
                  {c.telephone ?? ''}{c.telephone && c.email ? <br /> : null}{c.email ?? ''}
                </td>
                <td>{c.ville ?? '—'}</td>
                <td className="num">{sites.filter((s) => s.tiers_id === c.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Formulaire({ onAnnuler, onEnregistre, onErreur }:
  { onAnnuler: () => void; onEnregistre: () => void; onErreur: (m: string) => void }) {
  const [t, setT] = useState<Partial<Tiers>>({ type: 'particulier', categorie: 'client' });
  const set = (k: keyof Tiers, v: string) => setT((p) => ({ ...p, [k]: v }));

  async function enregistrer() {
    if (!t.nom) return onErreur('Le nom est obligatoire.');
    try { await enregistrerTiers(t); onEnregistre(); }
    catch (e) { onErreur((e as Error).message); }
  }

  return (
    <div className="panneau" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
      <div><label>Nom ou raison sociale</label><input value={t.nom ?? ''} onChange={(e) => set('nom', e.target.value)} /></div>
      <div>
        <label>Type</label>
        <select value={t.type} onChange={(e) => set('type', e.target.value)}>
          <option value="particulier">Particulier</option>
          <option value="professionnel">Professionnel</option>
        </select>
      </div>
      <div>
        <label>Catégorie</label>
        <select value={t.categorie} onChange={(e) => set('categorie', e.target.value)}>
          <option value="prospect">Prospect</option>
          <option value="client">Client</option>
        </select>
      </div>
      <div><label>Téléphone</label><input value={t.telephone ?? ''} onChange={(e) => set('telephone', e.target.value)} /></div>
      <div><label>E-mail</label><input value={t.email ?? ''} onChange={(e) => set('email', e.target.value)} /></div>
      <div style={{ gridColumn: 'span 2' }}>
        <label>Adresse de facturation</label>
        <ChampAdresse valeur={t.adresse ?? ''} onChange={(v) => set('adresse', v)}
          onChoisir={(s) => setT((p) => ({
            ...p, adresse: s.voie || s.texte,
            code_postal: s.codePostal || p.code_postal,
            ville: s.ville || p.ville,
          }))} />
      </div>
      <div><label>Code postal</label>
        <input value={t.code_postal ?? ''} onChange={(e) => set('code_postal', e.target.value)} /></div>
      <div><label>Ville</label><input value={t.ville ?? ''} onChange={(e) => set('ville', e.target.value)} /></div>
      <div style={{ gridColumn: 'span 4', display: 'flex', gap: 8 }}>
        <button className="action" onClick={() => void enregistrer()}>Enregistrer</button>
        <button className="action discret" onClick={onAnnuler}>Annuler</button>
      </div>
    </div>
  );
}


/**
 * Fusion de deux fiches. Tout ce qui pend à la fiche absorbée est déplacé,
 * les champs vides de la fiche gardée sont complétés par l'autre, puis la
 * fiche absorbée disparaît. Rien n'est perdu, mais l'opération est définitive.
 */
function Fusion({ clients, initial, onAnnuler, onFait, onErreur }: {
  clients: Tiers[];
  initial: { garde: string; absorbe: string };
  onAnnuler: () => void;
  onFait: () => void;
  onErreur: (m: string) => void;
}) {
  const [garde, setGarde] = useState(initial.garde);
  const [absorbe, setAbsorbe] = useState(initial.absorbe);
  const [envoi, setEnvoi] = useState(false);

  const g = clients.find((c) => c.id === garde);
  const a = clients.find((c) => c.id === absorbe);

  async function lancer() {
    if (!garde || !absorbe || garde === absorbe) {
      return onErreur('Choisissez deux fiches différentes.');
    }
    if (!window.confirm(
      `La fiche « ${a?.nom} » sera supprimée et tout son contenu déplacé vers « ${g?.nom} ». ` +
      'Cette opération est définitive. Continuer ?',
    )) return;
    setEnvoi(true);
    try { await fusionnerTiers(garde, absorbe); onFait(); }
    catch (e) { onErreur((e as Error).message); setEnvoi(false); }
  }

  const apercu = (champ: keyof Tiers, libelle: string) => {
    const vg = (g?.[champ] as string) ?? '';
    const va = (a?.[champ] as string) ?? '';
    const resultat = vg || va;
    if (!resultat) return null;
    return (
      <tr key={champ}>
        <td className="statut">{libelle}</td>
        <td>{vg || <span className="statut">—</span>}</td>
        <td>{va || <span className="statut">—</span>}</td>
        <td><strong>{resultat}</strong>{!vg && va ? <span className="statut"> (repris)</span> : null}</td>
      </tr>
    );
  };

  return (
    <div className="panneau" style={{ display: 'block' }}>
      <h3 style={{ marginBottom: 10 }}>Fusionner deux fiches</h3>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <label>Fiche à conserver</label>
          <select value={garde} onChange={(e) => setGarde(e.target.value)}>
            <option value="">—</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
        <div>
          <label>Fiche à absorber, puis supprimer</label>
          <select value={absorbe} onChange={(e) => setAbsorbe(e.target.value)}>
            <option value="">—</option>
            {clients.filter((c) => c.id !== garde)
              .map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
      </div>

      {g && a && (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr><th>Champ</th><th>{g.nom}</th><th>{a.nom}</th><th>Après fusion</th></tr>
          </thead>
          <tbody>
            {apercu('nom', 'Nom')}
            {apercu('telephone', 'Téléphone')}
            {apercu('email', 'E-mail')}
            {apercu('adresse', 'Adresse')}
            {apercu('ville', 'Ville')}
            {apercu('categorie', 'Catégorie')}
          </tbody>
        </table>
      )}

      <p className="statut" style={{ marginTop: 10 }}>
        Sites, demandes, devis, chantiers, documents et historique sont déplacés vers la fiche
        conservée. Les champs vides de celle-ci sont complétés par l’autre.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="action" onClick={() => void lancer()} disabled={envoi || !g || !a}>
          Fusionner
        </button>
        <button className="action discret" onClick={onAnnuler}>Annuler</button>
      </div>
    </div>
  );
}


/**
 * Voyant de suivi. Deux points et leur compte : bleu pour les devis, violet
 * pour les chantiers. Éteints, la fiche n'a rien. Allumés, elle est déjà
 * engagée, ce qui évite d'ouvrir un second chantier sur la même affaire.
 */
export function Voyants({ devis, chantiers }: {
  devis: { statut: string }[];
  chantiers: { statut: string }[];
}) {
  const signes = devis.filter((d) => d.statut === 'signe').length;
  const ouverts = chantiers.filter((c) => c.statut !== 'receptionne').length;

  const titre = devis.length === 0 && chantiers.length === 0
    ? 'Aucun devis ni chantier'
    : [
        devis.length > 0
          ? `${devis.length} devis${signes > 0 ? ` dont ${signes} signé${signes > 1 ? 's' : ''}` : ''}`
          : null,
        chantiers.length > 0
          ? `${chantiers.length} chantier${chantiers.length > 1 ? 's' : ''}${ouverts > 0 ? ` dont ${ouverts} en cours` : ''}`
          : null,
      ].filter(Boolean).join(' · ');

  if (devis.length === 0 && chantiers.length === 0) {
    return <span className="statut" title={titre}>—</span>;
  }

  return (
    <span className="voyants" title={titre}>
      {devis.length > 0 && (
        <span className="voyant-groupe">
          <i className="voyant" data-actif="oui" data-quoi="devis" />
          <span className="num">{devis.length}</span>
        </span>
      )}
      {chantiers.length > 0 && (
        <span className="voyant-groupe">
          <i className="voyant" data-actif="oui" data-quoi="chantier" />
          <span className="num">{chantiers.length}</span>
        </span>
      )}
    </span>
  );
}
