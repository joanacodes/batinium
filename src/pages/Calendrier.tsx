import { useCallback, useEffect, useMemo, useState } from 'react';
import { aller } from '../lib/router';
import { jetonGoogle } from '../lib/session';
import { evenements, type EvenementGoogle } from '../lib/gcal';
import { listerChantiers, listerDemandes, listerInterventions, listerTaches } from '../lib/db';
import type { Chantier, Demande, Intervention, Tache } from '../lib/types';
import Modale from '../components/Modale';

type Source = 'intervention' | 'chantier' | 'tache' | 'rappel' | 'google';

interface Evenement {
  id: string;
  jour: string;      // AAAA-MM-JJ
  heure?: string;
  titre: string;
  source: Source;
  lien?: string;
}

const COULEUR: Record<Source, string> = {
  intervention: 'var(--bleu)',
  chantier: '#7a5ea8',
  tache: '#b8860b',
  rappel: 'var(--alerte)',
  google: 'var(--encre-pale)',
};

const LIBELLE: Record<Source, string> = {
  intervention: 'Intervention', chantier: 'Chantier', tache: 'Tâche',
  rappel: 'Rappel client', google: 'Agenda Google',
};

const iso = (d: Date) => {
  const c = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return c.toISOString().slice(0, 10);
};

export default function PageCalendrier() {
  const [mois, setMois] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [demandes, setDemandes] = useState<Demande[]>([]);
  const [google, setGoogle] = useState<EvenementGoogle[]>([]);
  const [erreurGoogle, setErreurGoogle] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  // Filtre d'affichage : chacun choisit ce qu'il veut voir sur sa grille.
  const [actives, setActives] = useState<Set<Source>>(
    new Set(['intervention', 'chantier', 'tache', 'rappel', 'google'] as Source[]),
  );

  const debut = useMemo(() => new Date(mois.getFullYear(), mois.getMonth(), 1), [mois]);
  const fin = useMemo(() => new Date(mois.getFullYear(), mois.getMonth() + 1, 0), [mois]);

  const recharger = useCallback(async () => {
    try {
      const [i, c, t, d] = await Promise.all([
        listerInterventions(), listerChantiers(), listerTaches(), listerDemandes(),
      ]);
      setInterventions(i); setChantiers(c); setTaches(t); setDemandes(d);
    } catch (e) { setErreur((e as Error).message); }

    if (jetonGoogle()) {
      try {
        setGoogle(await evenements(debut, new Date(fin.getTime() + 86400000)));
        setErreurGoogle(null);
      } catch (e) {
        setGoogle([]);
        setErreurGoogle((e as Error).message);
      }
    }
  }, [debut, fin]);

  useEffect(() => { void recharger(); }, [recharger]);

  const evts: Evenement[] = useMemo(() => {
    const e: Evenement[] = [];
    for (const i of interventions) {
      if (!i.date_prevue || i.statut === 'annulee') continue;
      e.push({
        id: `i-${i.id}`, jour: i.date_prevue, titre: i.type.replace(/_/g, ' '),
        source: 'intervention', lien: i.chantier_id ? `#/chantiers/${i.chantier_id}` : undefined,
      });
    }
    // Un chantier occupe une bande de jours, pas un point
    for (const c of chantiers) {
      if (!c.date_debut) continue;
      const d0 = new Date(c.date_debut);
      const d1 = c.date_fin ? new Date(c.date_fin) : d0;
      for (let j = new Date(d0); j <= d1; j.setDate(j.getDate() + 1)) {
        e.push({ id: `c-${c.id}-${iso(j)}`, jour: iso(j), titre: c.libelle,
                 source: 'chantier', lien: `#/chantiers/${c.id}` });
      }
    }
    for (const t of taches) {
      if (!t.echeance) continue;
      e.push({ id: `t-${t.id}`, jour: t.echeance, titre: t.titre, source: 'tache', lien: '#/taches' });
    }
    for (const d of demandes) {
      if (!d.rappeler_le || d.repondu) continue;
      e.push({ id: `r-${d.id}`, jour: d.rappeler_le,
               titre: `Rappeler ${d.nom ?? d.telephone ?? 'client'}`,
               source: 'rappel', lien: '#/demandes' });
    }
    for (const g of google) {
      e.push({
        id: `g-${g.id}`, jour: iso(g.debut), titre: g.titre, source: 'google',
        heure: g.journeeEntiere ? undefined
          : g.debut.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        lien: g.lien,
      });
    }
    return e;
  }, [interventions, chantiers, taches, demandes, google]);

  const parJour = useMemo(() => {
    const m = new Map<string, Evenement[]>();
    for (const x of evts) {
      if (!actives.has(x.source)) continue;
      if (!m.has(x.jour)) m.set(x.jour, []);
      m.get(x.jour)!.push(x);
    }
    return m;
  }, [evts, actives]);

  // La grille commence toujours un lundi
  const cases: Date[] = useMemo(() => {
    const premier = new Date(debut);
    const decalage = (premier.getDay() + 6) % 7;
    premier.setDate(premier.getDate() - decalage);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(premier);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [debut]);

  const aujourdhui = iso(new Date());

  return (
    <>
      <div className="entete">
        <h1>Calendrier</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="action discret"
                  onClick={() => setMois(new Date(mois.getFullYear(), mois.getMonth() - 1, 1))}>←</button>
          <strong style={{ minWidth: 160, textAlign: 'center' }}>
            {debut.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
          </strong>
          <button className="action discret"
                  onClick={() => setMois(new Date(mois.getFullYear(), mois.getMonth() + 1, 1))}>→</button>
          <button className="action discret" onClick={() => {
            const d = new Date();
            setMois(new Date(d.getFullYear(), d.getMonth(), 1));
          }}>Ce mois</button>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {!jetonGoogle() && (
        <p className="statut" style={{ marginBottom: 10 }}>
          Votre agenda Google n’est pas connecté. Rendez-vous dans Connexions pour l’afficher ici.
        </p>
      )}
      {erreurGoogle === 'JETON_EXPIRE' && (
        <div className="erreur">
          La session Google a expiré, l’agenda n’est pas à jour. Reconnectez-vous depuis Connexions.
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12,
                    alignItems: 'center' }}>
        <span className="statut">Afficher :</span>
        {(Object.keys(LIBELLE) as Source[]).map((s) => {
          const active = actives.has(s);
          const compte = evts.filter((e) => e.source === s).length;
          return (
            <button key={s} onClick={() => setActives((p) => {
              const n = new Set(p);
              if (n.has(s)) n.delete(s); else n.add(s);
              return n;
            })}
            style={{
              display: 'flex', gap: 6, alignItems: 'center', font: 'inherit', fontSize: 12,
              cursor: 'pointer', padding: '3px 9px',
              border: `1px solid ${active ? COULEUR[s] : 'var(--filet)'}`,
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--encre)' : 'var(--encre-pale)',
              borderRadius: 3,
            }}>
              <i style={{ width: 9, height: 9, borderRadius: 2, display: 'inline-block',
                          background: active ? COULEUR[s] : 'var(--filet)' }} />
              {LIBELLE[s]}
              <span className="num" style={{ opacity: .6 }}>{compte}</span>
            </button>
          );
        })}
      </div>

      <div className="calendrier">
        {['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((j) => (
          <div key={j} className="cal-jour-nom">{j}</div>
        ))}
        {cases.map((d) => {
          const k = iso(d);
          const dedans = d.getMonth() === debut.getMonth();
          const liste = parJour.get(k) ?? [];
          return (
            <div key={k} className="cal-case" data-hors={dedans ? 'non' : 'oui'}
                 data-aujourdhui={k === aujourdhui ? 'oui' : 'non'}
                 onClick={() => setSelection(k)}>
              <div className="cal-numero">{d.getDate()}</div>
              {liste.slice(0, 3).map((e) => (
                <div key={e.id} className="cal-evt" style={{ borderLeftColor: COULEUR[e.source] }}
                     title={`${LIBELLE[e.source]} — ${e.titre}`}>
                  {e.heure ? `${e.heure} ` : ''}{e.titre}
                </div>
              ))}
              {liste.length > 3 && <div className="statut">+ {liste.length - 3}</div>}
            </div>
          );
        })}
      </div>

      {selection && (
        <Modale
          titre={new Date(selection).toLocaleDateString('fr-FR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          })}
          onFermer={() => setSelection(null)}
        >
          {(parJour.get(selection) ?? []).length === 0 ? (
            <p className="statut">
              Rien de prévu ce jour, ou tout est masqué par les filtres du haut.
            </p>
          ) : (
            (parJour.get(selection) ?? []).map((e) => (
              <div key={e.id} style={{
                borderLeft: `3px solid ${COULEUR[e.source]}`,
                background: 'var(--papier)',
                padding: '10px 14px', marginBottom: 7,
              }}>
                <div className="statut">
                  {LIBELLE[e.source]}{e.heure ? ` · ${e.heure}` : ''}
                </div>
                <div style={{ fontSize: 15 }}>
                  {e.lien
                    ? (e.lien.startsWith('#')
                        ? <a href={e.lien}
                             onClick={() => { setSelection(null); aller(e.lien!.slice(1)); }}>
                            {e.titre}
                          </a>
                        : <a href={e.lien} target="_blank" rel="noreferrer">{e.titre}</a>)
                    : e.titre}
                </div>
              </div>
            ))
          )}
        </Modale>
      )}
    </>
  );
}
