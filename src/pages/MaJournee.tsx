import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { membre as moi } from '../lib/session';
import {
  basculerTache, enregistrerIntervention, enregistrerPointage, etatDocument, heuresLisibles,
  LIBELLES_DOCUMENT, listerChantiers, listerDocuments, listerInterventions, listerPointages,
  listerSites, listerTaches, type ChantierAvecTiers,
} from '../lib/db';
import {
  debutDuJour, ecartLisible, heure, listerPresences, localiserSite, noterArrivee, noterDepart,
  relevePosition, sql35Absent, type PresenceLue,
} from '../lib/presence';
import type { Document, Intervention, Site, Tache } from '../lib/types';
import FilAriane from '../components/FilAriane';
import { BoutonsIntervention } from '../components/FichesFluide';
import Itineraire from '../components/Itineraire';
import EnvoiMedias from '../components/EnvoiMedias';
import DemandeTerrain from '../components/DemandeTerrain';

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
  const [presences, setPresences] = useState<PresenceLue[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  // Le geste en cours, pour griser son bouton : relever la position prend
  // quelques secondes, et un deuxième appui pendant ce temps ne doit rien faire.
  const [enCours, setEnCours] = useState<string | null>(null);
  const [medias, setMedias] = useState<ChantierAvecTiers | null>(null);
  const [demande, setDemande] = useState<{ c: ChantierAvecTiers; i: Intervention } | null>(null);
  const [chantierLibre, setChantierLibre] = useState('');

  const monId = moi().id;
  const aujourdhui = jour(new Date());
  const demain = jour(new Date(Date.now() + 86400000));

  const recharger = useCallback(async () => {
    try {
      const [i, c, s, t, d, p, pr] = await Promise.all([
        listerInterventions(),
        listerChantiers().catch(() => []),
        listerSites().catch(() => []),
        listerTaches().catch(() => []),
        listerDocuments({ membre_id: monId }).catch(() => []),
        listerPointages({ membreId: monId, depuis: aujourdhui, jusqu: aujourdhui })
          .catch(() => []),
        // Sans le SQL 35, pas d'arrivées : l'écran retombe sur « Je commence ».
        listerPresences({ membreId: monId, depuis: debutDuJour() }).catch(() => [] as PresenceLue[]),
      ]);
      setInterventions(i.filter((x) => x.membre_id === monId));
      setChantiers(c); setSites(s);
      setTaches(t.filter((x) => x.assignee_id === monId));
      setPieces(d);
      setHeuresJour(p.reduce((sum, x) => sum + Number(x.heures), 0));
      setPresences(pr);
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
  // Le temps passé d'après les arrivées et départs, au quart d'heure : la
  // même information ne se tape pas deux fois (règle 3).
  const tempsNote = Math.round(presences
    .filter((p) => p.parti_le)
    .reduce((s, p) => s + (new Date(p.parti_le!).getTime() - new Date(p.arrive_le).getTime()), 0)
    / 900000) / 4;
  const ouverteSansIntervention = presences.find((p) => !p.parti_le && !p.intervention_id);
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

  /**
   * « Je suis arrivé ». L'heure vient du serveur ; la position est relevée une
   * fois, maintenant. Avant, on cherche les coordonnées du site s'il n'en a
   * pas encore, pour que la base puisse dire si l'arrivée a été notée sur place.
   */
  async function arriver(cle: string, cible: { interventionId?: string; chantierId?: string }, site?: Site) {
    setEnCours(cle); setErreur(null); setInfo(null);
    try {
      const [releve] = await Promise.all([relevePosition(), localiserSite(site).catch(() => undefined)]);
      const p = await noterArrivee(cible, releve);
      setInfo(`Arrivée notée à ${heure(p.arrive_le)} — `
        + ecartLisible(p.arrivee_distance_m, p.arrivee_sans_position, p.arrivee_precision_m,
                       p.arrivee_latitude != null) + '.');
      await recharger();
    } catch (e) {
      const m = (e as Error).message;
      // Sans le SQL 35, l'intervention démarre quand même, comme avant.
      const i = interventions.find((x) => x.id === cible.interventionId);
      if (sql35Absent(m) && i) {
        await marquer(i, 'en_cours');
        setInfo('Intervention démarrée. L’heure d’arrivée et la position demandent le SQL 35.');
      } else {
        setErreur(m);
      }
    }
    setEnCours(null);
  }

  async function partir(cle: string, p: PresenceLue, terminer: boolean) {
    setEnCours(cle); setErreur(null); setInfo(null);
    try {
      const fini = await noterDepart(p.id, await relevePosition(), terminer);
      setInfo(`Départ noté à ${heure(fini.parti_le!)}.`);
      await recharger();
    } catch (e) { setErreur((e as Error).message); }
    setEnCours(null);
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

      {info && (
        <div className="panneau" style={{ display: 'block', borderLeft: '3px solid var(--vert)' }}>
          {info}
        </div>
      )}

      <h2 style={{ marginBottom: 4 }}>Aujourd’hui</h2>
      <p className="statut" style={{ marginBottom: 10 }}>
        « Je suis arrivé » et « Je pars » relèvent votre position une seule fois, au moment
        où vous appuyez — jamais en continu. Elle sert à dire que l’arrivée a été notée sur
        place.
      </p>
      {duJour.length === 0 ? (
        <div className="vide">
          Rien de planifié à votre nom aujourd’hui. Si vous êtes tout de même sur un
          chantier, notez votre arrivée et vos heures : elles comptent quand même.
        </div>
      ) : (
        duJour.map((i) => {
          const c = chantiers.find((x) => x.id === i.chantier_id);
          const site = sites.find((x) => x.id === c?.site_id);
          const adresse = [site?.adresse, site?.code_postal, site?.ville]
            .filter(Boolean).join(' ');
          const ouverte = presences.find((x) => x.intervention_id === i.id && !x.parti_le);
          const passees = presences.filter((x) => x.intervention_id === i.id && x.parti_le);
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
                  <Itineraire adresse={adresse} latitude={site?.latitude} longitude={site?.longitude} />
                </div>
              )}

              {site?.contraintes_acces && (
                <div style={{ marginTop: 10, borderLeft: '3px solid #b8860b', paddingLeft: 10 }}>
                  <span className="statut">Accès</span>
                  <div>{site.contraintes_acces}</div>
                </div>
              )}

              {(ouverte || passees.length > 0) && (
                <div style={{ marginTop: 10 }}>
                  {passees.map((x) => (
                    <div key={x.id} className="statut">
                      Arrivé à {heure(x.arrive_le)}, parti à {heure(x.parti_le!)}
                      {x.depart_auto ? ' (départ non noté)' : ''}
                    </div>
                  ))}
                  {ouverte && (
                    <div>
                      <strong>Arrivé à {heure(ouverte.arrive_le)}</strong>
                      <span className="statut">
                        {' — '}{ecartLisible(ouverte.arrivee_distance_m, ouverte.arrivee_sans_position,
                                             ouverte.arrivee_precision_m, ouverte.arrivee_latitude != null)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {!ouverte && ['planifiee', 'en_cours', 'reportee'].includes(i.statut) && (
                  <button className="action" disabled={enCours !== null}
                          onClick={() => void arriver(`a:${i.id}`, { interventionId: i.id }, site)}>
                    {enCours === `a:${i.id}` ? 'Position…' : 'Je suis arrivé'}
                  </button>
                )}
                {ouverte && (
                  <>
                    <button className="action" disabled={enCours !== null}
                            onClick={() => void partir(`t:${i.id}`, ouverte, true)}>
                      {enCours === `t:${i.id}` ? 'Position…' : 'J’ai terminé, je pars'}
                    </button>
                    <button className="action discret" disabled={enCours !== null}
                            onClick={() => void partir(`d:${i.id}`, ouverte, false)}>
                      {enCours === `d:${i.id}` ? 'Position…' : 'Je pars, je reviens'}
                    </button>
                  </>
                )}
                {!ouverte && i.statut === 'en_cours' && (
                  <button className="action discret" onClick={() => void marquer(i, 'terminee')}>
                    J’ai terminé
                  </button>
                )}
              </div>

              {c && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button className="action discret" onClick={() => setMedias(c)}>
                    Photos, vidéos
                  </button>
                  <button className="action discret" onClick={() => setDemande({ c, i })}>
                    Le client demande autre chose
                  </button>
                  <button className="action discret" onClick={() => aller(`/pose/${c.id}`)}>
                    Fiche de pose
                  </button>
                  <button className="action discret" onClick={() => aller(`/chantiers/${c.id}`)}>
                    Journal du chantier
                  </button>
                  <BoutonsIntervention intervention={i} onErreur={setErreur} />
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Une arrivée hors intervention : un sous-traitant appelé en renfort, un
          chantier sans planning. L'heure compte quand même. */}
      {ouverteSansIntervention ? (
        <div className="panneau" style={{ display: 'block' }}>
          <strong>Arrivé à {heure(ouverteSansIntervention.arrive_le)}</strong>
          <span className="statut">
            {ouverteSansIntervention.chantier ? ` sur ${ouverteSansIntervention.chantier.numero}` : ''}
            {' — '}{ecartLisible(ouverteSansIntervention.arrivee_distance_m,
                                 ouverteSansIntervention.arrivee_sans_position,
                                 ouverteSansIntervention.arrivee_precision_m,
                                 ouverteSansIntervention.arrivee_latitude != null)}
          </span>
          <div style={{ marginTop: 10 }}>
            <button className="action" disabled={enCours !== null}
                    onClick={() => void partir('libre', ouverteSansIntervention, false)}>
              {enCours === 'libre' ? 'Position…' : 'Je pars'}
            </button>
          </div>
        </div>
      ) : (
        <details className="panneau" style={{ display: 'block' }}>
          <summary style={{ cursor: 'pointer' }}>Arrivé sur un chantier qui n’est pas dans la liste</summary>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <select value={chantierLibre} style={{ flex: 1, minWidth: 200 }}
                    onChange={(e) => setChantierLibre(e.target.value)}>
              <option value="">Choisir le chantier…</option>
              {chantiers.filter((c) => c.statut !== 'receptionne').map((c) => (
                <option key={c.id} value={c.id}>{c.numero} — {c.libelle}</option>
              ))}
            </select>
            <button className="action" disabled={!chantierLibre || enCours !== null}
                    onClick={() => void arriver('libre', { chantierId: chantierLibre },
                      sites.find((x) => x.id === chantiers.find((c) => c.id === chantierLibre)?.site_id))}>
              {enCours === 'libre' ? 'Position…' : 'Je suis arrivé'}
            </button>
          </div>
        </details>
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
          {heuresJour === 0 && tempsNote > 0 && (
            <button className="action"
                    onClick={() => void pointerRapide(tempsNote,
                      presences.find((x) => x.chantier_id)?.chantier_id ?? null)}>
              + {heuresLisibles(tempsNote)} d’après vos arrivées
            </button>
          )}
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

      {medias && (
        <EnvoiMedias chantierId={medias.id} tiersId={medias.tiers_id}
                     titre={`Photos et vidéos — ${medias.numero}`}
                     onFermer={() => setMedias(null)}
                     onEnvoye={() => { setMedias(null); setInfo('Envoyé au journal du chantier.'); }} />
      )}
      {demande && (
        <DemandeTerrain chantier={demande.c} interventionId={demande.i.id}
                        site={sites.find((x) => x.id === demande.c.site_id)}
                        onFermer={() => setDemande(null)}
                        onCree={() => { setDemande(null); setInfo('Demande transmise au bureau.'); }} />
      )}
    </>
  );
}
