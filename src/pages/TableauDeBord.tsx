import { aller } from '../lib/router';
import { eur } from '../lib/calcul';
import { useChargement, voitLesPrix } from '../lib/session';
import {
  basculerTache, chargerTousLesDevis, listerChantiers, listerDemandes, listerTaches,
  listerDocumentsAEcheance,
} from '../lib/db';
import Squelette from '../components/Squelette';
import { trier, type Tri } from './Taches';
import type { Tache } from '../lib/types';
import { useState } from 'react';

/**
 * « Aujourd'hui » : ce qui attend une action, rien d'autre.
 * Un tableau de bord qui affiche des courbes ne sert à personne à 7 h du matin.
 */
export default function PageTableauDeBord() {
  const { valeur, erreur, recharger } = useChargement(async () => {
    const [demandes, groupes, chantiers, vigilance, taches] = await Promise.all([
      listerDemandes(),
      voitLesPrix() ? chargerTousLesDevis() : Promise.resolve([]),
      listerChantiers(),
      voitLesPrix() ? listerDocumentsAEcheance() : Promise.resolve([]),
      listerTaches(),
    ]);
    const devis = groupes.map((g) => g.devis);
    const totaux: Record<string, number> = {};
    for (const g of groupes) {
      totaux[g.devis.id] = g.lignes.reduce(
        (s, l) => s + Number(l.quantite) * Number(l.prix_unitaire_ht)
                    * (1 - Number(l.remise_pct) / 100), 0,
      ) - Number(g.devis.remise_montant ?? 0);
    }
    return { demandes, devis, chantiers, vigilance, totaux, taches };
  });

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!valeur) {
    return (
      <>
        <div className="entete"><h1>Aujourd’hui</h1></div>
        <Squelette chiffres={4} lignes={6} colonnes={5} />
      </>
    );
  }

  const { demandes, devis, chantiers, vigilance, totaux, taches } = valeur;
  const aujourdhui = new Date().toISOString().slice(0, 10);

  const sansReponse = demandes.filter((d) => !d.repondu && !['perdue', 'spam'].includes(d.statut));
  const aRappeler = demandes.filter((d) => d.rappeler_le && d.rappeler_le <= aujourdhui && !d.repondu);
  const aRelancer = devis.filter((d) => d.statut === 'envoye' &&
    (!d.relance_prochaine_le || d.relance_prochaine_le <= aujourdhui));
  const bloques = chantiers.filter((c) => c.statut === 'bloque' || c.statut === 'a_planifier');
  const perimes = vigilance.filter((v) => v.expire_le && v.expire_le <= aujourdhui);
  const enCoursTtc = devis
    .filter((d) => ['envoye', 'relance'].includes(d.statut))
    .reduce((s, d) => s + (totaux[d.id] ?? 0), 0);

  return (
    <>
      <div className="entete">
        <h1>Aujourd’hui</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
          <div className="statut">
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          {/* Cet écran-ci est celui du gérant. Le lien montre celui du poseur,
              qui n'a rien à voir : ni devis, ni impayés, ni relances. */}
          <button className="action discret" onClick={() => aller('/bord/journee')}>
            Vue technicien
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Compteur libelle="Sans réponse" valeur={sansReponse.length} alerte={sansReponse.length > 0}
                  onClick={() => aller('/demandes')} />
        <Compteur libelle="À rappeler" valeur={aRappeler.length} alerte={aRappeler.length > 0}
                  onClick={() => aller('/demandes')} />
        {voitLesPrix() && (
          <Compteur libelle="Devis à relancer" valeur={aRelancer.length} alerte={aRelancer.length > 0}
                    onClick={() => aller('/devis')} />
        )}
        <Compteur libelle="Chantiers à lancer" valeur={bloques.length} onClick={() => aller('/chantiers')} />
        {voitLesPrix() && <Compteur libelle="Devis en attente" valeur={eur(enCoursTtc)} />}
      </div>

      {perimes.length > 0 && (
        <div className="erreur">
          {perimes.length} document{perimes.length > 1 ? 's' : ''} périmé
          {perimes.length > 1 ? 's' : ''} chez vos sous-traitants. Un sous-traitant dont l’attestation
          URSSAF n’est plus valide vous expose à la solidarité financière.{' '}
          <a href="#/equipe">Voir</a>
        </div>
      )}

      <BlocTaches taches={taches} onChange={recharger} />

      <h2 style={{ margin: '18px 0 8px' }}>Ces gens attendent une réponse</h2>
      {sansReponse.length === 0 ? (
        <div className="vide">Personne n’attend. C’est rare, profitez-en.</div>
      ) : (
        <table>
          <thead>
            <tr><th>Reçue</th><th>Nom</th><th>Besoin</th><th>Urgence</th><th /></tr>
          </thead>
          <tbody>
            {sansReponse.slice(0, 12).map((d) => (
              <tr key={d.id} className="cliquable" onClick={() => aller('/demandes')}>
                <td className="num ref">{depuis(d.recu_le)}</td>
                <td>{d.nom ?? d.telephone ?? '—'}</td>
                <td>{d.besoin ?? d.resume ?? '—'}</td>
                <td><span className="taux" data-u={d.urgence}>{d.urgence}</span></td>
                <td className="statut">{d.statut}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {voitLesPrix() && aRelancer.length > 0 && (
        <>
          <h2 style={{ margin: '22px 0 8px' }}>Devis envoyés sans réponse</h2>
          <p className="statut" style={{ marginBottom: 8 }}>
            C’est là que se perd le plus d’argent : un devis envoyé et jamais relancé.
          </p>
          <table>
            <thead>
              <tr><th>Numéro</th><th>Client</th><th>Envoyé</th><th className="num">Montant HT</th></tr>
            </thead>
            <tbody>
              {aRelancer.map((d) => (
                <tr key={d.id} className="cliquable" onClick={() => aller(`/devis/${d.id}`)}>
                  <td>{d.numero}</td>
                  <td>{d.tiers?.nom ?? '—'}</td>
                  <td className="num ref">{d.envoye_le ? depuis(d.envoye_le) : '—'}</td>
                  <td className="num">{eur(totaux[d.id] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

/**
 * Un compteur, cliquable ou non.
 *
 * Il était rendu en `<button disabled>` quand il n'y avait rien à cliquer :
 * le navigateur grisait alors le chiffre, et « Devis en attente » avait l'air
 * en panne alors qu'il était juste. Un élément non interactif doit être un
 * élément non interactif, pas un bouton désactivé.
 */
function Compteur({ libelle, valeur, alerte, onClick }:
  { libelle: string; valeur: number | string; alerte?: boolean; onClick?: () => void }) {
  const style = {
    textAlign: 'left' as const, font: 'inherit', color: 'var(--encre)',
    background: 'var(--surface)', border: '1px solid var(--filet)',
    borderLeft: `3px solid ${alerte ? 'var(--alerte)' : 'var(--filet)'}`,
    padding: '12px 14px',
  };
  const contenu = (
    <>
      <div className="statut">{libelle}</div>
      <div className="num" style={{ fontSize: 26, fontWeight: 600, textAlign: 'left' }}>{valeur}</div>
    </>
  );
  return onClick
    ? <button onClick={onClick} style={{ ...style, cursor: 'pointer' }}>{contenu}</button>
    : <div style={style}>{contenu}</div>;
}

function depuis(iso: string): string {
  const jours = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (jours === 0) return "aujourd'hui";
  if (jours === 1) return 'hier';
  return `il y a ${jours} j`;
}


/** Les tâches du jour, avec le même choix de tri que la page dédiée. */
function BlocTaches({ taches, onChange }: { taches: Tache[]; onChange: () => void }) {
  const [tri, setTri] = useState<Tri>('rang');
  if (taches.length === 0) return null;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const visibles = trier(taches, tri).slice(0, 8);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    margin: '18px 0 8px', gap: 12 }}>
        <h2>Tâches</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={tri} onChange={(e) => setTri(e.target.value as Tri)} style={{ width: 180 }}>
            <option value="rang">Dans mon ordre</option>
            <option value="echeance">Par échéance</option>
            <option value="priorite">Par importance</option>
          </select>
          <a href="#/taches" className="statut">tout voir</a>
        </div>
      </div>
      <table>
        <tbody>
          {visibles.map((t) => {
            const retard = t.echeance && t.echeance < aujourdhui;
            return (
              <tr key={t.id} style={retard ? { background: '#fdf3f2' } : undefined}>
                <td style={{ width: 40, textAlign: 'center' }}>
                  <input type="checkbox" style={{ width: 'auto' }}
                         onChange={() => void basculerTache(t.id, true).then(onChange)} />
                </td>
                <td>{t.titre}</td>
                <td style={{ width: 130 }} className="statut">
                  {t.priorite !== 'normale' ? t.priorite : ''}
                </td>
                <td style={{ width: 120 }} className="num ref">
                  {t.echeance ? new Date(t.echeance).toLocaleDateString('fr-FR') : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
