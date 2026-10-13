import { useEffect, useRef, useState } from 'react';

/**
 * Panneau qui s'ouvre au survol et se referme quand la souris s'en va.
 *
 * Deux précautions, sans lesquelles c'est insupportable : un délai avant
 * l'ouverture pour ne pas déclencher en passant devant, et un délai avant la
 * fermeture pour laisser le temps d'atteindre le panneau. Il reste également
 * ouvert tant qu'un champ à l'intérieur a le curseur, sinon on le perdrait
 * en pleine saisie au clavier.
 *
 * Le clic fonctionne toujours : sur écran tactile, il n'y a pas de survol.
 */
export default function Survol({
  declencheur, children, aligne = 'droite', delaiOuverture = 220, delaiFermeture = 380,
}: {
  declencheur: (etat: { ouvert: boolean; basculer: () => void }) => React.ReactNode;
  children: React.ReactNode;
  aligne?: 'gauche' | 'droite';
  delaiOuverture?: number;
  delaiFermeture?: number;
}) {
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  const minuteur = useRef<number | undefined>(undefined);
  const parLeClic = useRef(false);

  const annuler = () => window.clearTimeout(minuteur.current);

  function entrer() {
    annuler();
    if (ouvert) return;
    minuteur.current = window.setTimeout(() => setOuvert(true), delaiOuverture);
  }

  function sortir() {
    annuler();
    minuteur.current = window.setTimeout(() => {
      // Un champ en cours de saisie retient le panneau ouvert.
      const actif = document.activeElement;
      if (actif && zone.current?.contains(actif)) return;
      setOuvert(false);
      parLeClic.current = false;
    }, delaiFermeture);
  }

  function basculer() {
    annuler();
    parLeClic.current = !ouvert;
    setOuvert(!ouvert);
  }

  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => {
      if (zone.current && !zone.current.contains(e.target as Node)) {
        annuler();
        setOuvert(false);
        parLeClic.current = false;
      }
    };
    const echap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { annuler(); setOuvert(false); parLeClic.current = false; }
    };
    document.addEventListener('mousedown', dehors);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('keydown', echap);
    };
  }, [ouvert]);

  useEffect(() => () => annuler(), []);

  return (
    <div ref={zone} className="survol" onMouseEnter={entrer} onMouseLeave={sortir}>
      {declencheur({ ouvert, basculer })}
      {ouvert && (
        <div className="survol-panneau" data-aligne={aligne}>
          {children}
        </div>
      )}
    </div>
  );
}
