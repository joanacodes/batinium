import { useEffect, useRef, useState } from 'react';
import { aller } from '../lib/router';
import {
  appliquerNote, devisDepuisAssistant, interroger, type ReponseAssistant,
} from '../lib/assistant';
import { IANonConfiguree } from '../lib/ia';
import { voitLesPrix } from '../lib/session';
import Dictee from './Dictee';

/**
 * L'assistant, en bulle.
 *
 * Il vit au-dessus de l'application plutôt qu'à côté : on l'interroge sans
 * quitter la page où l'on est, et on y revient. Une page d'assistant obligeait
 * à abandonner ce qu'on faisait pour poser une question sur ce qu'on faisait.
 *
 * Il lit, il ne fabrique rien. La seule chose qu'il peut écrire est une note
 * de chantier ou une note interne de devis, à la demande, et elle porte sa
 * signature — une note écrite par une machine et signée comme une note
 * humaine est une trace qu'on ne peut plus interpréter six mois plus tard.
 *
 * Ce qu'il voit dépend de qui l'interroge : le navigateur rassemble les
 * données avec les droits de la personne connectée. Un technicien n'obtient
 * rien sur les devis, parce que son navigateur n'a jamais pu en lire un.
 */

const EXEMPLES_DIRECTION = [
  'Qui attend une réponse ?',
  'Quels chantiers sont bloqués ?',
  'Quelles factures sont en retard ?',
  'Quels papiers expirent bientôt ?',
  'Fais-moi un devis : deux mono-splits dans les chambres, la pose et la mise en service',
];

const EXEMPLES_TERRAIN = [
  'Sur quels chantiers suis-je affecté ?',
  'Combien d’heures ai-je pointées cette semaine ?',
  'Mes papiers sont-ils à jour ?',
];

interface Echange {
  question: string;
  reponse?: ReponseAssistant;
  erreur?: string;
  noteEcrite?: boolean;
  devisCree?: string;
}

export default function Assistant() {
  const [ouvert, setOuvert] = useState(false);
  const [question, setQuestion] = useState('');
  const [echanges, setEchanges] = useState<Echange[]>([]);
  const [encours, setEncours] = useState(false);
  const bas = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => { bas.current?.scrollIntoView({ behavior: 'smooth' }); }, [echanges, ouvert]);
  // Le curseur va dans le champ à l'ouverture seulement avec une souris. Sur
  // un téléphone, donner le focus ouvre le clavier : il recouvrait la moitié
  // de l'écran avant même qu'on ait lu les exemples. Le clavier s'ouvre
  // quand on touche le champ, pas avant.
  useEffect(() => {
    if (ouvert && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      champ.current?.focus();
    }
  }, [ouvert]);

  // Échap referme, comme partout ailleurs dans l'application.
  useEffect(() => {
    if (!ouvert) return;
    const echap = (e: KeyboardEvent) => e.key === 'Escape' && setOuvert(false);
    document.addEventListener('keydown', echap);
    return () => document.removeEventListener('keydown', echap);
  }, [ouvert]);

  async function demander(texte: string) {
    const q = texte.trim();
    if (!q || encours) return;
    setQuestion('');
    setEncours(true);
    const index = echanges.length;
    setEchanges((e) => [...e, { question: q }]);

    try {
      const reponse = await interroger(q);
      setEchanges((e) => e.map((x, i) => (i === index ? { ...x, reponse } : x)));
    } catch (err) {
      const message = err instanceof IANonConfiguree
        ? `${(err as Error).message} Les commandes sont dans Connexions.`
        : (err as Error).message;
      setEchanges((e) => e.map((x, i) => (i === index ? { ...x, erreur: message } : x)));
    }
    setEncours(false);
  }

  async function ecrire(index: number, note: NonNullable<ReponseAssistant['note']>) {
    try {
      await appliquerNote(note);
      setEchanges((e) => e.map((x, i) => (i === index ? { ...x, noteEcrite: true } : x)));
    } catch (err) {
      setEchanges((e) => e.map((x, i) =>
        (i === index ? { ...x, erreur: (err as Error).message } : x)));
    }
  }

  async function creerDevisPropose(index: number, e: Echange) {
    if (!e.reponse?.devis) return;
    try {
      const id = await devisDepuisAssistant(e.reponse.devis, e.question);
      setEchanges((x) => x.map((y, i) => (i === index ? { ...y, devisCree: id } : y)));
    } catch (err) {
      setEchanges((x) => x.map((y, i) =>
        (i === index ? { ...y, erreur: (err as Error).message } : y)));
    }
  }

  const exemples = voitLesPrix() ? EXEMPLES_DIRECTION : EXEMPLES_TERRAIN;

  return (
    <div className="sans-impression">
      <button className="assistant-bulle" data-ouvert={ouvert ? 'oui' : 'non'}
              onClick={() => setOuvert(!ouvert)}
              aria-expanded={ouvert}
              aria-label={ouvert ? 'Fermer l’assistant' : 'Ouvrir l’assistant'}
              title={ouvert ? 'Fermer l’assistant' : 'Poser une question'}>
        {ouvert ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.8-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
          </svg>
        )}
      </button>

      {ouvert && (
        <div className="assistant-volet" role="dialog" aria-label="Assistant">
          <div className="assistant-tete">
            <div>
              <strong>Assistant</strong>
              <div className="statut">Il lit vos données. Il ne modifie rien.</div>
            </div>
            {echanges.length > 0 && (
              <button className="lien-discret" onClick={() => setEchanges([])}>Effacer</button>
            )}
          </div>

          <div className="assistant-corps">
            {echanges.length === 0 && (
              <>
                <p className="statut" style={{ marginBottom: 10 }}>
                  Posez une question sur l’activité. L’assistant voit ce que{' '}
                  <strong>vous</strong> avez le droit de voir, ni plus ni moins.
                </p>
                <div style={{ display: 'grid', gap: 6 }}>
                  {exemples.map((e) => (
                    <button key={e} className="action discret"
                            style={{ fontSize: 13, textAlign: 'left' }}
                            onClick={() => void demander(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </>
            )}

            {echanges.map((e, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <div className="assistant-question">{e.question}</div>

                {e.erreur ? (
                  <div className="erreur" style={{ marginBottom: 0 }}>{e.erreur}</div>
                ) : !e.reponse ? (
                  <p className="statut">Lecture de vos données…</p>
                ) : (
                  <div className="assistant-reponse">
                    <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{e.reponse.reponse}</p>

                    {e.reponse.liens && e.reponse.liens.length > 0 && (
                      <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                        {e.reponse.liens.map((l, j) => (
                          <button key={j} className="action discret"
                                  style={{ fontSize: 13, textAlign: 'left' }}
                                  onClick={() => { aller(l.url.replace(/^#/, '')); setOuvert(false); }}>
                            {l.libelle} →
                          </button>
                        ))}
                      </div>
                    )}

                    {e.reponse.devis && e.reponse.devis.lignes.length > 0 && (
                      <div style={{ marginTop: 10, borderTop: '1px solid var(--filet)',
                                    paddingTop: 8 }}>
                        <span className="statut">
                          Devis proposé — {e.reponse.devis.titre}
                        </span>
                        <ul style={{ margin: '6px 0 8px', paddingLeft: 18 }}>
                          {e.reponse.devis.lignes.map((l, j) => (
                            <li key={j} style={{ fontSize: 13 }}>
                              {l.quantite} {l.unite} — {l.designation}
                            </li>
                          ))}
                        </ul>
                        {e.devisCree ? (
                          <button className="action" style={{ fontSize: 13 }}
                                  onClick={() => { aller(`/devis/${e.devisCree}`); setOuvert(false); }}>
                            Ouvrir le brouillon →
                          </button>
                        ) : (
                          <>
                            <button className="action" style={{ fontSize: 13 }}
                                    onClick={() => void creerDevisPropose(i, e)}>
                              Créer le brouillon
                            </button>
                            <p className="statut" style={{ marginTop: 6 }}>
                              Sans client ni prix : vous les mettrez dans l’éditeur, où le
                              moteur de TVA sait faire son travail.
                            </p>
                          </>
                        )}
                      </div>
                    )}

                    {e.reponse.note && (
                      <div style={{ marginTop: 10, borderTop: '1px solid var(--filet)',
                                    paddingTop: 8 }}>
                        <span className="statut">
                          Note proposée pour {e.reponse.note.cible === 'journal'
                            ? 'le journal du chantier' : 'les notes internes du devis'}
                        </span>
                        <p style={{ margin: '4px 0 8px' }}>{e.reponse.note.texte}</p>
                        {e.noteEcrite ? (
                          <span className="jeton" data-r="recu">écrite, signée « assistant »</span>
                        ) : (
                          <button className="action" style={{ fontSize: 13 }}
                                  onClick={() => void ecrire(i, e.reponse!.note!)}>
                            Enregistrer cette note
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={bas} />
          </div>

          <div className="assistant-pied">
            <input ref={champ} value={question} disabled={encours}
                   placeholder="Votre question…"
                   onChange={(ev) => setQuestion(ev.target.value)}
                   onKeyDown={(ev) => ev.key === 'Enter' && void demander(question)} />
            <Dictee onTexte={(t) => setQuestion((q) => (q ? `${q} ${t}` : t))} />
            <button className="action" disabled={encours || !question.trim()}
                    onClick={() => void demander(question)}>
              {encours ? '…' : 'Envoyer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
