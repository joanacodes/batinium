import { useCallback, useEffect, useState } from 'react';
import { listerInterventions, listerMembres } from '../lib/db';
import {
  debutDuJour, ecartLisible, heure, lienCarte, listerPresences, type PresenceLue,
} from '../lib/presence';
import type { Intervention, Membre } from '../lib/types';

/** L'arrivée d'une présence : heure, et où était la personne. */
function Arrivee({ p }: { p: PresenceLue }) {
  return (
    <>
      <span className="num">{heure(p.arrive_le)}</span>
      <div className="statut">
        {ecartLisible(p.arrivee_distance_m, p.arrivee_sans_position, p.arrivee_precision_m,
                      p.arrivee_latitude != null)}
        {p.arrivee_latitude != null && p.arrivee_longitude != null && (
          <> · <a href={lienCarte(p.arrivee_latitude, p.arrivee_longitude)}
                  target="_blank" rel="noopener">carte</a></>
        )}
      </div>
    </>
  );
}

function Depart({ p }: { p: PresenceLue }) {
  if (!p.parti_le) return <span className="jeton" data-r="salarie">sur place</span>;
  return (
    <>
      <span className="num">{heure(p.parti_le)}</span>
      <div className="statut">
        {p.depart_auto
          ? 'départ non noté : heure de l’arrivée suivante'
          : ecartLisible(p.depart_distance_m, p.depart_sans_position, p.depart_precision_m,
                         p.depart_latitude != null)}
      </div>
    </>
  );
}

/**
 * Sur le terrain aujourd'hui : qui est arrivé où, à quelle heure, et qui
 * n'a pas encore noté son arrivée sur une intervention du jour.
 *
 * Pour la direction et les chefs de chantier : un poseur ne lit que les
 * siennes, la base y veille (SQL 35).
 */
export function SurLeTerrain() {
  const [presences, setPresences] = useState<PresenceLue[] | null>(null);
  const [attendues, setAttendues] = useState<Intervention[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    Promise.all([
      listerPresences({ depuis: debutDuJour() }),
      listerInterventions(),
      listerMembres(),
    ]).then(([p, i, m]) => {
      setPresences(p);
      setMembres(m);
      setAttendues(i.filter((x) => x.date_prevue === aujourdhui && x.membre_id
        && ['planifiee', 'reportee'].includes(x.statut)
        && !p.some((y) => y.intervention_id === x.id)));
    }).catch((e) => setErreur((e as Error).message));
  }, []);

  if (erreur) return <p className="statut">{erreur}</p>;
  if (!presences) return null;
  if (presences.length === 0 && attendues.length === 0) {
    return <div className="vide">Personne n’a noté d’arrivée aujourd’hui, et rien n’est planifié.</div>;
  }

  return (
    <div className="tableau-defilant">
      <table>
        <thead>
          <tr><th>Qui</th><th>Chantier</th><th>Arrivée</th><th>Départ</th></tr>
        </thead>
        <tbody>
          {presences.map((p) => (
            <tr key={p.id}>
              <td>{p.membre?.nom ?? '—'}</td>
              <td>{p.chantier
                ? <a href={`#/chantiers/${p.chantier_id}`}>{p.chantier.numero}</a>
                : <span className="statut">sans chantier</span>}
                {p.chantier && <div className="statut">{p.chantier.libelle}</div>}
              </td>
              <td><Arrivee p={p} /></td>
              <td><Depart p={p} /></td>
            </tr>
          ))}
          {attendues.map((i) => (
            <tr key={i.id}>
              <td>{membres.find((m) => m.id === i.membre_id)?.nom ?? '—'}</td>
              <td>{i.chantier_id
                ? <a href={`#/chantiers/${i.chantier_id}`}>intervention du jour</a>
                : <span className="statut">intervention sans chantier</span>}</td>
              <td colSpan={2}><span className="jeton" data-r="retard">pas d’arrivée notée</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Les arrivées et départs d'un chantier, les plus récents d'abord. */
export function PresencesChantier({ chantierId }: { chantierId: string }) {
  const [presences, setPresences] = useState<PresenceLue[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(() => {
    listerPresences({ chantierId, limite: 60 })
      .then(setPresences).catch((e) => setErreur((e as Error).message));
  }, [chantierId]);
  useEffect(charger, [charger]);

  if (erreur) return <p className="statut">{erreur}</p>;
  if (!presences) return null;
  if (presences.length === 0) {
    return <p className="statut">Aucune arrivée notée sur ce chantier.</p>;
  }
  return (
    <div className="tableau-defilant">
      <table>
        <thead><tr><th>Jour</th><th>Qui</th><th>Arrivée</th><th>Départ</th></tr></thead>
        <tbody>
          {presences.map((p) => (
            <tr key={p.id}>
              <td className="num ref">{new Date(p.arrive_le).toLocaleDateString('fr-FR')}</td>
              <td>{p.membre?.nom ?? '—'}</td>
              <td><Arrivee p={p} /></td>
              <td><Depart p={p} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
