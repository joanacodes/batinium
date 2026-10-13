import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { eur } from '../lib/calcul';
import { estDirection } from '../lib/session';
import {
  chargerTiers, etatDocument, listerChantiers, listerDocuments, listerInterventions,
  listerPaie, type ChantierAvecTiers, type PaiementDetaille,
} from '../lib/db';
import type { Document, Intervention, Tiers, TypeDocument } from '../lib/types';
import FilAriane from '../components/FilAriane';
import PiecesJointes from '../components/PiecesJointes';

/** Les pièces qu'un donneur d'ordre doit pouvoir produire, dans cet ordre. */
const PIECES_SOUS_TRAITANT: TypeDocument[] = [
  'attestation_urssaf', 'kbis', 'decennale', 'rc_pro',
  'attestation_capacite_fluides', 'liste_salaries_etrangers', 'rib',
  'contrat', 'facture', 'autre',
];

/**
 * La fiche d'un sous-traitant.
 *
 * Elle n'existait pas : on gérait ses attestations dans une fenêtre au milieu
 * de la liste, et rien ne disait ce qu'il avait fait ni ce qu'on lui devait.
 * Or c'est exactement ce qu'on cherche quand on ouvre une fiche — et, en cas
 * de contrôle, ce qu'on doit pouvoir sortir en une fois.
 */
export default function PageFicheSousTraitant({ tiersId }: { tiersId: string }) {
  const [t, setT] = useState<Tiers | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [chantiers, setChantiers] = useState<ChantierAvecTiers[]>([]);
  const [paie, setPaie] = useState<PaiementDetaille[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try {
      const [tiers, d, i, c, p] = await Promise.all([
        chargerTiers(tiersId),
        listerDocuments({ tiers_id: tiersId }).catch(() => []),
        listerInterventions().catch(() => []),
        listerChantiers().catch(() => []),
        estDirection() ? listerPaie().catch(() => []) : Promise.resolve([]),
      ]);
      setT(tiers);
      setDocs(d);
      setInterventions(i.filter((x) => x.sous_traitant_id === tiersId));
      setChantiers(c);
      setPaie(p.filter((x) => x.tiers_id === tiersId));
    } catch (e) { setErreur((e as Error).message); }
  }, [tiersId]);

  useEffect(() => { void recharger(); }, [recharger]);
  if (!t) return erreur ? <div className="erreur">{erreur}</div> : null;

  const perimes = docs.filter((d) => etatDocument(d) === 'perime');
  const bientot = docs.filter((d) => etatDocument(d) === 'bientot');
  const du = paie.filter((p) => !p.paye_le).reduce((s, p) => s + Number(p.montant), 0);
  const paye = paie.filter((p) => p.paye_le).reduce((s, p) => s + Number(p.montant), 0);

  return (
    <>
      <FilAriane etapes={[
        { libelle: 'Équipe', vers: '/equipe' },
        { libelle: 'Sous-traitants', vers: '/equipe' },
        { libelle: t.nom },
      ]} />

      <div className="entete">
        <div>
          <h1>{t.nom}</h1>
          <div className="statut">
            Sous-traitant
            {t.siret && ` · SIRET ${t.siret}`}
            {t.ville && ` · ${t.ville}`}
          </div>
        </div>
        <button className="action discret" onClick={() => aller('/equipe')}>Retour</button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {perimes.length > 0 && (
        <div className="erreur">
          {perimes.length} pièce{perimes.length > 1 ? 's' : ''} périmée{perimes.length > 1 ? 's' : ''}.
          Un sous-traitant qui n’est pas à jour vous expose à la solidarité financière sur
          ses cotisations et les salaires qu’il n’aurait pas payés. Ne le laissez pas
          intervenir tant que ce n’est pas régularisé.
        </div>
      )}

      <div style={{ display: 'grid', gap: 12, marginBottom: 16,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Chiffre libelle="Pièces au dossier" valeur={docs.length} />
        <Chiffre libelle="À renouveler sous 30 jours" valeur={bientot.length}
                 alerte={bientot.length > 0} />
        <Chiffre libelle="Interventions" valeur={interventions.length} />
        {estDirection() && <Chiffre libelle="Reste à lui payer" valeur={eur(du)} alerte={du > 0} />}
      </div>

      <div className="panneau" style={{ display: 'block' }}>
        <div style={{ display: 'grid', gap: 12,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div><span className="statut">Téléphone</span><div>{t.telephone ?? '—'}</div></div>
          <div><span className="statut">E-mail</span><div>{t.email ?? '—'}</div></div>
          <div><span className="statut">Adresse</span>
            <div>{[t.adresse, t.code_postal, t.ville].filter(Boolean).join(', ') || '—'}</div></div>
        </div>
        {t.notes && <p className="fiche" style={{ marginTop: 10 }}>{t.notes}</p>}
      </div>

      <PiecesJointes cible={{ tiers_id: tiersId }} presentation="bibliotheque"
                     types={PIECES_SOUS_TRAITANT} titre="Dossier"
                     onErreur={setErreur} onChange={recharger}
        aide="L’attestation de vigilance URSSAF se renouvelle tous les six mois au-delà de
              5 000 € HT de contrat ; sa date de fin se calcule seule à partir de la date
              d’émission. Déposez la pièce à côté de sa date : le jour d’un contrôle,
              c’est le papier qu’on vous demandera, pas l’échéance." />

      <h2 style={{ margin: '22px 0 8px' }}>Ce qu’il a fait</h2>
      {interventions.length === 0 ? (
        <p className="statut">
          Aucune intervention enregistrée à son nom. Elles s’affectent depuis un chantier.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Date</th>
              <th style={{ width: 170 }}>Type</th>
              <th>Chantier</th>
              <th style={{ width: 120 }}>Statut</th>
            </tr>
          </thead>
          <tbody>
            {interventions.map((i) => {
              const c = chantiers.find((x) => x.id === i.chantier_id);
              return (
                <tr key={i.id}>
                  <td className="num ref">
                    {i.date_prevue ? new Date(i.date_prevue).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="statut">{i.type.replace(/_/g, ' ')}</td>
                  <td>
                    {c ? <a href={`#/chantiers/${c.id}`}>{c.numero} — {c.libelle}</a>
                       : <span className="statut">hors chantier</span>}
                  </td>
                  <td className="statut">{i.statut}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {estDirection() && (
        <>
          <h2 style={{ margin: '22px 0 8px' }}>Ce qu’on lui a payé</h2>
          {paie.length === 0 ? (
            <p className="statut">
              Aucun règlement enregistré. Ils se saisissent dans Équipe → Paie et règlements,
              seul endroit où la sous-traitance se note depuis qu’elle a quitté les dépenses.
            </p>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Libellé</th>
                    <th style={{ width: 170 }}>Chantier</th>
                    <th style={{ width: 110 }}>Dû le</th>
                    <th className="num" style={{ width: 110 }}>Montant</th>
                    <th style={{ width: 110 }}>Payé le</th>
                  </tr>
                </thead>
                <tbody>
                  {paie.map((p) => (
                    <tr key={p.id} style={!p.paye_le ? { background: '#fdf7ee' } : undefined}>
                      <td>{p.libelle}</td>
                      <td className="ref">
                        {p.chantier
                          ? <a href={`#/chantiers/${p.chantier.id}`}>{p.chantier.numero}</a>
                          : <span className="statut">hors chantier</span>}
                      </td>
                      <td className="num ref">
                        {p.du_le ? new Date(p.du_le).toLocaleDateString('fr-FR') : '—'}
                      </td>
                      <td className="num">{eur(Number(p.montant))}</td>
                      <td className="num ref">
                        {p.paye_le
                          ? new Date(p.paye_le).toLocaleDateString('fr-FR')
                          : <span className="jeton" data-r="retard">à payer</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="statut" style={{ marginTop: 8 }}>
                {eur(paye)} réglés, {eur(du)} en attente.
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}

function Chiffre({ libelle, valeur, alerte }:
  { libelle: string; valeur: number | string; alerte?: boolean }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--filet)',
      borderLeft: `3px solid ${alerte ? 'var(--alerte)' : 'var(--filet)'}`, padding: '12px 14px',
    }}>
      <div className="statut">{libelle}</div>
      <div className="num" style={{ fontSize: 23, fontWeight: 600, textAlign: 'left' }}>{valeur}</div>
    </div>
  );
}
