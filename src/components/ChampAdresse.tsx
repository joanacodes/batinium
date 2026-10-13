import { useCallback, useEffect, useRef, useState } from 'react';
import { antiRebond, suggerer, type Suggestion } from '../lib/adresse';

/**
 * Champ d'adresse avec suggestions. On peut toujours taper à la main :
 * la liste aide, elle n'impose rien.
 */
export default function ChampAdresse({
  valeur, onChange, onChoisir, placeholder, autoFocus,
}: {
  valeur: string;
  onChange: (v: string) => void;
  onChoisir?: (s: Suggestion) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [liste, setListe] = useState<Suggestion[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [index, setIndex] = useState(-1);
  const zone = useRef<HTMLDivElement>(null);

  const chercher = useCallback(
    antiRebond((t: string) => {
      void suggerer(t).then((r) => { setListe(r); setIndex(-1); });
    }, 250),
    [],
  );

  useEffect(() => {
    const dehors = (e: MouseEvent) => {
      if (zone.current && !zone.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, []);

  function retenir(s: Suggestion) {
    onChange(s.voie || s.texte);
    onChoisir?.(s);
    setOuvert(false);
    setListe([]);
  }

  function clavier(e: React.KeyboardEvent) {
    if (!ouvert || liste.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, liste.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter' && index >= 0) { e.preventDefault(); retenir(liste[index]); }
    else if (e.key === 'Escape') setOuvert(false);
  }

  return (
    <div ref={zone} style={{ position: 'relative' }}>
      <input
        value={valeur}
        autoFocus={autoFocus}
        placeholder={placeholder ?? '12 rue des Lilas'}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOuvert(true); chercher(e.target.value); }}
        onFocus={() => valeur.length >= 3 && setOuvert(true)}
        onKeyDown={clavier}
      />
      {ouvert && liste.length > 0 && (
        <div className="suggestions">
          {liste.map((s, i) => (
            <button key={`${s.texte}-${i}`} type="button"
                    className={i === index ? 'actif' : undefined}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => retenir(s)}>
              <span>{s.voie || s.texte}</span>
              <span className="statut">{s.codePostal} {s.ville}</span>
            </button>
          ))}
          <div className="suggestions-pied">Source : Base Adresse Nationale, IGN</div>
        </div>
      )}
    </div>
  );
}
