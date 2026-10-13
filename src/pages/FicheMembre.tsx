import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { eur } from '../lib/calcul';
import {
  chargerMembreParId, listerChantiers, listerInterventions, listerPaiementsEquipe,
  type ChantierAvecTiers,
} from '../lib/db';
import type { Intervention, Membre, PaiementEquipe, TypeDocument } from '../lib/types';
import FilAriane from '../components/FilAriane';
import PiecesJointes from '../components/PiecesJointes';

/** Ce qu'on range dans le dossier d'un salarié, dans l'ordre où on le cherche. */
const PIECES_SALARIE: TypeDocument[] = [
  'contrat', 'avenant', 'attestation_aptitude_fluides', 'permis', 'visite_medicale',
  'diplome', 'bulletin', 'rib', 'autre',
];

const TYPES: Record<Intervention['type'], string> = {
  visite_technique: 'Visite technique', pose: 'Pose', mise_en_service: 'Mise en service',
  sav: 'SAV', entretien: 'Entretien', controle_etancheite: 'Contrôle d’étanchéité',
};

/** Fiche d'un salarié : où il est, où il était, où il ira. */
export default function PageFicheMembre({ membreId }: { membreId: string }) {
  const [m, setM] = useState<Membre | null>(null);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [chantiers, setChantiers] = useState<ChantierAvecTiers[]>([]);
  const [paie, setPaie] = useState<PaiementEquipe[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try {
      const [membre, i, c, p] = await Promise.all([
        chargerMembreParId(membreId), listerInterventions(), listerChantiers(),
        listerPaiementsEquipe({ membreId }).catch(() => []),
      ]);
      setM(membre);
      setInterventions(i.filter((x) => x.membre_id === membreId));
      setChantiers(c);
      setPaie(p);
    } catch (e) { setErreur((e as Error).message); }
  }, [membreId]);

  useEffect(() => { void recharger(); }, [recharger]);
  if (!m) return erreur ? <div className="erreur">{erreur}</div> : null;

  const aujourdhui = new Date().toISOString().slice(0, 10);

  // Un chantier est « en cours » pour lui si une intervention y est prévue aujourd'hui
  // ou en cours, « passé » si toutes sont terminées, « à venir » sinon.
  const parChantier = new Map<string, Intervention[]>();
  for (const i of interventions) {
    if (!i.chantier_id) continue;
    if (!parChantier.has(i.chantier_id)) parChantier.set(i.chantier_id, []);
    parChantier.get(i.chantier_id)!.push(i);
  }

  const classer = (liste: Intervention[]): 'en_cours' | 'a_venir' | 'passe' => {
    if (liste.some((i) => i.statut === 'en_cours' ||
        (i.statut === 'planifiee' && i.date_prevue === aujourdhui))) return 'en_cours';
    if (liste.some((i) => i.statut === 'planifiee' && (i.date_prevue ?? '') > aujourdhui)) return 'a_venir';
    return 'passe';
  };

  const groupes: Record<string, { chantier: ChantierAvecTiers; liste: Intervention[] }[]> =
    { en_cours: [], a_venir: [], passe: [] };
  for (const [id, liste] of parChantier) {
    const chantier = chantiers.find((c) => c.id === id);
    if (!chantier) continue;
    groupes[classer(liste)].push({ chantier, liste });
  }

  const horsChantier = interventions.filter((i) => !i.chantier_id);
  const heures = interventions
    .filter((i) => i.debut_le && i.fin_le)
    .reduce((s, i) => s + (new Date(i.fin_le!).getTime() - new Date(i.debut_le!).getTime()) / 3600000, 0);

  const bloc = (titre: string, cle: string, couleur: string) => {
    const liste = groupes[cle];
    if (liste.length === 0) return null;
    return (
      <div key={cle}>
        <h2 style={{ margin: '20px 0 8px' }}>{titre}</h2>
        <table>
          <thead>
            <tr><th>Chantier</th><th>Client</th><th style={{ width: 180 }}>Ses interventions</th>
              <th style={{ width: 130 }}>Statut</th></tr>
          </thead>
          <tbody>
            {liste.map(({ chantier, liste: ivs }) => (
              <tr key={chantier.id} className="cliquable"
                  onClick={() => aller(`/chantiers/${chantier.id}`)}
                  style={{ borderLeft: `3px solid ${couleur}` }}>
                <td><strong>{chantier.numero}</strong><div className="ref">{chantier.libelle}</div></td>
                <td>{chantier.tiers?.nom ?? '—'}</td>
                <td className="ref">
                  {ivs.map((i) => (
                    <div key={i.id}>
                      {TYPES[i.type]}
                      {i.date_prevue ? ` · ${new Date(i.date_prevue).toLocaleDateString('fr-FR')}` : ''}
                    </div>
                  ))}
                </td>
                <td className="statut">{chantier.statut.replace(/_/g, ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <FilAriane etapes={[
        { libelle: 'Équipe', vers: '/equipe' },
        { libelle: 'Salariés', vers: '/equipe' },
        { libelle: m.nom },
      ]} />

      <div className="entete">
        <div>
          <h1>{m.nom}</h1>
          <div className="statut">
            {m.role.replace(/_/g, ' ')}
            {m.user_id ? ' · compte rattaché' : ' · sans compte'}
            {m.actif ? '' : ' · désactivé'}
          </div>
        </div>
        <button className="action discret" onClick={() => aller('/equipe')}>Retour</button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 12, marginBottom: 8 }}>
        <Chiffre libelle="Chantiers en cours" valeur={groupes.en_cours.length} />
        <Chiffre libelle="À venir" valeur={groupes.a_venir.length} />
        <Chiffre libelle="Terminés" valeur={groupes.passe.length} />
        <Chiffre libelle="Heures relevées" valeur={heures ? `${heures.toFixed(1)} h` : '—'} />
      </div>

      {m.aptitude_fluides_num && (
        <div className="panneau" style={{ display: 'block' }}>
          <strong>Attestation d’aptitude fluides</strong>
          <div className="ref">
            {m.aptitude_fluides_num}
            {m.aptitude_fluides_expire_le && (
              <span style={{
                color: m.aptitude_fluides_expire_le <= aujourdhui ? 'var(--alerte)' : 'var(--encre-pale)',
              }}>
                {' '}— valable jusqu’au{' '}
                {new Date(m.aptitude_fluides_expire_le).toLocaleDateString('fr-FR')}
              </span>
            )}
          </div>
        </div>
      )}

      {bloc('Chantiers en cours', 'en_cours', 'var(--bleu)')}
      {bloc('Chantiers à venir', 'a_venir', '#b8860b')}
      {bloc('Chantiers passés', 'passe', 'var(--filet)')}

      {horsChantier.length > 0 && (
        <>
          <h2 style={{ margin: '20px 0 8px' }}>Interventions hors chantier</h2>
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Statut</th></tr></thead>
            <tbody>
              {horsChantier.map((i) => (
                <tr key={i.id}>
                  <td className="num ref">
                    {i.date_prevue ? new Date(i.date_prevue).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td>{TYPES[i.type]}</td>
                  <td className="statut">{i.statut}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {parChantier.size === 0 && horsChantier.length === 0 && (
        <div className="vide">Aucune intervention affectée à cette personne.</div>
      )}

      <h2 style={{ margin: '22px 0 8px' }}>Sa paie</h2>
      {paie.length === 0 ? (
        <p className="statut">
          Rien d’enregistré. Les salaires, primes et acomptes se saisissent dans
          Équipe → Paie et règlements.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 100 }}>Période</th>
              <th style={{ width: 150 }}>Nature</th>
              <th>Libellé</th>
              <th className="num" style={{ width: 110 }}>Montant</th>
              <th style={{ width: 120 }}>Payé le</th>
            </tr>
          </thead>
          <tbody>
            {paie.map((x) => (
              <tr key={x.id} style={!x.paye_le ? { background: '#fdf7ee' } : undefined}>
                <td className="ref num">{x.periode ?? '—'}</td>
                <td className="statut">{x.type.replace(/_/g, ' ')}</td>
                <td>{x.libelle}</td>
                <td className="num">{eur(Number(x.montant))}</td>
                <td className="ref num">
                  {x.paye_le
                    ? new Date(x.paye_le).toLocaleDateString('fr-FR')
                    : <span className="jeton" data-r="retard">à payer</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <PiecesJointes cible={{ membre_id: membreId }} presentation="bibliotheque"
                     types={PIECES_SALARIE} titre="Son dossier" onErreur={setErreur}
        aide="Contrat, avenants, attestation d’aptitude fluides, permis, visite médicale.
              Ce qui porte une échéance remonte dans la cloche trente jours avant. Le seau
              est privé : chaque ouverture passe par un lien qui expire." />
    </>
  );
}

function Chiffre({ libelle, valeur }: { libelle: string; valeur: number | string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--filet)', padding: '12px 14px' }}>
      <div className="statut">{libelle}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 600, textAlign: 'left' }}>{valeur}</div>
    </div>
  );
}
