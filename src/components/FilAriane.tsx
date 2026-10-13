import { aller } from '../lib/router';

export interface Etape {
  libelle: string;
  vers?: string;
}

/** Fil d'Ariane : où je suis, et comment je remonte. */
export default function FilAriane({ etapes }: { etapes: Etape[] }) {
  return (
    <nav className="ariane sans-impression" aria-label="Fil d’Ariane">
      {etapes.map((e, i) => (
        <span key={i}>
          {i > 0 && <span className="ariane-sep">›</span>}
          {e.vers
            ? <button onClick={() => aller(e.vers!)}>{e.libelle}</button>
            : <span aria-current="page">{e.libelle}</span>}
        </span>
      ))}
    </nav>
  );
}
