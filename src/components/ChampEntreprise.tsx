import { useCallback, useEffect, useRef, useState } from 'react';
import { antiRebond } from '../lib/adresse';
import { chercherEntreprise, formaterSiret, type Entreprise } from '../lib/entreprises';

/**
 * Recherche d'entreprise dans l'annuaire public. Un clic remplit la raison
 * sociale, le SIRET et l'adresse du siège d'un coup.
 */
export default function ChampEntreprise({
  valeur, onChange, onChoisir, placeholder,
}: {
  valeur: string;
  onChange: (v: string) => void;
  onChoisir: (e: Entreprise) => void;
  placeholder?: string;
}) {
  const [liste, setListe] = useState<Entreprise[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [cherche, setCherche] = useState(false);
  const zone = useRef<HTMLDivElement>(null);

  const chercher = useCallback(
    antiRebond((t: string) => {
      setCherche(true);
      void chercherEntreprise(t).then((r) => { setListe(r); setCherche(false); });
    }, 350),
    [],
  );

  useEffect(() => {
    const dehors = (e: MouseEvent) => {
      if (zone.current && !zone.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, []);

  return (
    <div ref={zone} style={{ position: 'relative' }}>
      <input
        value={valeur}
        autoComplete="off"
        placeholder={placeholder ?? 'Nom de l’entreprise ou SIRET'}
        onChange={(e) => { onChange(e.target.value); setOuvert(true); chercher(e.target.value); }}
        onFocus={() => valeur.length >= 3 && setOuvert(true)}
      />
      {ouvert && (liste.length > 0 || cherche) && (
        <div className="suggestions">
          {cherche && liste.length === 0 && (
            <div className="suggestions-pied">Recherche…</div>
          )}
          {liste.map((e) => (
            <button key={e.siret || e.siren} type="button"
                    onClick={() => { onChoisir(e); setOuvert(false); setListe([]); }}>
              <span>
                {e.nom}
                {e.cessee && <span className="jeton" data-r="retard" style={{ marginLeft: 6 }}>cessée</span>}
              </span>
              <span className="statut">
                {formaterSiret(e.siret)}
                {e.ville ? ` · ${e.ville}` : ''}
                {e.activite ? ` · ${e.activite}` : ''}
              </span>
            </button>
          ))}
          <div className="suggestions-pied">Source : annuaire des entreprises, API publique</div>
        </div>
      )}
    </div>
  );
}
