import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { membre as moi } from '../lib/session';
import {
  basculerTache, enregistrerIntervention, enregistrerPointage, etatDocument, heuresLisibles,
  LIBELLES_DOCUMENT, listerChantiers, listerDocuments, listerInterventions, listerPointages,
  listerSites, listerTaches, type ChantierAvecTiers,
} from '../lib/db';
import type { Document, Intervention, Site, Tache } from '../lib/types';
import FilAriane from '../components/FilAriane';

/**
 * Ma journée.
 *
 * L'écran d'arrivée d'un poseur. Il répond à trois questions, dans cet ordre :
 * où je vais, ce que j'y fais, et ai-je noté mes heures d'hier.
 *
 * Volontairement court. Le tableau de bord du gérant montre des demandes en
 * attente, des devis à relancer, des impayés — rien de tout ça n'aide
 * quelqu'un qui monte dans un fourgon à sept heures et demie.
 */

const TYPES: Record<Intervention['type'], string> = {
  visite_technique: 'Visite technique', pose: 'Pose', mise_en_service: 'Mise en service',
  sav: 'SAV', entretien: 'Entretien', controle_etancheite: 'Contrôle d’étanchéité',
};

const jour = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function PageMaJournee({ apercu = false }: { apercu?: boolean }) {
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [chantiers, setChantiers] = useState<ChantierAvecTiers[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [pieces, setPieces] = useState<Document[]>([]);
  const [heuresJour, setHeuresJour] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);

  const monId = moi().id;
  const aujourdhui = jour(new Date());
  const demain = jour(new Date(Date.now() + 86400000));

  const recharger = useCallback(async () => {
    try {
      const [i, c, s, t, d, p] = await Promise.all([
        listerInterventions(),
        listerChantiers().catch(() => []),
        listerSites().catch(() => []),
        listerTaches().catch(() => []),
        listerDocuments({ membre_id: monId }).catch(() => []),
        listerPointages({ membreId: monId, depuis: aujourdhui, jusqu: aujourdhui })
          .catch(() => []),
      ]);
      setInterventions(i.filter((x) => x.membre_id === monId));
      setChantiers(c); setSites(s);
      setTaches(t.filter((x) => x.assignee_id === monId));
      setPieces(d);
      setHeuresJour(p.reduce((sum, x) => sum + Number(x.heures), 0));
    } catch (e) { setErreur((e as Error).message); }
    setCharge(true);
  }, [monId, aujourdhui]);

  useEffect(() => { void recharger(); }, [recharger]);
  if (!charge) return <p className="statut">Chargement…</p>;

  const duJour = interventions
    .filter((i) => i.date_prevue === aujourdhui && i.statut !== 'annulee')
    .sort((a, b) => (a.debut_le ?? '').localeCompare(b.debut_le ?? ''));
  const deDemain = interventions
    .filter((i) => i.date_prevue === demain && i.statut !== 'annulee');
  const enRetard = interventions.filter((i) =>
    i.date_prevue && i.date_prevue < aujourdhui && ['planifiee', 'en_cours'].includes(i.statut));

  const tachesDuJour = taches.filter((t) => !t.echeance || t.echeance <= aujourdhui);
  const aRenouveler = pieces.filter((d) => ['perime', 'bientot'].includes(etatDocument(d, 60)));

  async function marquer(i: Intervention, statut: Intervention['statut']) {
    try {
      await enregistrerIntervention({
        id: i.id, statut,
        debut_le: statut === 'en_cours' ? new Date().toISOString() : i.debut_le,
        fin_le: statut === 'terminee' ? new Date().toISOString() : i.fin_le,
      });
      void recharger();
    } catch (e) { setErreur((e as Error).message); }
  }

  /** Le geste le plus fréquent de la journée : une journée normale, notée d'un clic. */
  async function pointerRapide(heures: number, chantierId: string | null) {
    try {
      await enregistrerPointage({
        jour: aujourdhui, heures, type: 'pose', chantier_id: chantierId,
      });
      void recharger();
    } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <>
      <FilAriane etapes={[
        { libelle: 'Aujourd’hui', vers: '/bord' },
        { libelle: apercu ? 'Vue technicien' : 'Ma journée' },
      ]} />

      <div className="entete">
        <div>
          <h1>Bonjour {moi().nom.split(' ')[0]}</h1>
          <div className="statut">
            {new Date().toLocaleDateString('fr-FR',
              { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>
        <button className="action discret" onClick={() => aller('/heures')}>
          Mes heures
        </button>
      </div>

      {apercu && (
        <div className="panneau" style={{ display: 'block', borderLeft: '3px solid var(--bleu)' }}>
          <strong>Aperçu.</strong>{' '}
          <span className="statut">
            Voici ce que voit un technicien en ouvrant Batinium, avec vos propres données.
            Ce sont vos interventions et vos tâches à vous qui s’affichent, pas les siennes.
          </span>
        </div>
      )}

      {erreur && <div className="erreur">{erreur}</div>}

      {enRetard.length > 0 && (
        <div className="erreur">
          {enRetard.length} intervention{enRetard.length > 1 ? 's' : ''} des jours précédents
          {enRetard.length > 1 ? ' sont restées' : ' est restée'} ouverte
          {enRetard.length > 1 ? 's' : ''}. Clôturez-les, sinon elles remonteront tous les matins.
        </div>
      )}

      <h2 style={{ marginBottom: 8 }}>Aujourd’hui</h2>
      {duJour.length === 0 ? (
        <div className="vide">
          Rien de planifié à votre nom aujourd’hui. Si vous êtes tout de même sur un
          chantier, notez vos heures : elles comptent quand même.
        </div>
      ) : (
        duJour.map((i) => {
          const c = chantiers.find((x) => x.id === i.chantier_id);
          const site = sites.find((x) => x.id === c?.site_id);
          const adresse = [site?.adresse, site?.code_postal, site?.ville]
            .filter(Boolean).join(' ');
          return (
            <div key={i.id} className="panneau" style={{ display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between',
                            gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 200 }}>
                  <strong style={{ fontSize: 16 }}>{TYPES[i.type]}</strong>
                  <div className="statut">
                    {c ? `${c.numero} — ${c.libelle}` : 'sans chantier'}
                    {c?.tiers?.nom && ` · ${c.tiers.nom}`}
                  </div>
                </div>
                <span className="jeton"
                      data-r={i.statut === 'terminee' ? 'recu'
                        : i.statut === 'en_cours' ? 'salarie' : undefined}>
                  {i.statut.replace(/_/g, ' ')}
                </span>
              </div>

              {adresse && (
                <div style={{ marginTop: 10 }}>
                  <div>{adresse}</div>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adresse)}`}
                     target="_blank" rel="noopener">Itinéraire</a>
                </div>
              )}

              {site?.contraintes_acces && (
                <div style={{ marginTop: 10, borderLeft: '3px solid #b8860b', paddingLeft: 10 }}>
                  <span className="statut">Accès</span>
                  <div>{site.contraintes_acces}</div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {i.statut === 'planifiee' && (
                  <button className="action" onClick={() => void marquer(i, 'en_cours')}>
                    Je commence
                  </button>
                )}
                {i.statut === 'en_cours' && (
                  <button className="action" onClick={() => void marquer(i, 'terminee')}>
                    J’ai terminé
                  </button>
                )}
                {c && (
                  <>
                    <button className="action discret" onClick={() => aller(`/pose/${c.id}`)}>
                      Fiche de pose
                    </button>
                    <button className="action discret" onClick={() => aller(`/chantiers/${c.id}`)}>
                      Journal et photos
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}

      <h2 style={{ margin: '22px 0 8px' }}>Mes heures du jour</h2>
      <div className="panneau" style={{ display: 'block' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="num" style={{ fontSize: 26, fontWeight: 600 }}>
            {heuresJour > 0 ? heuresLisibles(heuresJour) : '—'}
          </div>
          <span className="statut" style={{ flex: 1, minWidth: 200 }}>
            {heuresJour > 0
              ? 'Déjà noté pour aujourd’hui.'
              : 'Rien de noté. Un clic suffit, on corrige plus tard si besoin.'}
          </span>
          {[7, 7.5, 8].map((h) => (
            <button key={h} className="action discret"
                    onClick={() => void pointerRapide(h, duJour[0]?.chantier_id ?? null)}>
              + {heuresLisibles(h)}
            </button>
          ))}
          <button className="action discret" onClick={() => aller('/heures')}>Détail</button>
        </div>
        {duJour[0]?.chantier_id && (
          <p className="statut" style={{ marginTop: 8 }}>
            Ces boutons rattachent les heures au chantier de votre première intervention
            du jour. Pour un autre chantier, passez par « Détail ».
          </p>
        )}
      </div>

      {tachesDuJour.length > 0 && (
        <>
          <h2 style={{ margin: '22px 0 8px' }}>À faire</h2>
          <div className="panneau" style={{ display: 'block' }}>
            {tachesDuJour.map((t) => (
              <label key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'start',
                                         marginBottom: 8, color: 'var(--encre)' }}>
                <input type="checkbox" style={{ width: 'auto', marginTop: 3 }}
                       onChange={() => void basculerTache(t.id, true).then(recharger)} />
                <span>
                  {t.titre}
                  {t.detail && <div className="statut">{t.detail}</div>}
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      {deDemain.length > 0 && (
        <>
          <h2 style={{ margin: '22px 0 8px' }}>Demain</h2>
          <div className="panneau" style={{ display: 'block' }}>
            {deDemain.map((i) => {
              const c = chantiers.find((x) => x.id === i.chantier_id);
              return (
                <div key={i.id} style={{ marginBottom: 6 }}>
                  <strong>{TYPES[i.type]}</strong>
                  <span className="statut">
                    {' · '}{c ? `${c.numero} — ${c.libelle}` : 'sans chantier'}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {aRenouveler.length > 0 && (
        <>
          <h2 style={{ margin: '22px 0 8px' }}>Vos papiers</h2>
          <div className="panneau" style={{ display: 'block',
                                            borderLeft: '3px solid var(--alerte)' }}>
            {aRenouveler.map((d) => (
              <div key={d.id} style={{ marginBottom: 6 }}>
                <strong>{LIBELLES_DOCUMENT[d.type]?.libelle ?? d.nom}</strong>
                <span className="statut">
                  {' · '}
                  {etatDocument(d) === 'perime' ? 'périmé depuis le ' : 'expire le '}
                  {d.expire_le && new Date(d.expire_le).toLocaleDateString('fr-FR')}
                </span>
              </div>
            ))}
            <p className="statut" style={{ marginTop: 8 }}>
              Prévenez la direction : une attestation d’aptitude périmée vous interdit de
              manipuler du fluide, et l’infraction est pénale.
            </p>
          </div>
        </>
      )}
    </>
  );
}
