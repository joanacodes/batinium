import { useEffect, useRef, useState } from 'react';
import { dicteeDisponible, dicter, type SessionDictee } from '../lib/ia';

/**
 * Le bouton de dictée, à poser à côté de n'importe quel champ de texte.
 *
 * Il n'appelle aucun modèle et ne coûte rien : la transcription est faite par
 * le navigateur. C'est aussi pour ça qu'il peut être partout tout de suite,
 * sans attendre le déploiement de la passerelle.
 *
 * Sur un navigateur qui ne sait pas transcrire, le bouton ne s'affiche pas du
 * tout plutôt que de s'afficher désactivé : un bouton grisé qu'on ne peut
 * jamais utiliser est une promesse qu'on ne tient pas.
 */
export default function Dictee({ onTexte, titre = 'Dicter', onErreur }: {
  /** Reçoit le texte reconnu, à ajouter à ce qui est déjà saisi. */
  onTexte: (texte: string) => void;
  titre?: string;
  onErreur?: (message: string) => void;
}) {
  const [ecoute, setEcoute] = useState(false);
  const [provisoire, setProvisoire] = useState('');
  const session = useRef<SessionDictee | null>(null);

  // Une dictée qui continue après la fermeture de la page garde le micro
  // ouvert : le voyant reste allumé et personne ne comprend pourquoi.
  useEffect(() => () => session.current?.arreter(), []);

  if (!dicteeDisponible()) return null;

  function basculer() {
    if (ecoute) {
      session.current?.arreter();
      return;
    }
    session.current = dicter({
      onTexte: (t) => onTexte(t),
      onProvisoire: setProvisoire,
      onFin: () => { setEcoute(false); setProvisoire(''); },
      onErreur: (m) => { setEcoute(false); setProvisoire(''); onErreur?.(m); },
    });
    if (session.current) setEcoute(true);
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" className={`micro${ecoute ? ' actif' : ''}`}
              onClick={basculer}
              title={ecoute ? 'Arrêter la dictée' : titre}
              aria-label={ecoute ? 'Arrêter la dictée' : titre}
              aria-pressed={ecoute}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
        </svg>
      </button>
      {ecoute && (
        <span className="statut" style={{ maxWidth: 260, overflow: 'hidden',
                                          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {provisoire || 'À vous…'}
        </span>
      )}
    </span>
  );
}
