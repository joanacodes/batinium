import { useCallback, useEffect, useState } from 'react';
import {
  basculerTache, enregistrerTache, listerMembres, listerTaches, reordonnerTaches, supprimerTache,
} from '../lib/db';
import type { Membre, Priorite, Tache } from '../lib/types';
import Menu from '../components/Menu';
import Bulle from '../components/Bulle';

export const LIBELLE_PRIORITE: Record<Priorite, string> = {
  urgente: 'Urgente', haute: 'Haute', normale: 'Normale', basse: 'Basse',
};
const POIDS: Record<Priorite, number> = { urgente: 0, haute: 1, normale: 2, basse: 3 };

export type Tri = 'rang' | 'echeance' | 'priorite';

/** Trie une liste de tâches selon le mode choisi. Partagé avec le tableau de bord. */
export function trier(taches: Tache[], tri: Tri): Tache[] {
  const c = [...taches];
  if (tri === 'echeance') {
    // Sans échéance, une tâche part en fin de liste plutôt que de remonter.
    return c.sort((a, b) => (a.echeance ?? '9999').localeCompare(b.echeance ?? '9999'));
  }
  if (tri === 'priorite') {
    return c.sort((a, b) => POIDS[a.priorite] - POIDS[b.priorite] ||
      (a.echeance ?? '9999').localeCompare(b.echeance ?? '9999'));
  }
  return c.sort((a, b) => a.rang - b.rang);
}

export default function PageTaches() {
  const [taches, setTaches] = useState<Tache[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [tri, setTri] = useState<Tri>('rang');
  const [vue, setVue] = useState<'a_faire' | 'faites' | 'toutes'>('a_faire');
  const [etiquette, setEtiquette] = useState('');
  const [recherche, setRecherche] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [glisse, setGlisse] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try {
      // On charge toujours tout : le filtre se fait à l'affichage, ce qui
      // permet d'annoncer le nombre de tâches faites même quand on les masque.
      const [t, m] = await Promise.all([listerTaches(true), listerMembres()]);
      setTaches(t); setMembres(m);
    } catch (e) { setErreur((e as Error).message); }
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  async function patcher(id: string, patch: Partial<Tache>) {
    setTaches((p) => p.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try { await enregistrerTache({ id, ...patch }); }
    catch (e) { setErreur((e as Error).message); void recharger(); }
  }

  /** Décale une tâche d'un cran, sans souris. Plus sûr que le glisser-déposer. */
  async function decaler(id: string, sens: -1 | 1) {
    const ordonnees = trier(taches, 'rang');
    const i = ordonnees.findIndex((t) => t.id === id);
    const j = i + sens;
    if (i < 0 || j < 0 || j >= ordonnees.length) return;
    [ordonnees[i], ordonnees[j]] = [ordonnees[j], ordonnees[i]];
    setTaches(ordonnees.map((t, k) => ({ ...t, rang: k })));
    try { await reordonnerTaches(ordonnees.map((t) => t.id)); }
    catch (e) { setErreur((e as Error).message); void recharger(); }
  }

  async function placer(id: string, position: number) {
    const ordonnees = trier(taches, 'rang');
    const i = ordonnees.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [deplacee] = ordonnees.splice(i, 1);
    ordonnees.splice(position, 0, deplacee);
    setTaches(ordonnees.map((t, k) => ({ ...t, rang: k })));
    try { await reordonnerTaches(ordonnees.map((t) => t.id)); }
    catch (e) { setErreur((e as Error).message); void recharger(); }
  }

  /** Déplacement à la souris : n'a de sens qu'en tri manuel. */
  async function deposer(cible: string) {
    if (!glisse || glisse === cible || tri !== 'rang') return;
    const ordonnees = trier(taches, 'rang');
    const depuis = ordonnees.findIndex((t) => t.id === glisse);
    const vers = ordonnees.findIndex((t) => t.id === cible);
    if (depuis < 0 || vers < 0) return;
    const [deplacee] = ordonnees.splice(depuis, 1);
    ordonnees.splice(vers, 0, deplacee);
    setTaches(ordonnees.map((t, i) => ({ ...t, rang: i })));
    setGlisse(null);
    try { await reordonnerTaches(ordonnees.map((t) => t.id)); }
    catch (e) { setErreur((e as Error).message); void recharger(); }
  }

  const etiquettes = [...new Set(taches.flatMap((t) => t.etiquettes))].sort();
  const q = recherche.trim().toLowerCase();
  const visibles = trier(
    taches
      .filter((t) => vue === 'toutes' || (vue === 'faites' ? t.faite : !t.faite))
      .filter((t) => !etiquette || t.etiquettes.includes(etiquette))
      .filter((t) => !q ||
        `${t.titre} ${t.detail ?? ''} ${t.etiquettes.join(' ')}`.toLowerCase().includes(q)),
    tri,
  );
  const aujourdhui = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="entete">
        <h1>Tâches</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="Rechercher une tâche" value={recherche}
                 onChange={(e) => setRecherche(e.target.value)} style={{ width: 220 }} />
          <select value={tri} onChange={(e) => setTri(e.target.value as Tri)} style={{ width: 200 }}>
            <option value="rang">Dans mon ordre</option>
            <option value="echeance">Par échéance</option>
            <option value="priorite">Par importance</option>
          </select>
          {etiquettes.length > 0 && (
            <select value={etiquette} onChange={(e) => setEtiquette(e.target.value)} style={{ width: 170 }}>
              <option value="">Toutes les étiquettes</option>
              {etiquettes.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
          {([
            ['a_faire', 'À faire', taches.filter((t) => !t.faite).length],
            ['faites', 'Faites', taches.filter((t) => t.faite).length],
            ['toutes', 'Toutes', taches.length],
          ] as const).map(([cle, libelle, compte]) => (
            <button key={cle} onClick={() => setVue(cle)}
              style={{
                font: 'inherit', fontSize: 13, cursor: 'pointer', padding: '5px 12px',
                borderRadius: 3, whiteSpace: 'nowrap',
                border: `1px solid ${vue === cle ? 'var(--bleu)' : 'var(--filet)'}`,
                background: vue === cle ? 'var(--bleu-pale)' : 'var(--surface)',
                color: vue === cle ? 'var(--encre)' : 'var(--encre-pale)',
              }}>
              {libelle}<span className="num" style={{ opacity: .6, marginLeft: 6 }}>{compte}</span>
            </button>
          ))}
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <Ajout membres={membres} onErreur={setErreur} onCree={recharger} />

      {tri === 'rang' && visibles.length > 1 && (
        <p className="statut" style={{ marginBottom: 8 }}>
          Attrapez les trois points d’une ligne pour la déplacer, ou cliquez dessus
          pour la monter d’un cran. L’ordre est enregistré aussitôt.
        </p>
      )}

      {visibles.length === 0 ? (
        <div className="vide">
          {q ? 'Aucune tâche ne correspond à cette recherche.'
             : vue === 'faites' ? 'Aucune tâche terminée pour l’instant.'
             : 'Aucune tâche. Ajoutez-en une ci-dessus.'}
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 34 }} />
              <th style={{ width: 40 }} />
              <th>Tâche</th>
              <th style={{ width: 150 }}>Échéance</th>
              <th style={{ width: 130 }}>Importance</th>
              <th style={{ width: 160 }}>Étiquettes</th>
              <th style={{ width: 150 }}>Pour</th>
              <th style={{ width: 40 }} className="sans-impression" />
            </tr>
          </thead>
          <tbody>
            {visibles.map((t) => {
              const retard = !t.faite && t.echeance && t.echeance < aujourdhui;
              return (
                <tr key={t.id}
                    draggable={tri === 'rang'}
                    onDragStart={() => setGlisse(t.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => void deposer(t.id)}
                    style={{
                      background: retard ? '#fdf3f2' : undefined,
                      opacity: t.faite ? 0.5 : 1,
                    }}>
                  <td style={{ textAlign: 'center' }}>
                    {tri === 'rang' ? (
                      <Bulle texte="Attrapez ce point pour déplacer la tâche.">
                        <Menu poignee titre="Déplacer ou agir" actions={[
                          { libelle: 'Monter d’un cran', faire: () => void decaler(t.id, -1) },
                          { libelle: 'Descendre d’un cran', faire: () => void decaler(t.id, 1) },
                          { libelle: 'Mettre tout en haut', faire: () => void placer(t.id, 0) },
                          { libelle: t.faite ? 'Rouvrir' : 'Marquer faite',
                            faire: () => void basculerTache(t.id, !t.faite).then(recharger) },
                          { libelle: 'Supprimer', danger: true,
                            faire: () => void supprimerTache(t.id).then(recharger) },
                        ]} />
                      </Bulle>
                    ) : (
                      <Menu titre="Actions" actions={[
                        { libelle: t.faite ? 'Rouvrir' : 'Marquer faite',
                          faire: () => void basculerTache(t.id, !t.faite).then(recharger) },
                        { libelle: 'Supprimer', danger: true,
                          faire: () => void supprimerTache(t.id).then(recharger) },
                      ]} />
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={t.faite} style={{ width: 'auto' }}
                           onChange={(e) => void basculerTache(t.id, e.target.checked).then(recharger)} />
                  </td>
                  <td>
                    <input defaultValue={t.titre}
                           onBlur={(e) => void patcher(t.id, { titre: e.target.value })}
                           style={{
                             border: 0, background: 'transparent', padding: 0,
                             textDecoration: t.faite ? 'line-through' : undefined,
                           }} />
                    {t.detail && <div className="fiche">{t.detail}</div>}
                  </td>
                  <td>
                    <input type="date" value={t.echeance ?? ''}
                           onChange={(e) => void patcher(t.id, { echeance: e.target.value || null })} />
                  </td>
                  <td>
                    <select value={t.priorite}
                            onChange={(e) => void patcher(t.id, { priorite: e.target.value as Priorite })}>
                      {Object.entries(LIBELLE_PRIORITE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td>
                    <input defaultValue={t.etiquettes.join(', ')} placeholder="relance, urgent"
                           onBlur={(e) => void patcher(t.id, {
                             etiquettes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean),
                           })}
                           style={{ border: 0, background: 'transparent', padding: 0, fontSize: 12 }} />
                  </td>
                  <td>
                    <select value={t.assignee_id ?? ''}
                            onChange={(e) => void patcher(t.id, { assignee_id: e.target.value || null })}>
                      <option value="">—</option>
                      {membres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                    </select>
                  </td>
                  <td className="sans-impression">
                    <button className="action discret" style={{ padding: '2px 8px' }}
                            onClick={() => void supprimerTache(t.id).then(recharger)}>×</button>
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

function Ajout({ membres, onErreur, onCree }:
  { membres: Membre[]; onErreur: (m: string) => void; onCree: () => void }) {
  const [t, setT] = useState<Partial<Tache>>({ priorite: 'normale' });
  const [etiquettesSaisies, setEtiquettesSaisies] = useState('');

  async function ajouter() {
    if (!t.titre?.trim()) return;
    const etiquettes = etiquettesSaisies
      .split(',').map((x) => x.trim()).filter(Boolean);
    try {
      await enregistrerTache({ ...t, etiquettes });
      setT({ priorite: 'normale' });
      setEtiquettesSaisies('');
      onCree();
    } catch (e) { onErreur((e as Error).message); }
  }

  return (
    <div className="panneau" style={{ gridTemplateColumns: '2fr 1.2fr 1fr 1fr 1fr auto' }}>
      <div>
        <label>Nouvelle tâche</label>
        <input value={t.titre ?? ''} placeholder="Rappeler M. Dubois pour son devis"
               onChange={(e) => setT((p) => ({ ...p, titre: e.target.value }))}
               onKeyDown={(e) => e.key === 'Enter' && void ajouter()} />
      </div>
      <div>
        <label>Étiquettes</label>
        <input value={etiquettesSaisies} placeholder="relance, urgent"
               onChange={(e) => setEtiquettesSaisies(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && void ajouter()} />
      </div>
      <div>
        <label>Échéance</label>
        <input type="date" value={t.echeance ?? ''}
               onChange={(e) => setT((p) => ({ ...p, echeance: e.target.value || null }))} />
      </div>
      <div>
        <label>Importance</label>
        <select value={t.priorite}
                onChange={(e) => setT((p) => ({ ...p, priorite: e.target.value as Priorite }))}>
          {Object.entries(LIBELLE_PRIORITE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label>Pour</label>
        <select value={t.assignee_id ?? ''}
                onChange={(e) => setT((p) => ({ ...p, assignee_id: e.target.value || null }))}>
          <option value="">—</option>
          {membres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
        </select>
      </div>
      <button className="action" onClick={() => void ajouter()}>Ajouter</button>
    </div>
  );
}
