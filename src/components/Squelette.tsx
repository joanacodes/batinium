/**
 * Squelettes de chargement. Un dégradé traverse chaque bloc, ce qui indique
 * que la page travaille sans faire croire à une erreur ni faire clignoter
 * l'interface. La forme annonce ce qui va apparaître.
 */

export function Barre({ largeur = '100%', hauteur = 14 }:
  { largeur?: string | number; hauteur?: number }) {
  return <span className="squelette" style={{ width: largeur, height: hauteur }} />;
}

export function Chiffres({ nombre = 4 }: { nombre?: number }) {
  return (
    <div style={{ display: 'grid', gap: 12, marginBottom: 20,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
      {Array.from({ length: nombre }, (_, i) => (
        <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--filet)',
                              padding: '12px 14px' }}>
          <Barre largeur="55%" hauteur={11} />
          <div style={{ height: 8 }} />
          <Barre largeur="80%" hauteur={24} />
        </div>
      ))}
    </div>
  );
}

export function Tableau({ lignes = 6, colonnes = 5 }: { lignes?: number; colonnes?: number }) {
  // Des largeurs irrégulières : un tableau parfaitement aligné ne ressemble
  // à rien de réel et se remarque comme un artifice.
  const largeurs = ['70%', '85%', '55%', '90%', '65%', '78%', '48%'];
  return (
    <table>
      <tbody>
        {Array.from({ length: lignes }, (_, i) => (
          <tr key={i}>
            {Array.from({ length: colonnes }, (_, j) => (
              <td key={j}>
                <Barre largeur={largeurs[(i + j) % largeurs.length]} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Squelette complet d'une page de tableau, en-tête compris. */
export default function Squelette({ chiffres = 0, lignes = 6, colonnes = 5 }:
  { chiffres?: number; lignes?: number; colonnes?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      {chiffres > 0 && <Chiffres nombre={chiffres} />}
      <Tableau lignes={lignes} colonnes={colonnes} />
      <span className="statut" style={{ display: 'block', marginTop: 10 }}>
        Chargement…
      </span>
    </div>
  );
}
