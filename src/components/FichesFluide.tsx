import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { listerMembres } from '../lib/db';
import type { Intervention, Membre } from '../lib/types';
import {
  creerFichesPourIntervention, interventionSurFluide, LIBELLES_STATUT_FICHE, listerFichesFluide,
  NATURES, type FicheResumee,
} from '../lib/fichesFluide';

/**
 * Les fiches fluides d'un chantier.
 *
 * Toute intervention qui touche au fluide en exige une par machine. Cette
 * section les liste, et pour chaque intervention concernée propose de les
 * créer d'un coup — préremplies à l'identique sauf la machine.
 */
export function FichesFluideChantier({ chantierId, interventions, onErreur }: {
  chantierId: string;
  interventions: Pick<Intervention, 'id' | 'type' | 'chantier_id' | 'membre_id' | 'date_prevue'
    | 'charge_kg' | 'recuperee_kg' | 'statut'>[];
  onErreur: (message: string) => void;
}) {
  const [fiches, setFiches] = useState<FicheResumee[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [travail, setTravail] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try {
      const [f, m] = await Promise.all([
        listerFichesFluide({ chantierId }), listerMembres().catch(() => []),
      ]);
      setFiches(f); setMembres(m);
    } catch (e) { onErreur((e as Error).message); }
  }, [chantierId, onErreur]);

  useEffect(() => { void recharger(); }, [recharger]);

  async function creer(i: FichesFluideChantierProps['interventions'][number]) {
    setTravail(i.id);
    try {
      const { creees, existantes } = await creerFichesPourIntervention(i);
      await recharger();
      // Une seule fiche : on l'ouvre. Plusieurs : on reste sur la liste, où
      // elles apparaissent l'une sous l'autre.
      const toutes = [...creees, ...existantes];
      if (toutes.length === 1) aller(`/fluide/${toutes[0]}`);
    } catch (e) { onErreur((e as Error).message); }
    setTravail(null);
  }

  const concernees = interventions.filter((i) => interventionSurFluide(i) && i.statut !== 'annulee');
  const nomDe = (id: string | null) => membres.find((m) => m.id === id)?.nom ?? '—';

  return (
    <>
      {concernees.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          {concernees.map((i) => {
            const n = fiches.filter((f) => f.intervention_id === i.id && f.statut !== 'rectifiee').length;
            return (
              <div key={i.id} className="panneau" style={{ display: 'flex', gap: 10, margin: 0,
                                                            alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 200 }}>
                  <strong>{LIBELLE_TYPE[i.type] ?? i.type}</strong>
                  <span className="statut">
                    {' '}— {i.date_prevue ? new Date(i.date_prevue).toLocaleDateString('fr-FR') : 'non datée'}
                    {' '}· {n} fiche{n > 1 ? 's' : ''}
                  </span>
                </span>
                <button className="action discret" disabled={travail === i.id}
                        onClick={() => void creer(i)}>
                  {travail === i.id ? '…' : n > 0 ? 'Compléter les fiches' : 'Fiches fluides'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {fiches.length === 0 ? (
        <p className="statut">
          Aucune fiche. Une intervention qui charge, récupère ou contrôle le fluide en exige
          une par machine : c’est une obligation, pas une formalité.
        </p>
      ) : (
        <div className="tableau-defilant">
          <table>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Numéro</th>
                <th style={{ width: 95 }}>Date</th>
                <th>Machine</th>
                <th>Nature</th>
                <th style={{ width: 150 }}>État</th>
                <th style={{ width: 130 }}>Technicien</th>
              </tr>
            </thead>
            <tbody>
              {fiches.map((f) => (
                <tr key={f.id} className="cliquable" onClick={() => aller(`/fluide/${f.id}`)}>
                  <td className="ref">{f.numero ?? <span className="statut">brouillon</span>}</td>
                  <td className="num ref">{new Date(f.date_intervention).toLocaleDateString('fr-FR')}</td>
                  <td>
                    {[f.equipement?.marque, f.equipement?.modele].filter(Boolean).join(' ') || '—'}
                    {f.equipement?.numero_serie && <div className="ref">{f.equipement.numero_serie}</div>}
                  </td>
                  <td className="statut">
                    {f.nature.map((n) => NATURES.find((x) => x.cle === n)?.libelle ?? n).join(', ') || '—'}
                  </td>
                  <td>
                    <span className="jeton" data-r={f.statut === 'signee' ? 'recu'
                      : f.statut === 'rectifiee' ? undefined : 'retard'}>
                      {LIBELLES_STATUT_FICHE[f.statut]}
                    </span>
                  </td>
                  <td>{nomDe(f.technicien_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type FichesFluideChantierProps = Parameters<typeof FichesFluideChantier>[0];

const LIBELLE_TYPE: Partial<Record<Intervention['type'], string>> = {
  mise_en_service: 'Mise en service',
  entretien: 'Entretien',
  sav: 'SAV',
  controle_etancheite: 'Contrôle d’étanchéité',
};

/**
 * Les boutons de « Ma journée ».
 *
 * C'est depuis le téléphone, sur place, que la fiche se remplit : la plaque
 * est sous les yeux, le client est là pour signer. Un seul composant pour
 * tous les gestes de terrain d'une intervention, pour que « Ma journée »
 * n'ait à l'intégrer qu'une fois : les phases suivantes y ajoutent leurs
 * boutons sans retoucher la page.
 */
export function BoutonsIntervention({ intervention, onErreur }: {
  intervention: Pick<Intervention, 'id' | 'type' | 'chantier_id' | 'membre_id' | 'date_prevue'
    | 'charge_kg' | 'recuperee_kg'>;
  onErreur: (message: string) => void;
}) {
  const [travail, setTravail] = useState(false);
  if (!interventionSurFluide(intervention) || !intervention.chantier_id) return null;

  async function ouvrir() {
    setTravail(true);
    try {
      const { creees, existantes } = await creerFichesPourIntervention(intervention);
      const toutes = [...existantes, ...creees];
      // Une machine : sa fiche. Plusieurs : le chantier, où elles sont listées.
      aller(toutes.length === 1 ? `/fluide/${toutes[0]}` : `/chantiers/${intervention.chantier_id}`);
    } catch (e) { onErreur((e as Error).message); }
    setTravail(false);
  }

  return (
    <button className="action discret" disabled={travail} onClick={() => void ouvrir()}>
      {travail ? '…' : 'Fiches fluides'}
    </button>
  );
}
