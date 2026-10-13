import { useEffect, useRef, useState } from 'react';

export interface Action {
  libelle: string;
  faire: () => void;
  danger?: boolean;
}

/**
 * Menu à trois points. Sert de poignée visible : sans lui, personne ne devine
 * qu'une ligne peut être déplacée, dupliquée ou supprimée.
 */
export default function Menu({ actions, poignee = false, titre }:
  { actions: Action[]; poignee?: boolean; titre?: string }) {
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => {
      if (zone.current && !zone.current.contains(e.target as Node)) setOuvert(false);
    };
    const echap = (e: KeyboardEvent) => e.key === 'Escape' && setOuvert(false);
    document.addEventListener('mousedown', dehors);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('keydown', echap);
    };
  }, [ouvert]);

  return (
    <span ref={zone} style={{ position: 'relative', display: 'inline-block' }}>
      <button className={poignee ? 'poignee' : 'points'} title={titre ?? 'Actions'}
              onClick={(e) => { e.stopPropagation(); setOuvert(!ouvert); }}>
        ⋮
      </button>
      {ouvert && (
        <span className="menu-liste" onClick={(e) => e.stopPropagation()}>
          {actions.map((a) => (
            <button key={a.libelle} onClick={() => { setOuvert(false); a.faire(); }}
                    style={a.danger ? { color: 'var(--alerte)' } : undefined}>
              {a.libelle}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
