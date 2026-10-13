import { useCallback, useEffect, useState } from 'react';
import { eur } from '../lib/calcul';
import { listerMembres } from '../lib/db';
import {
  echeanceLisible, enregistrerContrat, listerContrats, planifierVisite, visitesPrevues,
} from '../lib/contrats';
import type { Chantier, ContratEntretien, Intervention, Membre } from '../lib/types';
import Modale from './Modale';

const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

const aujourdhui = () => new Date().toISOString().slice(0, 10);

const dansUnAn = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Les contrats d'entretien d'un client, sur sa fiche.
 *
 * Ce qui compte, c'est la prochaine échéance et si la visite est déjà calée :
 * c'est ce que la cloche rappelle, avec le préavis que chacun a choisi. Le
 * contrat porte un prix ; cet encadré n'est montré qu'à ceux qui voient les
 * prix, et la base le leur réserve de toute façon.
 */
export default function ContratsEntretien({ tiersId, chantiers }: {
  tiersId: string; chantiers: Chantier[];
}) {
  const [contrats, setContrats] = useState<ContratEntretien[]>([]);
  const [visites, setVisites] = useState<Intervention[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [edition, setEdition] = useState<Partial<ContratEntretien> | null>(null);
  const [planif, setPlanif] = useState<{ c: ContratEntretien; date: string; membre: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const recharger = useCallback(() =>
    Promise.all([listerContrats(tiersId), visitesPrevues(), listerMembres()])
      .then(([c, v, m]) => {
        setContrats(c); setVisites(v); setMembres(m.filter((x) => x.actif));
        setErreur(null);
      })
      .catch((e) => setErreur((e as Error).message)), [tiersId]);

  useEffect(() => { void recharger(); }, [recharger]);

  async function enregistrer() {
    if (!edition) return;
    if (!edition.prochaine_echeance) return setErreur('La prochaine échéance est obligatoire.');
    setEnvoi(true);
    try {
      // Le site se lit sur le chantier choisi : il ne se ressaisit pas.
      const chantier = chantiers.find((x) => x.id === edition.chantier_id);
      await enregistrerContrat({
        ...edition, tiers_id: tiersId, site_id: chantier?.site_id ?? edition.site_id ?? null,
      });
      setEdition(null);
      await recharger();
    } catch (e) { setErreur((e as Error).message); }
    setEnvoi(false);
  }

  async function planifier() {
    if (!planif) return;
    setEnvoi(true);
    try {
      await planifierVisite(planif.c, planif.date, planif.membre || null);
      setPlanif(null);
      await recharger();
    } catch (e) { setErreur((e as Error).message); }
    setEnvoi(false);
  }

  const champ = <K extends keyof ContratEntretien>(k: K, v: ContratEntretien[K]) =>
    setEdition((p) => ({ ...p, [k]: v }));

  return (
    <div className="panneau" style={{ display: 'block' }}>
      {erreur && !edition && !planif && <div className="erreur">{erreur}</div>}
      {contrats.length === 0 && !erreur && <p className="statut">Aucun contrat d’entretien.</p>}

      {contrats.map((c) => {
        const chantier = chantiers.find((x) => x.id === c.chantier_id);
        const visite = visites.find((v) => v.contrat_id === c.id);
        const retard = c.prochaine_echeance < new Date().toISOString().slice(0, 10);
        return (
          <div key={c.id} style={{ marginBottom: 12, opacity: c.statut === 'actif' ? 1 : 0.6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{c.libelle}</strong>
              <button className="lien-discret" onClick={() => setEdition(c)}>modifier</button>
            </div>
            <div className="statut">
              Tous les {c.periodicite_mois} mois
              {c.prix_ht != null ? ` · ${eur(c.prix_ht)} HT` : ''}
              {chantier ? ` · ${chantier.numero}` : ''}
              {c.statut !== 'actif' ? ` · ${c.statut === 'suspendu' ? 'suspendu' : 'résilié'}` : ''}
            </div>
            <div style={retard && c.statut === 'actif' ? { color: 'var(--alerte)' } : undefined}>
              Prochain entretien le {date(c.prochaine_echeance)}
              <span className="statut"> ({echeanceLisible(c.prochaine_echeance)})</span>
            </div>
            {visite ? (
              <div className="statut">
                Visite prévue le {visite.date_prevue ? date(visite.date_prevue) : '—'}
                {visite.membre_id ? ` avec ${membres.find((m) => m.id === visite.membre_id)?.nom ?? '—'}` : ', sans intervenant'}
              </div>
            ) : c.statut === 'actif' && (
              <button className="action discret" style={{ marginTop: 4 }}
                      onClick={() => setPlanif({ c, date: c.prochaine_echeance, membre: '' })}>
                Planifier la visite
              </button>
            )}
          </div>
        );
      })}

      <button className="action discret" onClick={() => setEdition({
        libelle: 'Entretien annuel', periodicite_mois: 12, prochaine_echeance: dansUnAn(),
        debut_le: aujourdhui(),
        chantier_id: chantiers[0]?.id ?? null, statut: 'actif',
      })}>
        Nouveau contrat
      </button>

      {edition && (
        <Modale titre={edition.id ? 'Modifier le contrat' : 'Nouveau contrat d’entretien'}
                onFermer={() => setEdition(null)}>
          {erreur && <div className="erreur">{erreur}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <div><label>Libellé</label>
              <input value={edition.libelle ?? ''} onChange={(e) => champ('libelle', e.target.value)} /></div>
            <div><label>Installation</label>
              <select value={edition.chantier_id ?? ''}
                      onChange={(e) => champ('chantier_id', e.target.value || null)}>
                <option value="">Aucun chantier</option>
                {chantiers.map((c) => <option key={c.id} value={c.id}>{c.numero} — {c.libelle}</option>)}
              </select></div>
            <div><label>Périodicité</label>
              <select value={edition.periodicite_mois ?? 12}
                      onChange={(e) => champ('periodicite_mois', Number(e.target.value))}>
                {[3, 6, 12, 24].map((m) => <option key={m} value={m}>Tous les {m} mois</option>)}
              </select></div>
            <div><label>Prochaine échéance</label>
              <input type="date" value={edition.prochaine_echeance ?? ''}
                     onChange={(e) => champ('prochaine_echeance', e.target.value)} /></div>
            <div><label>Début du contrat</label>
              <input type="date" value={edition.debut_le ?? ''}
                     onChange={(e) => champ('debut_le', e.target.value || aujourdhui())} /></div>
            <div><label>Fin (vide : reconduit)</label>
              <input type="date" value={edition.fin_le ?? ''}
                     onChange={(e) => champ('fin_le', e.target.value || null)} /></div>
            <div><label>Prix HT par visite</label>
              <input type="number" className="num" min={0} step="0.01" value={edition.prix_ht ?? ''}
                     onChange={(e) => champ('prix_ht', e.target.value === '' ? null : Number(e.target.value))} /></div>
            <div><label>État</label>
              <select value={edition.statut ?? 'actif'}
                      onChange={(e) => champ('statut', e.target.value as ContratEntretien['statut'])}>
                <option value="actif">Actif</option>
                <option value="suspendu">Suspendu</option>
                <option value="resilie">Résilié</option>
              </select></div>
          </div>
          <label style={{ marginTop: 10 }}>Notes</label>
          <textarea rows={2} value={edition.notes ?? ''} onChange={(e) => champ('notes', e.target.value || null)} />
          {!edition.chantier_id && (
            <p className="statut" style={{ marginTop: 6 }}>
              Sans chantier, la visite planifiée n’aura ni adresse ni machines dans Ma journée.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="action" disabled={envoi} onClick={() => void enregistrer()}>
              {envoi ? '…' : 'Enregistrer'}
            </button>
            <button className="action discret" onClick={() => setEdition(null)}>Annuler</button>
          </div>
        </Modale>
      )}

      {planif && (
        <Modale titre={`Planifier — ${planif.c.libelle}`} taille="petite" onFermer={() => setPlanif(null)}>
          {erreur && <div className="erreur">{erreur}</div>}
          <label>Date de la visite</label>
          <input type="date" value={planif.date}
                 onChange={(e) => setPlanif((p) => p && { ...p, date: e.target.value })} />
          <label style={{ marginTop: 10 }}>Intervenant</label>
          <select value={planif.membre} onChange={(e) => setPlanif((p) => p && { ...p, membre: e.target.value })}>
            <option value="">À affecter plus tard</option>
            {membres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select>
          <p className="statut" style={{ marginTop: 8 }}>
            Une fois la visite terminée, la prochaine échéance avance d’elle-même.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="action" disabled={envoi || !planif.date} onClick={() => void planifier()}>
              {envoi ? '…' : 'Planifier'}
            </button>
            <button className="action discret" onClick={() => setPlanif(null)}>Annuler</button>
          </div>
        </Modale>
      )}
    </div>
  );
}
