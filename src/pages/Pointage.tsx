import { useCallback, useEffect, useState } from 'react';
import { estDirection, membre as moi, voitLesPrix } from '../lib/session';
import {
  enregistrerPointage, heuresLisibles, listerChantiers, listerMembres, listerPointages,
  supprimerPointage, TYPES_POINTAGE, validerPointages,
  type ChantierAvecTiers, type PointageDetaille,
} from '../lib/db';
import type { Membre, Pointage, TypePointage } from '../lib/types';
import FilAriane from '../components/FilAriane';
import Dictee from '../components/Dictee';

/**
 * Le pointage des heures.
 *
 * Deux écrans en un, parce que ce sont deux gestes qui n'ont rien en commun.
 * Le poseur déclare : une date, un chantier, un nombre d'heures, et il range
 * son téléphone. La direction relit, corrige et valide, puis retrouve ces
 * heures dans le coût réel de chaque chantier.
 *
 * La saisie est en heures décimales — 7,5 plutôt qu'un début et une fin.
 * Un début et une fin obligent à se souvenir de l'heure d'arrivée et à
 * décompter la pause : trois champs et une soustraction là où un seul chiffre
 * suffit. L'affichage, lui, remet des « 7 h 30 », parce que personne ne lit
 * une feuille d'heures en décimal.
 */

const RACCOURCIS = [3.5, 4, 7, 7.5, 8];

export default function PagePointage() {
  const [pointages, setPointages] = useState<PointageDetaille[]>([]);
  const [chantiers, setChantiers] = useState<ChantierAvecTiers[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [parMembre, setParMembre] = useState('');
  const [parChantier, setParChantier] = useState('');
  const [cadre, setCadre] = useState<'semaine' | 'mois' | 'mois_dernier' | 'tout'>('semaine');

  const direction = estDirection();
  const [saisie, setSaisie] = useState<Partial<Pointage>>({
    jour: new Date().toISOString().slice(0, 10), type: 'pose',
  });

  const bornes = (() => {
    const n = new Date();
    const j = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (cadre === 'tout') return { depuis: undefined, jusqu: undefined };
    if (cadre === 'mois') {
      return { depuis: j(new Date(n.getFullYear(), n.getMonth(), 1)),
               jusqu: j(new Date(n.getFullYear(), n.getMonth() + 1, 0)) };
    }
    if (cadre === 'mois_dernier') {
      return { depuis: j(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
               jusqu: j(new Date(n.getFullYear(), n.getMonth(), 0)) };
    }
    // Semaine glissante : sept jours en arrière, pas la semaine civile — c'est
    // ce qu'on veut voir un jeudi soir quand on rattrape son pointage.
    const debut = new Date(n);
    debut.setDate(debut.getDate() - 6);
    return { depuis: j(debut), jusqu: j(n) };
  })();

  const recharger = useCallback(async () => {
    try {
      const [p, c, m] = await Promise.all([
        listerPointages({ depuis: bornes.depuis, jusqu: bornes.jusqu }),
        listerChantiers().catch(() => []),
        listerMembres().catch(() => []),
      ]);
      setPointages(p); setChantiers(c); setMembres(m.filter((x) => x.actif));
    } catch (e) { setErreur((e as Error).message); }
    setCharge(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bornes.depuis, bornes.jusqu]);

  useEffect(() => { void recharger(); }, [recharger]);

  async function ajouter() {
    if (!saisie.heures) return setErreur('Indiquez un nombre d’heures.');
    if (!saisie.jour) return setErreur('Indiquez la date.');
    try {
      await enregistrerPointage({
        ...saisie,
        membre_id: direction && parMembre ? parMembre : moi().id,
        chantier_id: saisie.chantier_id || null,
      });
      setSaisie({ jour: saisie.jour, type: saisie.type ?? 'pose' });
      setErreur(null);
      void recharger();
    } catch (e) { setErreur((e as Error).message); }
  }

  if (!charge) return <p className="statut">Chargement…</p>;

  const visibles = pointages
    .filter((p) => !parMembre || p.membre_id === parMembre)
    .filter((p) => !parChantier
      || (parChantier === 'aucun' ? !p.chantier_id : p.chantier_id === parChantier));

  const total = visibles.reduce((s, p) => s + Number(p.heures), 0);
  const aValider = visibles.filter((p) => !p.valide);
  const surChantier = visibles.filter((p) => p.chantier_id)
    .reduce((s, p) => s + Number(p.heures), 0);

  // Regroupement par jour : c'est ainsi qu'on relit une feuille d'heures.
  const jours = [...new Set(visibles.map((p) => p.jour))].sort().reverse();

  const basculer = (id: string) => setSelection((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <>
      <FilAriane etapes={[
        { libelle: 'Aujourd’hui', vers: '/bord' },
        { libelle: direction ? 'Heures de l’équipe' : 'Mes heures' },
      ]} />

      <div className="entete">
        <h1>{direction ? 'Heures de l’équipe' : 'Mes heures'}</h1>
        {direction && selection.size > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="action discret"
                    onClick={() => void validerPointages([...selection], false)
                      .then(() => { setSelection(new Set()); recharger(); })
                      .catch((e) => setErreur((e as Error).message))}>
              Rouvrir ({selection.size})
            </button>
            <button className="action"
                    onClick={() => void validerPointages([...selection])
                      .then(() => { setSelection(new Set()); recharger(); })
                      .catch((e) => setErreur((e as Error).message))}>
              Valider ({selection.size})
            </button>
          </div>
        )}
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="panneau" style={{ display: 'block' }}>
        <h3 style={{ marginBottom: 10 }}>Déclarer des heures</h3>
        <div style={{ display: 'grid', gap: 10, alignItems: 'end',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <div>
            <label>Jour</label>
            <input type="date" value={saisie.jour ?? ''}
                   max={new Date().toISOString().slice(0, 10)}
                   onChange={(e) => setSaisie((p) => ({ ...p, jour: e.target.value }))} />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label>Chantier</label>
            <select value={saisie.chantier_id ?? ''}
                    onChange={(e) => setSaisie((p) => ({ ...p, chantier_id: e.target.value || null }))}>
              <option value="">Hors chantier — atelier, agence, trajet</option>
              {chantiers.map((c) => (
                <option key={c.id} value={c.id}>{c.numero} — {c.libelle}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Nature</label>
            <select value={saisie.type ?? 'pose'}
                    onChange={(e) => setSaisie((p) => ({ ...p, type: e.target.value as TypePointage }))}>
              {Object.entries(TYPES_POINTAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label>Heures</label>
            <input type="number" step="0.25" min="0.25" max="24" className="num"
                   value={saisie.heures ?? ''}
                   onChange={(e) => setSaisie((p) => ({
                     ...p, heures: e.target.value ? Number(e.target.value) : undefined }))} />
          </div>
          <button className="action" onClick={() => void ajouter()}>Enregistrer</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="statut" style={{ alignSelf: 'center' }}>Journées courantes :</span>
          {RACCOURCIS.map((h) => (
            <button key={h} className="action discret" style={{ padding: '2px 12px' }}
                    onClick={() => setSaisie((p) => ({ ...p, heures: h }))}>
              {heuresLisibles(h)}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 10 }}>
          <label>Commentaire</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={saisie.commentaire ?? ''} style={{ flex: 1 }}
                   placeholder="Reprise du percement, attente de la nacelle…"
                   onChange={(e) => setSaisie((p) => ({ ...p, commentaire: e.target.value || null }))} />
            <Dictee onErreur={setErreur}
                    onTexte={(t) => setSaisie((p) => ({
                      ...p, commentaire: p.commentaire ? `${p.commentaire} ${t}` : t }))} />
          </div>
        </div>

        {direction && (
          <p className="statut" style={{ marginTop: 8 }}>
            Vous saisissez pour vous-même, sauf si un salarié est choisi dans le filtre
            ci-dessous — pratique pour rattraper un carnet papier.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={cadre} onChange={(e) => setCadre(e.target.value as typeof cadre)}
                style={{ width: 190 }}>
          <option value="semaine">Sept derniers jours</option>
          <option value="mois">Mois en cours</option>
          <option value="mois_dernier">Mois dernier</option>
          <option value="tout">Tout</option>
        </select>
        {direction && (
          <select value={parMembre} onChange={(e) => setParMembre(e.target.value)}
                  style={{ width: 190 }}>
            <option value="">Toute l’équipe</option>
            {membres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select>
        )}
        <select value={parChantier} onChange={(e) => setParChantier(e.target.value)}
                style={{ width: 240 }}>
          <option value="">Tous les chantiers</option>
          <option value="aucun">Hors chantier</option>
          {chantiers.map((c) => (
            <option key={c.id} value={c.id}>{c.numero} — {c.libelle}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gap: 12, marginBottom: 16,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Chiffre libelle="Total sur la période" valeur={heuresLisibles(total)} />
        <Chiffre libelle="Sur un chantier" valeur={heuresLisibles(surChantier)}
                 note={`${((surChantier / (total || 1)) * 100).toFixed(0)} % du temps`} />
        <Chiffre libelle="En attente de validation" valeur={aValider.length}
                 alerte={direction && aValider.length > 0} />
      </div>

      {visibles.length === 0 ? (
        <div className="vide">
          Aucune heure déclarée sur cette période. Le formulaire ci-dessus prend
          quinze secondes.
        </div>
      ) : (
        <div className="tableau-defilant">
          <table>
            <thead>
              <tr>
                {direction && <th style={{ width: 34 }} />}
                <th style={{ width: 96 }}>Jour</th>
                {direction && <th style={{ width: 140 }}>Qui</th>}
                <th style={{ width: 200 }}>Chantier</th>
                <th style={{ width: 120 }}>Nature</th>
                <th>Commentaire</th>
                <th className="num" style={{ width: 90 }}>Heures</th>
                <th style={{ width: 100 }}>État</th>
                <th style={{ width: 40 }} className="sans-impression" />
              </tr>
            </thead>
            <tbody>
              {jours.map((jour) => {
                const duJour = visibles.filter((p) => p.jour === jour);
                const totalJour = duJour.reduce((s, p) => s + Number(p.heures), 0);
                return (
                  <>
                    {duJour.map((p, i) => (
                      <tr key={p.id} style={p.valide ? { opacity: 0.72 } : undefined}>
                        {direction && (
                          <td>
                            <input type="checkbox" style={{ width: 'auto' }}
                                   aria-label="Sélectionner cette ligne"
                                   checked={selection.has(p.id)} onChange={() => basculer(p.id)} />
                          </td>
                        )}
                        <td className="num ref">
                          {i === 0 && (
                            <>
                              {new Date(jour).toLocaleDateString('fr-FR',
                                { weekday: 'short', day: '2-digit', month: '2-digit' })}
                              <div className="statut">{heuresLisibles(totalJour)}</div>
                            </>
                          )}
                        </td>
                        {direction && <td>{p.membre?.nom ?? '—'}</td>}
                        <td className="ref">
                          {p.chantier
                            ? <a href={`#/chantiers/${p.chantier.id}`}>{p.chantier.numero}</a>
                            : <span className="statut">hors chantier</span>}
                        </td>
                        <td className="statut">{TYPES_POINTAGE[p.type] ?? p.type}</td>
                        <td className="fiche">{p.commentaire ?? ''}</td>
                        <td className="num" style={{ fontWeight: 600 }}>
                          {heuresLisibles(Number(p.heures))}
                        </td>
                        <td>
                          <span className="jeton" data-r={p.valide ? 'recu' : undefined}>
                            {p.valide ? 'validé' : 'déclaré'}
                          </span>
                        </td>
                        <td className="sans-impression">
                          {(!p.valide || direction) && (
                            <button className="action discret" style={{ padding: '2px 7px' }}
                                    title="Supprimer cette ligne"
                                    onClick={() => {
                                      if (window.confirm('Supprimer cette déclaration ?')) {
                                        void supprimerPointage(p.id).then(recharger)
                                          .catch((e) => setErreur((e as Error).message));
                                      }
                                    }}>×</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {voitLesPrix() && (
        <div className="panneau" style={{ display: 'block', marginTop: 18,
                                          borderLeft: '3px solid var(--bleu)' }}>
          <h3 style={{ marginBottom: 6 }}>À quoi servent ces heures</h3>
          <p className="statut">
            Elles alimentent le coût réel de chaque chantier dans Rentabilité, au taux
            horaire en vigueur <strong>le jour travaillé</strong> — une augmentation en
            avril ne renchérit pas un chantier de février. Le détail par personne ne
            remonte jamais : Rentabilité ne reçoit qu’un total par chantier.
          </p>
          <p className="statut">
            Il manque encore les factures fournisseurs rapprochées ligne à ligne pour
            que la marge d’un chantier soit entièrement réelle. C’est le module achats.
          </p>
        </div>
      )}
    </>
  );
}

function Chiffre({ libelle, valeur, note, alerte }:
  { libelle: string; valeur: string | number; note?: string; alerte?: boolean }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--filet)',
      borderLeft: `3px solid ${alerte ? 'var(--alerte)' : 'var(--filet)'}`, padding: '12px 14px',
    }}>
      <div className="statut">{libelle}</div>
      <div className="num" style={{ fontSize: 23, fontWeight: 600, textAlign: 'left' }}>{valeur}</div>
      {note && <div className="statut">{note}</div>}
    </div>
  );
}
