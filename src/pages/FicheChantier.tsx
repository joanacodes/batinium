import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import {
  ajouterFil, chargerChantier, clePrealable, enregistrerIntervention,
  enregistrerApprovisionnement, lienDocument, listerApprovisionnement, listerDocuments,
  listerPrealables, poids, prealablesDu, supprimerApprovisionnement, televerserDocument,
  listerFil, listerInterventions, listerMembres, majChantier,
  prononcerReception,
} from '../lib/db';
import Modale from '../components/Modale';
import { LIBELLE_STATUT } from './Chantiers';
import type {
  Approvisionnement, Chantier, Document, Fil, Intervention, Membre, Prealable,
} from '../lib/types';
import FilAriane from '../components/FilAriane';
import Bulle from '../components/Bulle';
import Dictee from '../components/Dictee';
import { MachinesChantier } from '../components/Machines';
import { FichesFluideChantier } from '../components/FichesFluide';

const TYPES_INTERVENTION: Record<Intervention['type'], string> = {
  visite_technique: 'Visite technique', pose: 'Pose', mise_en_service: 'Mise en service',
  sav: 'SAV', entretien: 'Entretien', controle_etancheite: 'Contrôle d’étanchéité',
};

export default function PageFicheChantier({ chantierId }: { chantierId: string }) {
  const [c, setC] = useState<(Chantier & { tiers: { id: string; nom: string } | null }) | null>(null);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [fil, setFil] = useState<Fil[]>([]);
  const [prealables, setPrealables] = useState<Prealable[]>([]);
  const [pieces, setPieces] = useState<Document[]>([]);
  const [jointes, setJointes] = useState<File[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [ajoutPrealable, setAjoutPrealable] = useState('');
  const [appro, setAppro] = useState<Approvisionnement[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reception, setReception] = useState(false);

  const recharger = useCallback(async () => {
    try {
      const [ch, i, m, f, pr, doc, ap] = await Promise.all([
        chargerChantier(chantierId), listerInterventions(chantierId),
        listerMembres(), listerFil({ chantierId }),
        listerPrealables().catch(() => []),
        listerDocuments({ chantier_id: chantierId }).catch(() => []),
        listerApprovisionnement(chantierId).catch(() => []),
      ]);
      setC(ch); setInterventions(i); setMembres(m); setFil(f);
      setPrealables(pr); setPieces(doc); setAppro(ap);
    } catch (e) { setErreur((e as Error).message); }
  }, [chantierId]);

  useEffect(() => { void recharger(); }, [recharger]);
  if (!c) return erreur ? <div className="erreur">{erreur}</div> : null;

  // La liste du chantier, ou celle de l'entreprise pour les chantiers créés
  // avant que les préalables ne deviennent modifiables.
  const liste = prealablesDu(c, prealables);
  const orphelines = pieces.filter((d) => !d.fil_id);
  const faits = liste.filter((x) => c.checklist?.[x.cle]).length;
  const pretAPlanifier = liste.length > 0 && faits === liste.length;

  /** Modifie la liste de CE chantier seulement. Celle de l'entreprise ne bouge pas. */
  async function majListe(nouvelle: { cle: string; libelle: string; aide?: string | null }[]) {
    if (!c) return;
    setC({ ...c, prealables: nouvelle });
    try { await majChantier(c.id, { prealables: nouvelle }); }
    catch (e) { setErreur((e as Error).message); }
  }

  async function ajouterPrealable() {
    const libelle = ajoutPrealable.trim();
    if (!libelle) return;
    let cle = clePrealable(libelle);
    // Deux préalables ne peuvent pas partager une clé : c'est elle qui porte la coche.
    let n = 1;
    while (liste.some((x) => x.cle === cle)) cle = `${clePrealable(libelle)}_${++n}`;
    setAjoutPrealable('');
    await majListe([...liste, { cle, libelle }]);
  }

  /** Envoie une note et ses photos ensemble. La photo appartient à la note. */
  async function noter() {
    if (!c) return;
    if (!note.trim() && jointes.length === 0) return;
    setEnvoi(true);
    try {
      const f = await ajouterFil({
        chantier_id: chantierId, tiers_id: c.tiers_id, type: 'note',
        contenu: note.trim() || '(photos)', a_traiter: true,
      });
      for (const fichier of jointes) {
        await televerserDocument({ chantier_id: chantierId }, fichier, {
          type: 'photo', fil_id: f.id,
          prise_le: fichier.lastModified ? new Date(fichier.lastModified).toISOString() : null,
        });
      }
      setNote(''); setJointes([]);
      recharger();
    } catch (e) { setErreur((e as Error).message); }
    setEnvoi(false);
  }

  async function basculer(cle: string) {
    if (!c) return;
    const checklist = { ...(c.checklist ?? {}), [cle]: !c.checklist?.[cle] };
    setC({ ...c, checklist });
    try { await majChantier(c.id, { checklist }); }
    catch (e) { setErreur((e as Error).message); }
  }

  return (
    <>
      <FilAriane etapes={[
        { libelle: 'Chantiers', vers: '/chantiers' },
        ...(c.tiers ? [{ libelle: c.tiers.nom, vers: `/clients/${c.tiers.id}` }] : []),
        { libelle: c.numero },
      ]} />

      <div className="entete">
        <div>
          <h1>{c.numero} — {c.libelle}</h1>
          <div className="statut">
            {c.tiers?.nom ?? '—'} · {LIBELLE_STATUT[c.statut]}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Le seul écran de cette page utilisable par un technicien : il n'y
              trouve aucun prix, et c'est garanti en base, pas à l'affichage. */}
          <button className="action discret" onClick={() => aller(`/pose/${chantierId}`)}>
            Fiche de pose
          </button>
          {c.pv_date ? (
            <button className="action discret" onClick={() => aller(`/pv/${chantierId}`)}>
              Procès-verbal
            </button>
          ) : (
            <button className="action" onClick={() => setReception(true)}>
              Prononcer la réception
            </button>
          )}
          <button className="action discret" onClick={() => aller('/chantiers')}>Retour</button>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {c.pv_date && (
        <div className="panneau" style={{ display: 'flex', gap: 14, alignItems: 'center',
                                          flexWrap: 'wrap',
                                          borderLeft: `3px solid ${c.pv_avec_reserves ? '#b8860b' : 'var(--vert)'}` }}>
          <strong>
            Réception prononcée le {new Date(c.pv_date).toLocaleDateString('fr-FR')}
            {c.pv_avec_reserves ? ' avec réserves' : ' sans réserve'}
          </strong>
          <span className="statut" style={{ flex: 1, minWidth: 240 }}>
            {c.pv_numero ? `${c.pv_numero} · ` : ''}
            Décennale jusqu’au{' '}
            {new Date(new Date(c.pv_date).setFullYear(
              new Date(c.pv_date).getFullYear() + 10)).toLocaleDateString('fr-FR')}
          </span>
          <button className="action discret" onClick={() => aller(`/pv/${chantierId}`)}>
            Voir le procès-verbal
          </button>
        </div>
      )}

      {reception && (
        <Reception
          chantierId={chantierId}
          reserves={(c.reserves ?? []).filter((r) => r.texte?.trim()).length}
          onAnnuler={() => setReception(false)}
          onFait={() => { setReception(false); void recharger(); aller(`/pv/${chantierId}`); }}
          onErreur={setErreur}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 20 }}>
        <div>
          <h2 style={{ marginBottom: 8 }}>Interventions</h2>
          <Interventions chantierId={chantierId} interventions={interventions} membres={membres}
                         onErreur={setErreur} onChange={recharger} />

          <h2 style={{ margin: '20px 0 8px' }}>À commander et faire livrer</h2>
          <p className="statut" style={{ marginBottom: 8 }}>
            Repris du devis à la signature, puis modifiable : on commande parfois un
            modèle équivalent, on ajoute une pièce oubliée. L’écart avec le devis est
            une information, pas une erreur.
          </p>
          {appro.length === 0 ? (
            <div className="vide" style={{ padding: 18 }}>
              Rien à commander. La liste se remplit à la signature du devis.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Matériel</th>
                  <th className="num" style={{ width: 70 }}>Qté</th>
                  <th style={{ width: 140 }}>Fournisseur</th>
                  <th style={{ width: 130 }}>Commandé le</th>
                  <th style={{ width: 130 }}>Livré le</th>
                  <th style={{ width: 40 }} className="sans-impression" />
                </tr>
              </thead>
              <tbody>
                {appro.map((a) => (
                  <tr key={a.id} style={a.livre_le ? { opacity: 0.65 } : undefined}>
                    <td>
                      {a.designation}
                      {a.reference && <div className="ref">{a.reference}</div>}
                    </td>
                    <td className="num">
                      {Number(a.quantite).toLocaleString('fr-FR')}
                      <div className="statut">{a.unite}</div>
                    </td>
                    <td>
                      <input defaultValue={a.fournisseur ?? ''} placeholder="—"
                             style={{ padding: '3px 5px', fontSize: 12 }}
                             onBlur={(e) => e.target.value !== (a.fournisseur ?? '')
                               && void enregistrerApprovisionnement({
                                 id: a.id, fournisseur: e.target.value || null }).then(recharger)} />
                    </td>
                    <td>
                      <input type="date" defaultValue={a.commande_le ?? ''}
                             style={{ padding: '3px 4px', fontSize: 12 }}
                             onChange={(e) => void enregistrerApprovisionnement({
                               id: a.id, commande_le: e.target.value || null }).then(recharger)} />
                    </td>
                    <td>
                      <input type="date" defaultValue={a.livre_le ?? ''}
                             style={{ padding: '3px 4px', fontSize: 12 }}
                             onChange={(e) => void enregistrerApprovisionnement({
                               id: a.id, livre_le: e.target.value || null }).then(recharger)} />
                    </td>
                    <td className="sans-impression">
                      <button className="action discret" style={{ padding: '2px 7px' }}
                              onClick={() => void supprimerApprovisionnement(a.id)
                                .then(recharger)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {appro.length > 0 && (
            <p className="statut" style={{ marginTop: 6 }}>
              {appro.filter((a) => a.livre_le).length} sur {appro.length} livré(s).
              Cochez « Matériel livré » dans les préalables quand tout est arrivé.
            </p>
          )}

          {/* Les machines remplacent l'ancienne liste « Matériel posé » : mêmes
              lignes d'equipement, mais avec ce que la réglementation demande
              d'en savoir et la plaque comme source de vérité. */}
          <h2 style={{ margin: '20px 0 8px' }}>Machines</h2>
          <MachinesChantier chantierId={chantierId} siteId={c.site_id} onErreur={setErreur} />

          <h2 style={{ margin: '20px 0 8px' }}>Fiches fluides</h2>
          <FichesFluideChantier chantierId={chantierId} interventions={interventions}
                                onErreur={setErreur} />

          <div style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'baseline', margin: '20px 0 8px', gap: 12 }}>
            <h2>Journal</h2>
            <Bulle texte="Une note récente apparaît aussi dans la cloche et dans le journal général.">
              <a href="#/journal" className="statut">tous les chantiers</a>
            </Bulle>
          </div>
          <div className="panneau" style={{ display: 'block', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <input placeholder="Ce qui s’est passé sur le chantier" value={note}
                     style={{ flex: 1 }}
                     onChange={(e) => setNote(e.target.value)} />
              {/* Une note se dicte mieux qu'elle ne se tape, sur un chantier. */}
              <Dictee onErreur={setErreur}
                      onTexte={(t) => setNote((n) => (n ? `${n} ${t}` : t))} />
              <label className="depot" style={{ whiteSpace: 'nowrap' }}>
                <input type="file" multiple accept="image/*,video/*" style={{ display: 'none' }}
                       onChange={(e) => setJointes(Array.from(e.target.files ?? []))} />
                {jointes.length ? `${jointes.length} fichier(s)` : 'Photos, vidéos'}
              </label>
              <button className="action" disabled={envoi} onClick={() => void noter()}>
                {envoi ? 'Envoi…' : 'Noter'}
              </button>
            </div>
            <p className="statut" style={{ marginTop: 6 }}>
              Les photos partent avec la note : l’image et son explication restent ensemble.
              Une photo seule, retrouvée trois mois plus tard, ne prouve rien.
            </p>
          </div>
          {fil.map((f) => {
            const siennes = pieces.filter((d) => d.fil_id === f.id);
            return (
              <div key={f.id} style={{ background: 'var(--surface)', border: '1px solid var(--filet)',
                                       padding: '8px 12px', marginBottom: 5 }}>
                <span className="statut">
                  {new Date(f.occurred_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {f.auteur && ` · ${f.auteur}`}
                </span>{' '}
                {f.sujet ?? f.contenu}
                {siennes.length > 0 && <Vignettes docs={siennes} onErreur={setErreur} />}
              </div>
            );
          })}

          {orphelines.length > 0 && (
            <>
              <h3 style={{ margin: '18px 0 6px' }}>Photos sans note</h3>
              <p className="statut" style={{ marginBottom: 8 }}>
                Déposées avant que les photos ne se rattachent à une note. Elles restent
                consultables ; les nouvelles arrivent désormais avec leur explication.
              </p>
              <Vignettes docs={orphelines} onErreur={setErreur} />
            </>
          )}
        </div>

        <aside style={{ position: 'sticky', top: 70, alignSelf: 'start' }}>
          <div className="panneau" style={{ display: 'block' }}>
            <h3 style={{ marginBottom: 8 }}>Préalables</h3>
            <p className="statut" style={{ marginBottom: 10 }}>
              Première cause de chantier bloqué après signature.
            </p>
            {liste.map((x) => (
              <div key={x.cle} style={{ display: 'flex', gap: 6, alignItems: 'start', marginBottom: 6 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'start', flex: 1,
                                margin: 0, color: 'var(--encre)' }}>
                  <input type="checkbox" style={{ width: 'auto', marginTop: 3 }}
                         checked={!!c.checklist?.[x.cle]} onChange={() => void basculer(x.cle)} />
                  <span>
                    {x.libelle}
                    {x.aide && <span className="statut" style={{ display: 'block' }}>{x.aide}</span>}
                  </span>
                </label>
                <button className="lien-discret" title="Retirer de ce chantier"
                        onClick={() => void majListe(liste.filter((y) => y.cle !== x.cle))}>×</button>
              </div>
            ))}

            {liste.length === 0 && (
              <p className="statut">Aucun préalable sur ce chantier.</p>
            )}

            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input placeholder="Ajouter un préalable" value={ajoutPrealable}
                     style={{ fontSize: 12, padding: '4px 6px' }}
                     onChange={(e) => setAjoutPrealable(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && void ajouterPrealable()} />
              <button className="action discret" style={{ padding: '2px 10px' }}
                      onClick={() => void ajouterPrealable()}>+</button>
            </div>

            <div style={{ marginTop: 10, color: pretAPlanifier ? 'var(--vert)' : 'var(--alerte)' }}>
              {faits} / {liste.length} — {pretAPlanifier ? 'planifiable' : 'ne pas planifier'}
            </div>
            <p className="statut" style={{ marginTop: 6 }}>
              Cette liste n’appartient qu’à ce chantier. La liste par défaut se règle
              dans <a href="#/reglages">Entreprise</a>.
            </p>
          </div>

          <div className="panneau" style={{ display: 'block' }}>
            <h3 style={{ marginBottom: 8 }}>Dates</h3>
            <label>Début</label>
            <input type="date" value={c.date_debut ?? ''}
                   onChange={(e) => void majChantier(c.id, { date_debut: e.target.value || null }).then(recharger)} />
            <label style={{ marginTop: 8 }}>Fin prévue</label>
            <input type="date" value={c.date_fin ?? ''}
                   onChange={(e) => void majChantier(c.id, { date_fin: e.target.value || null }).then(recharger)} />
            <label style={{ marginTop: 8 }}>Réception</label>
            <input type="date" value={c.date_reception ?? ''}
                   onChange={(e) => void majChantier(c.id, { date_reception: e.target.value || null }).then(recharger)} />
          </div>
        </aside>
      </div>
    </>
  );
}

function Interventions({ chantierId, interventions, membres, onErreur, onChange }: {
  chantierId: string; interventions: Intervention[]; membres: Membre[];
  onErreur: (m: string) => void; onChange: () => void;
}) {
  const [i, setI] = useState<Partial<Intervention>>({ type: 'pose' });

  async function ajouter() {
    try { await enregistrerIntervention({ ...i, chantier_id: chantierId }); setI({ type: 'pose' }); onChange(); }
    catch (e) { onErreur((e as Error).message); }
  }

  return (
    <>
      {interventions.length === 0 ? (
        <div className="vide">Aucune intervention planifiée.</div>
      ) : (
        <>
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Qui</th><th>Statut</th><th>Fluide</th></tr></thead>
          <tbody>
            {interventions.map((x) => {
              const salarie = membres.find((m) => m.id === x.membre_id);
              const externe = !salarie && x.sous_traitant_id;
              return (
              <tr key={x.id} style={{
                borderLeft: `3px solid ${salarie ? 'var(--bleu)' : externe ? '#7a5ea8' : 'var(--filet)'}`,
              }}>
                <td className="num ref">{x.date_prevue ? new Date(x.date_prevue).toLocaleDateString('fr-FR') : '—'}</td>
                <td>{TYPES_INTERVENTION[x.type]}</td>
                <td>
                  {salarie ? (
                    <>
                      <a href={`#/equipe/${salarie.id}`}>{salarie.nom}</a>
                      <div><span className="jeton" data-r="salarie">salarié</span></div>
                    </>
                  ) : externe ? (
                    <span className="jeton" data-r="sous_traitant">sous-traitant</span>
                  ) : (
                    <span className="statut">non affecté</span>
                  )}
                </td>
                <td>
                  <select value={x.statut}
                          onChange={(e) => void enregistrerIntervention({ id: x.id, statut: e.target.value as Intervention['statut'] }).then(onChange)}>
                    <option value="planifiee">Planifiée</option>
                    <option value="en_cours">En cours</option>
                    <option value="terminee">Terminée</option>
                    <option value="reportee">Reportée</option>
                    <option value="annulee">Annulée</option>
                  </select>
                </td>
                <td className="ref">
                  {x.charge_kg ? `${x.charge_kg} kg ${x.fluide ?? ''}` : '—'}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>

        <p className="statut" style={{ marginTop: 6 }}>
          <i style={{ width: 9, height: 9, background: 'var(--bleu)', display: 'inline-block',
                      borderRadius: 2, marginRight: 5 }} />
          salarié
          <i style={{ width: 9, height: 9, background: '#7a5ea8', display: 'inline-block',
                      borderRadius: 2, margin: '0 5px 0 14px' }} />
          sous-traitant
        </p>
        </>
      )}

      <div className="panneau" style={{ gridTemplateColumns: '1fr 1fr 1fr auto', marginTop: 10 }}>
        <div><label>Date</label>
          <input type="date" value={i.date_prevue ?? ''}
                 onChange={(e) => setI((p) => ({ ...p, date_prevue: e.target.value }))} /></div>
        <div><label>Type</label>
          <select value={i.type} onChange={(e) => setI((p) => ({ ...p, type: e.target.value as Intervention['type'] }))}>
            {Object.entries(TYPES_INTERVENTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label>Intervenant</label>
          <select value={i.membre_id ?? ''} onChange={(e) => setI((p) => ({ ...p, membre_id: e.target.value || null }))}>
            <option value="">—</option>
            {membres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select></div>
        <button className="action" onClick={() => void ajouter()}>Planifier</button>
      </div>
    </>
  );
}

// --- Prononcer la réception -------------------------------------------------

/**
 * La réception fait courir les garanties : un an de parfait achèvement,
 * deux ans de bon fonctionnement, dix ans de décennale. La date saisie ici
 * est donc juridiquement structurante, pas administrative.
 */
function Reception({ chantierId, reserves, onAnnuler, onFait, onErreur }: {
  chantierId: string;
  reserves: number;
  onAnnuler: () => void;
  onFait: () => void;
  onErreur: (m: string) => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [avecReserves, setAvecReserves] = useState(reserves > 0);
  const [representant, setRepresentant] = useState('');
  const [observations, setObservations] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const plus = (annees: number) => {
    const d = new Date(date);
    d.setFullYear(d.getFullYear() + annees);
    return d.toLocaleDateString('fr-FR');
  };

  return (
    <Modale titre="Prononcer la réception des travaux" onFermer={onAnnuler}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="panneau" style={{ display: 'block', margin: 0,
                                          borderLeft: '3px solid var(--bleu)' }}>
          <strong style={{ fontSize: 13 }}>Ce que cette date déclenche</strong>
          <p className="statut">
            Parfait achèvement jusqu’au {plus(1)}, bon fonctionnement jusqu’au {plus(2)},
            décennale jusqu’au {plus(10)}. Choisissez la date réelle de la visite de
            réception, pas celle de la saisie.
          </p>
        </div>

        <div>
          <label>Date de réception</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div>
          <label style={{ color: 'var(--encre)' }}>
            <input type="checkbox" style={{ width: 'auto', marginRight: 8 }}
                   checked={avecReserves} onChange={(e) => setAvecReserves(e.target.checked)} />
            Réception prononcée avec réserves
          </label>
          <p className="statut">
            {reserves > 0
              ? `${reserves} réserve${reserves > 1 ? 's' : ''} saisie${reserves > 1 ? 's' : ''} sur la fiche du chantier, elle${reserves > 1 ? 's' : ''} figurera${reserves > 1 ? 'ont' : ''} au procès-verbal.`
              : 'Aucune réserve saisie sur la fiche. Ajoutez-les avant si nécessaire.'}
          </p>
        </div>

        <div>
          <label>Représentant du maître d’ouvrage</label>
          <input value={representant} placeholder="M. Lambert, gérant"
                 onChange={(e) => setRepresentant(e.target.value)} />
        </div>

        <div>
          <label>Observations</label>
          <textarea rows={3} value={observations}
                    onChange={(e) => setObservations(e.target.value)}
                    placeholder="Réception prononcée en présence du gardien…" />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="action" disabled={envoi} onClick={() => {
            setEnvoi(true);
            void prononcerReception(chantierId, { date, avecReserves, representant, observations })
              .then(onFait)
              .catch((e) => { onErreur((e as Error).message); setEnvoi(false); });
          }}>
            Prononcer et établir le procès-verbal
          </button>
          <button className="action discret" onClick={onAnnuler}>Annuler</button>
        </div>
      </div>
    </Modale>
  );
}


/**
 * Les photos d'une note, en petit.
 *
 * Le seau est privé : chaque vignette réclame un lien signé, et on ne les
 * demande qu'une fois par document. Une vignette qui manque n'empêche pas la
 * note de s'afficher — l'explication vaut déjà quelque chose sans l'image.
 */
function Vignettes({ docs, onErreur }: { docs: Document[]; onErreur: (m: string) => void }) {
  const [liens, setLiens] = useState<Record<string, string>>({});

  useEffect(() => {
    let vivant = true;
    (async () => {
      for (const d of docs) {
        if (!d.chemin || liens[d.id]) continue;
        try {
          const url = await lienDocument(d.chemin);
          if (vivant) setLiens((l) => ({ ...l, [d.id]: url }));
        } catch { /* une vignette absente ne casse pas la note */ }
      }
    })();
    return () => { vivant = false; };
  }, [docs, liens]);

  async function ouvrir(d: Document) {
    if (!d.chemin) return;
    try { window.open(await lienDocument(d.chemin), '_blank', 'noopener'); }
    catch (e) { onErreur((e as Error).message); }
  }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {docs.map((d) => (
        <button key={d.id} className="galerie-vue" style={{ width: 84, height: 84 }}
                title={`${d.nom} — ${poids(d.taille_octets)}`}
                onClick={() => void ouvrir(d)}>
          {liens[d.id] && d.type_mime?.startsWith('image/')
            ? <img src={liens[d.id]} alt={d.legende ?? d.nom} />
            : <span className="galerie-icone" style={{ fontSize: 18 }}>
                {d.type_mime?.startsWith('video/') ? '▶' : '📄'}
              </span>}
        </button>
      ))}
    </div>
  );
}
