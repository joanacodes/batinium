import { useEffect } from 'react';

/** Boîte de dialogue centrée. Échap et clic à l'extérieur ferment. */
export default function Modale({ titre, taille = 'moyenne', onFermer, children }: {
  titre: string;
  taille?: 'petite' | 'moyenne' | 'large';
  onFermer: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const echap = (e: KeyboardEvent) => e.key === 'Escape' && onFermer();
    document.addEventListener('keydown', echap);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', echap);
      document.body.style.overflow = '';
    };
  }, [onFermer]);

  const largeur = { petite: 460, moyenne: 720, large: 1040 }[taille];

  return (
    <div className="voile" onClick={onFermer}>
      <div className="modale" style={{ width: `min(${largeur}px, 94vw)` }}
           onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titre}>
        <div className="modale-entete">
          <h2>{titre}</h2>
          <button className="action discret" onClick={onFermer}>Fermer</button>
        </div>
        <div className="modale-corps">{children}</div>
      </div>
    </div>
  );
}
