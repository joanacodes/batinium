import { useRef, useState } from 'react';

/**
 * Bulle d'explication au survol prolongé. Six cents millisecondes : assez pour
 * ne pas gêner celui qui sait, assez court pour aider celui qui cherche.
 * Le texte doit tenir en une phrase.
 */
export default function Bulle({ texte, children }: { texte: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const minuteur = useRef<number | undefined>(undefined);

  const entrer = () => {
    minuteur.current = window.setTimeout(() => setVisible(true), 600);
  };
  const sortir = () => {
    window.clearTimeout(minuteur.current);
    setVisible(false);
  };

  return (
    <span className="bulle-hote" onMouseEnter={entrer} onMouseLeave={sortir}
          onFocus={entrer} onBlur={sortir}>
      {children}
      {visible && <span className="bulle" role="tooltip">{texte}</span>}
    </span>
  );
}
