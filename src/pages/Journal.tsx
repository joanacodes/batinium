import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { ajouterFil, listerChantiers, listerJournal, traiterFil,
         type ChantierAvecTiers, type EntreeJournal } from '../lib/db';
import type { TypeFil } from '../lib/types';

const LIBELLE: Partial<Record<TypeFil, string>> = {
  note: 'Note', visite: 'Visite', appel_entrant: 'Appel', appel_sortant: 'Appel passé',
  email_recu: 'E-mail', email_envoye: 'E-mail envoyé', sms: 'SMS', systeme: 'Événement',
  relance: 'Relance', devis_envoye: 'Devis envoyé', devis_signe: 'Devis signé',
  appel_manque: 'Appel manqué',
};

/**
 * Journal des chantiers : tout ce qui a été noté sur le terrain, au même endroit.
 * « Le gardien signale que le local est fermé le mercredi » se perd dans une
 * fiche chantier ; ici, il se voit.
 */
export default function PageJournal() {
  const [entrees, setEntrees] = useState<EntreeJournal[]>([]);
  const [chantiers, setChantiers] = useState<ChantierAvecTiers[]>([]);
  const [filtre, setFiltre] = useState('');
  const [recherche, setRecherche] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [nouvelle, setNouvelle] = useState({ chantier_id: '', contenu: '' });

  const recharger = useCallback(async () => {
    try {
      const [j, c] = await Promise.all([listerJournal(), listerChantiers()]);
      setEntrees(j); setChantiers(c);
    } catch (e) { setErreur((e as Error).message); }
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  const q = recherche.trim().toLowerCase();
  const visibles = entrees
    .filter((e) => !filtre || e.chantier_id === filtre)
    .filter((e) => !q || `${e.sujet ?? ''} ${e.contenu ?? ''} ${e.chantier?.libelle ?? ''}`
      .toLowerCase().includes(q));

  // Regroupement par jour, pour que la lecture suive le fil du temps
  const parJour = new Map<string, EntreeJournal[]>();
  for (const e of visibles) {
    const j = e.occurred_at.slice(0, 10);
    if (!parJour.has(j)) parJour.set(j, []);
    parJour.get(j)!.push(e);
  }

  async function noter() {
    if (!nouvelle.chantier_id || !nouvelle.contenu.trim()) {
      return setErreur('Choisissez un chantier et écrivez quelque chose.');
    }
    const c = chantiers.find((x) => x.id === nouvelle.chantier_id);
    try {
      await ajouterFil({
        chantier_id: nouvelle.chantier_id, tiers_id: c?.tiers_id ?? null,
        type: 'note', contenu: nouvelle.contenu.trim(), a_traiter: true,
      });
      setNouvelle({ chantier_id: nouvelle.chantier_id, contenu: '' });
      void recharger();
    } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <>
      <div className="entete">
        <h1>Journal des chantiers</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="Rechercher" value={recherche}
                 onChange={(e) => setRecherche(e.target.value)} style={{ width: 200 }} />
          <select value={filtre} onChange={(e) => setFiltre(e.target.value)} style={{ width: 230 }}>
            <option value="">Tous les chantiers</option>
            {chantiers.map((c) => (
              <option key={c.id} value={c.id}>{c.numero} — {c.libelle}</option>
            ))}
          </select>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="panneau" style={{ gridTemplateColumns: '230px 1fr auto' }}>
        <div>
          <label>Chantier</label>
          <select value={nouvelle.chantier_id}
                  onChange={(e) => setNouvelle((n) => ({ ...n, chantier_id: e.target.value }))}>
            <option value="">Choisir…</option>
            {chantiers.map((c) => <option key={c.id} value={c.id}>{c.numero}</option>)}
          </select>
        </div>
        <div>
          <label>Noter quelque chose</label>
          <input value={nouvelle.contenu} placeholder="Le gardien ferme le local le mercredi"
                 onChange={(e) => setNouvelle((n) => ({ ...n, contenu: e.target.value }))}
                 onKeyDown={(e) => e.key === 'Enter' && void noter()} />
        </div>
        <button className="action" onClick={() => void noter()}>Noter</button>
      </div>

      <p className="statut" style={{ marginBottom: 12 }}>
        Une note de moins de trois jours apparaît aussi dans la cloche : ce qui se dit
        sur le terrain ne doit pas rester sur le terrain.
      </p>

      {visibles.length === 0 ? (
        <div className="vide">Rien de noté pour l’instant.</div>
      ) : (
        [...parJour.entries()].map(([jour, liste]) => (
          <div key={jour} style={{ marginBottom: 18 }}>
            <div style={{
              fontSize: 12, color: 'var(--encre-pale)', paddingBottom: 5,
              borderBottom: '1px solid var(--filet)', marginBottom: 8,
            }}>
              {new Date(jour).toLocaleDateString('fr-FR', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              })}
            </div>
            {liste.map((e) => (
              <div key={e.id} style={{
                background: 'var(--surface)',
                borderLeft: `3px solid ${e.a_traiter ? 'var(--alerte)' : 'var(--filet)'}`,
                padding: '9px 14px', marginBottom: 5,
                display: 'flex', gap: 12, alignItems: 'start',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="statut">
                    {LIBELLE[e.type] ?? e.type}
                    {' · '}
                    {new Date(e.occurred_at).toLocaleTimeString('fr-FR',
                      { hour: '2-digit', minute: '2-digit' })}
                    {e.auteur ? ` · ${e.auteur}` : ''}
                  </div>
                  {e.sujet && <div><strong>{e.sujet}</strong></div>}
                  {e.contenu && <div>{e.contenu}</div>}
                  {e.chantier && (
                    <button className="statut"
                            style={{ border: 0, background: 'none', padding: 0,
                                     color: 'var(--bleu)', cursor: 'pointer' }}
                            onClick={() => aller(`/chantiers/${e.chantier!.id}`)}>
                      {e.chantier.numero} — {e.chantier.libelle}
                    </button>
                  )}
                </div>
                {e.a_traiter && (
                  <button className="action discret" style={{ padding: '2px 9px' }}
                          onClick={() => void traiterFil(e.id).then(recharger)}>
                    Vu
                  </button>
                )}
              </div>
            ))}
          </div>
        ))
      )}
    </>
  );
}
