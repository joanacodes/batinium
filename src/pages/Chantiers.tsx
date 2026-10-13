import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import {
  ajouterFil, creerChantier, listerChantiers, listerDevis, listerPrealables, listerSites,
  prealablesDu,
  listerTiers, majChantier, suiviParTiers, supprimerChantier,
  type ChantierAvecTiers, type DevisAvecTiers, type SuiviTiers,
} from '../lib/db';
import type { Chantier, Prealable, Site, StatutChantier, Tiers } from '../lib/types';
import Modale from '../components/Modale';

export const LIBELLE_STATUT: Record<StatutChantier, string> = {
  a_planifier: 'À planifier', bloque: 'Bloqué', planifie: 'Planifié', en_cours: 'En cours',
  a_receptionner: 'À réceptionner', receptionne: 'Réceptionné', sav: 'SAV',
};

/** Couleur par statut : reconnaître l'état d'un chantier sans avoir à lire. */
export const COULEUR_STATUT: Record<StatutChantier, string> = {
  a_planifier: '#b8860b', bloque: 'var(--alerte)', planifie: 'var(--bleu)',
  en_cours: 'var(--bleu)', a_receptionner: '#7a5ea8',
  receptionne: 'var(--vert)', sav: 'var(--alerte)',
};

type Etape = 'tous' | 'a_commencer' | 'en_cours' | 'termines' | 'sav';

const ETAPES: { cle: Etape; libelle: string; statuts: StatutChantier[]; couleur: string }[] = [
  { cle: 'tous', libelle: 'Tous', statuts: [], couleur: 'var(--encre-pale)' },
  { cle: 'a_commencer', libelle: 'À commencer', couleur: '#b8860b',
    statuts: ['a_planifier', 'bloque', 'planifie'] },
  { cle: 'en_cours', libelle: 'En cours', couleur: 'var(--bleu)',
    statuts: ['en_cours', 'a_receptionner'] },
  { cle: 'termines', libelle: 'Terminés', couleur: 'var(--vert)', statuts: ['receptionne'] },
  { cle: 'sav', libelle: 'SAV', couleur: 'var(--alerte)', statuts: ['sav'] },
];

export default function PageChantiers() {
  const [chantiers, setChantiers] = useState<ChantierAvecTiers[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const [creation, setCreation] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [etape, setEtape] = useState<Etape>('tous');
  const [prealables, setPrealables] = useState<Prealable[]>([]);

  const recharger = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([listerChantiers(), listerPrealables().catch(() => [])]);
      setChantiers(c); setPrealables(p);
    } catch (e) { setErreur((e as Error).message); }
    setCharge(true);
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);
  if (!charge) return null;

  const q = recherche.trim().toLowerCase();
  const filtreEtape = ETAPES.find((x) => x.cle === etape)!;
  const visibles = chantiers
    .filter((c) => etape === 'tous' || filtreEtape.statuts.includes(c.statut))
    .filter((c) => !q ||
      `${c.numero} ${c.libelle} ${c.tiers?.nom ?? ''}`.toLowerCase().includes(q));

  return (
    <>
      <div className="entete">
        <h1>Chantiers</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="Numéro, client, intitulé" value={recherche}
                 onChange={(e) => setRecherche(e.target.value)} style={{ width: 250 }} />
          <button className="action" onClick={() => setCreation(true)}>Nouveau chantier</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {ETAPES.map((x) => {
          const compte = x.cle === 'tous'
            ? chantiers.length
            : chantiers.filter((c) => x.statuts.includes(c.statut)).length;
          const actif = etape === x.cle;
          return (
            <button key={x.cle} onClick={() => setEtape(x.cle)}
              style={{
                display: 'flex', gap: 7, alignItems: 'center', font: 'inherit', fontSize: 13,
                cursor: 'pointer', padding: '5px 12px', borderRadius: 3,
                border: `1px solid ${actif ? x.couleur : 'var(--filet)'}`,
                background: actif ? 'var(--surface)' : 'transparent',
                color: actif ? 'var(--encre)' : 'var(--encre-pale)',
              }}>
              {x.cle !== 'tous' && (
                <i style={{ width: 9, height: 9, borderRadius: 2, display: 'inline-block',
                            background: x.couleur }} />
              )}
              {x.libelle}
              <span className="num" style={{ opacity: .6 }}>{compte}</span>
            </button>
          );
        })}
      </div>
      {erreur && <div className="erreur">{erreur}</div>}

      <p className="statut" style={{ marginBottom: 12 }}>
        Un chantier naît d’un devis signé, depuis l’éditeur. Il ne passe en « planifié »
        que lorsque tous les verrous préalables sont levés.
      </p>

      {creation && (
        // La clé force un composant neuf à chaque ouverture : les champs d'une
        // saisie abandonnée ne réapparaissent jamais.
        <Creation key="creation"
                  onAnnuler={() => setCreation(false)} onErreur={setErreur}
                  onCree={(id) => { setCreation(false); aller(`/chantiers/${id}`); }} />
      )}

      {visibles.length === 0 ? (
        <div className="vide">
          {chantiers.length === 0
            ? 'Aucun chantier. Créez-en un, ou signez un devis pour l’ouvrir automatiquement.'
            : 'Aucun chantier ne correspond à ce filtre.'}
        </div>
      ) : (
        <table>
          <thead>
            <tr><th>Numéro</th><th>Client</th><th>Objet</th><th>Statut</th><th>Préalables</th><th>Dates</th><th /></tr>
          </thead>
          <tbody>
            {visibles.map((c) => {
              const liste = prealablesDu(c, prealables);
              const faits = liste.filter((x) => c.checklist?.[x.cle]).length;
              const total = liste.length;
              return (
                <tr key={c.id} className="cliquable" onClick={() => aller(`/chantiers/${c.id}`)}>
                  <td>{c.numero}</td>
                  <td>{c.tiers?.nom ?? '—'}</td>
                  <td>{c.libelle}</td>
                  <td style={{ borderLeft: `3px solid ${COULEUR_STATUT[c.statut]}` }}>
                    <select value={c.statut} onClick={(e) => e.stopPropagation()}
                            onChange={(e) => void majChantier(c.id, { statut: e.target.value as StatutChantier }).then(recharger)}>
                      {Object.entries(LIBELLE_STATUT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className="num" style={{ color: faits < total ? 'var(--alerte)' : 'var(--vert)' }}>
                    {faits} / {total}
                  </td>
                  <td className="ref">
                    {c.date_debut ? new Date(c.date_debut).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="sans-impression" onClick={(e) => e.stopPropagation()}>
                    <button className="action discret"
                            onClick={() => window.confirm(`Supprimer le chantier ${c.numero} ?`) &&
                              void supprimerChantier(c.id).then(recharger)}>×</button>
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


// --- Création d'un chantier -------------------------------------------------

/**
 * Un chantier naît normalement d'un devis signé. Mais il arrive qu'on démarre
 * sans devis : dépannage, garantie, reprise d'un confrère. Ce formulaire couvre
 * les deux cas, et propose les devis du client dès qu'il est choisi.
 */
function Creation({ onAnnuler, onCree, onErreur }: {
  onAnnuler: () => void;
  onCree: (id: string) => void;
  onErreur: (m: string) => void;
}) {
  const [clients, setClients] = useState<Tiers[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [devis, setDevis] = useState<DevisAvecTiers[]>([]);
  const [suivi, setSuivi] = useState<Map<string, SuiviTiers>>(new Map());
  const [c, setC] = useState<Partial<Chantier>>({ statut: 'a_planifier' });
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    listerTiers().then((t) => setClients(t.filter((x) => x.categorie !== 'fournisseur')))
      .catch((e) => onErreur((e as Error).message));
    listerDevis().then(setDevis).catch(() => setDevis([]));
    suiviParTiers().then(setSuivi).catch(() => setSuivi(new Map()));
  }, [onErreur]);

  // Les sites et les devis se filtrent dès que le client est choisi
  useEffect(() => {
    if (!c.tiers_id) { setSites([]); return; }
    listerSites(c.tiers_id).then((s) => {
      setSites(s);
      setC((p) => ({ ...p, site_id: p.site_id ?? s[0]?.id ?? null }));
    }).catch(() => setSites([]));
  }, [c.tiers_id]);

  const devisDuClient = devis.filter((d) => !c.tiers_id || d.tiers_id === c.tiers_id);

  /** Choisir un devis remplit le libellé et le site à sa place. */
  function choisirDevis(id: string) {
    const d = devis.find((x) => x.id === id);
    setC((p) => ({
      ...p,
      devis_id: id || null,
      tiers_id: d?.tiers_id ?? p.tiers_id,
      site_id: d?.site_id ?? p.site_id,
      libelle: p.libelle || d?.titre || '',
    }));
  }

  async function creer() {
    if (!c.tiers_id) return onErreur('Choisissez un client.');
    if (!c.libelle?.trim()) return onErreur('Donnez un intitulé au chantier.');
    setEnvoi(true);
    try {
      const chantier = await creerChantier({
        tiers_id: c.tiers_id, site_id: c.site_id ?? null, devis_id: c.devis_id ?? null,
        libelle: c.libelle.trim(), statut: c.statut ?? 'a_planifier',
        date_debut: c.date_debut ?? null, date_fin: c.date_fin ?? null,
        notes: c.notes ?? null,
      });
      await ajouterFil({
        tiers_id: c.tiers_id, chantier_id: chantier.id, devis_id: c.devis_id ?? null,
        type: 'systeme', sujet: `Chantier ${chantier.numero} ouvert`,
      });
      onCree(chantier.id);
    } catch (e) { onErreur((e as Error).message); setEnvoi(false); }
  }

  return (
    <Modale titre="Nouveau chantier" onFermer={onAnnuler}>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <label>Client</label>
          <select value={c.tiers_id ?? ''}
                  onChange={(e) => setC((p) => ({
                    ...p, tiers_id: e.target.value || undefined,
                    site_id: null, devis_id: null,
                  }))}>
            <option value="">Choisir…</option>
            {clients.map((x) => {
              const s = suivi.get(x.id);
              // Le suivi apparaît dans le libellé : un select natif ne peut pas
              // porter de pastille, mais il peut porter le compte.
              const marques = [
                s?.devis ? `${s.devis} devis` : null,
                s?.chantiers ? `${s.chantiers} chantier${s.chantiers > 1 ? 's' : ''}` : null,
              ].filter(Boolean).join(', ');
              return (
                <option key={x.id} value={x.id}>
                  {x.nom}{marques ? ` — ${marques}` : ''}
                </option>
              );
            })}
          </select>
          {c.tiers_id && (suivi.get(c.tiers_id)?.chantiersOuverts ?? 0) > 0 && (
            <p className="statut" style={{ color: 'var(--alerte)' }}>
              Ce client a déjà {suivi.get(c.tiers_id)!.chantiersOuverts} chantier
              {suivi.get(c.tiers_id)!.chantiersOuverts > 1 ? 's' : ''} en cours.
              Vérifiez qu’il ne s’agit pas de la même affaire.
            </p>
          )}
        </div>

        <div>
          <label>Devis d’origine</label>
          <select value={c.devis_id ?? ''} onChange={(e) => choisirDevis(e.target.value)}>
            <option value="">Sans devis</option>
            {devisDuClient.map((d) => (
              <option key={d.id} value={d.id}>
                {d.numero} — {d.titre ?? 'sans objet'} ({d.statut})
              </option>
            ))}
          </select>
          <p className="statut">
            Choisir un devis reprend son client, son adresse et son objet.
          </p>
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <label>Intitulé du chantier</label>
          <input value={c.libelle ?? ''} placeholder="Climatisation à condensation, T4"
                 onChange={(e) => setC((p) => ({ ...p, libelle: e.target.value }))} />
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <label>Adresse du chantier</label>
          <select value={c.site_id ?? ''} disabled={sites.length === 0}
                  onChange={(e) => setC((p) => ({ ...p, site_id: e.target.value || null }))}>
            {sites.length === 0
              ? <option value="">Aucun site pour ce client</option>
              : sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.adresse}, {s.ville}</option>
                ))}
          </select>
          {sites.length === 0 && c.tiers_id && (
            <p className="statut">
              Ajoutez un site depuis la fiche du client pour que la TVA se calcule
              correctement : c’est l’année d’achèvement du logement qui décide du taux.
            </p>
          )}
        </div>

        <div>
          <label>Date de début</label>
          <input type="date" value={c.date_debut ?? ''}
                 onChange={(e) => setC((p) => ({ ...p, date_debut: e.target.value || null }))} />
        </div>
        <div>
          <label>Fin prévue</label>
          <input type="date" value={c.date_fin ?? ''}
                 onChange={(e) => setC((p) => ({ ...p, date_fin: e.target.value || null }))} />
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <label>Notes</label>
          <textarea rows={3} value={c.notes ?? ''}
                    placeholder="Code du portail, accès, contrainte de stationnement…"
                    onChange={(e) => setC((p) => ({ ...p, notes: e.target.value }))} />
        </div>

        <p className="statut" style={{ gridColumn: 'span 2' }}>
          Le chantier s’ouvre en « à planifier ». Il ne devrait passer en « planifié »
          qu’une fois les sept préalables levés, sur sa fiche.
        </p>

        <div style={{ gridColumn: 'span 2', display: 'flex', gap: 8 }}>
          <button className="action" onClick={() => void creer()} disabled={envoi}>
            Créer le chantier
          </button>
          <button className="action discret"
                  onClick={() => { setC({ statut: 'a_planifier' }); setSites([]); }}>
            Tout effacer
          </button>
          <button className="action discret" onClick={onAnnuler}>Annuler</button>
        </div>
      </div>
    </Modale>
  );
}
