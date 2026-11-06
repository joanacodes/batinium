import { aller } from '../lib/router';
import { eur } from '../lib/calcul';
import { basculerVue, membre, roleReel, useChargement, voitLesPrix } from '../lib/session';
import {
  basculerTache, chargerTousLesDevis, listerChantiers, listerDemandes, listerTaches,
  listerDocumentsAEcheance,
} from '../lib/db';
import Squelette from '../components/Squelette';
import { SurLeTerrain } from '../components/Presences';
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
    return { demandes, devis, chantiers, vigilance, totaux, taches, lu: new Date() };
  });

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!valeur) {
    return (
      <>
        <Bandeau />
        <Squelette chiffres={0} lignes={6} colonnes={5} />
      </>
    );
  }

  const { demandes, devis, chantiers, vigilance, totaux, taches, lu } = valeur;
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

  // Une seule tuile prend l'accent : la première qui attend, dans l'ordre où
  // l'argent se perd — quelqu'un sans réponse, un rappel promis, un devis
  // jamais relancé. Les autres qui attendent portent un point, pas l'accent :
  // trois tuiles allumées, c'est n'en allumer aucune.
  const attentes = [
    { cle: 'sansReponse', n: sansReponse.length },
    { cle: 'aRappeler', n: aRappeler.length },
    { cle: 'aRelancer', n: voitLesPrix() ? aRelancer.length : 0 },
  ];
  const forte = attentes.find((a) => a.n > 0)?.cle ?? null;
  const etat = (cle: string, n: number) => ({ fort: forte === cle, point: forte !== cle && n > 0 });

  return (
    <>
      <Bandeau lu={lu}>
        <div className="tuiles">
          <Tuile libelle="Sans réponse" valeur={sansReponse.length} {...etat('sansReponse', sansReponse.length)}
                 onClick={() => aller('/demandes')} />
          <Tuile libelle="À rappeler" valeur={aRappeler.length} {...etat('aRappeler', aRappeler.length)}
                 onClick={() => aller('/demandes')} />
          {voitLesPrix() && (
            <Tuile libelle="Devis à relancer" valeur={aRelancer.length} {...etat('aRelancer', aRelancer.length)}
                   onClick={() => aller('/devis')} />
          )}
          <Tuile libelle="Chantiers à lancer" valeur={bloques.length} onClick={() => aller('/chantiers')} />
          {voitLesPrix() && <Tuile libelle="Devis en attente" valeur={eur(enCoursTtc)} petit />}
        </div>
      </Bandeau>

      {perimes.length > 0 && (
        <div className="erreur">
          {perimes.length} document{perimes.length > 1 ? 's' : ''} périmé
          {perimes.length > 1 ? 's' : ''} chez vos sous-traitants. Un sous-traitant dont l’attestation
          URSSAF n’est plus valide vous expose à la solidarité financière.{' '}
          <a href="#/equipe">Voir</a>
        </div>
      )}

      {/* Qui est arrivé où, et qui n'a pas encore noté son arrivée. Seulement
          pour ceux qui voient l'équipe : un poseur ne lit que les siennes. */}
      {voitLesPrix() && (
        <>
          <h2 style={{ margin: '4px 0 8px' }}>Sur le terrain aujourd’hui</h2>
          <SurLeTerrain />
        </>
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
                <td>{d.nom || d.tiers?.nom || d.telephone || d.tiers?.telephone || '—'}</td>
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
 * Le haut de l'écran : la date, le bonjour, et les chiffres du jour en tuiles.
 *
 * Le bouton « Voir comme un technicien » reste ici : cet écran-ci est celui du
 * gérant, et le bouton montre celui du poseur, qui n'a rien à voir — ni devis,
 * ni impayés, ni relances — avec ses droits à lui, en base, grâce au mode
 * démonstration (SQL 38).
 */
function Bandeau({ lu, children }: { lu?: Date; children?: React.ReactNode }) {
  const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const heure = lu ? ` · à jour à ${lu.getHours()} h ${String(lu.getMinutes()).padStart(2, '0')}` : '';
  return (
    <section className="bandeau" aria-label="Aujourd’hui">
      <div className="bandeau-tete">
        <div>
          <p className="bandeau-date">{date.charAt(0).toUpperCase() + date.slice(1)}{heure}</p>
          <h1>Bonjour {membre().nom.split(' ')[0]}</h1>
        </div>
        {roleReel() === 'direction' && (
          <div className="bandeau-actions">
            <button className="action discret"
                    onClick={() => basculerVue('technicien').catch((e) => window.alert((e as Error).message))}>
              Voir comme un technicien
            </button>
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Une tuile du bandeau, cliquable ou non.
 *
 * Un compteur sans destination était rendu en `<button disabled>` : le
 * navigateur grisait alors le chiffre, et « Devis en attente » avait l'air en
 * panne alors qu'il était juste. Un élément non interactif doit être un
 * élément non interactif, pas un bouton désactivé.
 */
function Tuile({ libelle, valeur, fort, point, petit, onClick }: {
  libelle: string; valeur: number | string; fort?: boolean; point?: boolean; petit?: boolean;
  onClick?: () => void;
}) {
  const contenu = (
    <>
      <span className={petit ? 'tuile-chiffre petit' : 'tuile-chiffre'}>{valeur}</span>
      <span className="tuile-libelle">{libelle}</span>
    </>
  );
  const attributs = { 'data-fort': fort ? 'oui' : undefined, 'data-point': point ? 'oui' : undefined };
  return onClick
    ? <button className="tuile" onClick={onClick} {...attributs}>{contenu}</button>
    : <div className="tuile" {...attributs}>{contenu}</div>;
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
              <tr key={t.id} style={retard ? { background: 'var(--alerte-pale)' } : undefined}>
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
