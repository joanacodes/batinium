import { useState } from 'react';
import { noterAuJournal } from '../lib/db';
import Modale from './Modale';
import Dictee from './Dictee';
import ChoixMedias from './ChoixMedias';

/**
 * Envoyer des photos ou une vidéo depuis Ma journée, sans quitter l'écran.
 *
 * Tout part dans le journal du chantier, avec une phrase : c'est là que le
 * bureau les cherche, et c'est là que la fiche chantier les montre.
 */
export default function EnvoiMedias({ chantierId, tiersId, titre, onFermer, onEnvoye }: {
  chantierId: string; tiersId: string | null; titre: string;
  onFermer: () => void; onEnvoye: () => void;
}) {
  const [texte, setTexte] = useState('');
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer() {
    if (!texte.trim() && fichiers.length === 0) {
      setErreur('Ajoutez une photo, une vidéo ou au moins une phrase.');
      return;
    }
    setEnvoi(true); setErreur(null);
    try {
      await noterAuJournal({ chantierId, tiersId, texte, fichiers });
      onEnvoye();
    } catch (e) {
      setErreur((e as Error).message);
      setEnvoi(false);
    }
  }

  return (
    <Modale titre={titre} onFermer={onFermer}>
      {/* L'erreur reste dans la fenêtre : affichée derrière, personne ne la lit. */}
      {erreur && <div className="erreur">{erreur}</div>}
      <label>Ce qu’on voit</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
        <textarea rows={3} value={texte} style={{ flex: 1 }}
                  placeholder="Fuite au raccord de l’unité extérieure, avant reprise"
                  onChange={(e) => setTexte(e.target.value)} />
        <Dictee onErreur={setErreur} onTexte={(t) => setTexte((x) => (x ? `${x} ${t}` : t))} />
      </div>
      <div style={{ marginTop: 12 }}>
        <ChoixMedias fichiers={fichiers} onChange={setFichiers} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="action" disabled={envoi} onClick={() => void envoyer()}>
          {envoi ? 'Envoi…' : 'Envoyer au journal du chantier'}
        </button>
        <button className="action discret" disabled={envoi} onClick={onFermer}>Annuler</button>
      </div>
    </Modale>
  );
}
