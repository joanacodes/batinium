import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Garde-fou. Sans lui, une page qui plante laisse un écran blanc muet et
 * personne ne sait ce qui s'est passé. Ici l'erreur s'affiche, le menu reste
 * utilisable, et on peut aller ailleurs sans recharger.
 */
export default class Garde extends Component<
  { children: ReactNode; section: string },
  { erreur: Error | null; pile: string | null }
> {
  state = { erreur: null as Error | null, pile: null as string | null };

  static getDerivedStateFromError(erreur: Error) {
    return { erreur, pile: null };
  }

  componentDidCatch(erreur: Error, info: ErrorInfo) {
    // La console garde la trace complète, l'écran garde l'essentiel.
    console.error('Batinium — erreur d’affichage', erreur, info);
    this.setState({ pile: info.componentStack ?? null });
  }

  componentDidUpdate(precedent: { section: string }) {
    // On change de page : on repart propre.
    if (precedent.section !== this.props.section && this.state.erreur) {
      this.setState({ erreur: null, pile: null });
    }
  }

  render() {
    if (!this.state.erreur) return this.props.children;

    return (
      <>
        <div className="entete"><h1>Cette page n’a pas pu s’afficher</h1></div>
        <div className="erreur">{this.state.erreur.message}</div>

        <div className="panneau" style={{ display: 'block' }}>
          <p>Trois causes possibles, par ordre de fréquence :</p>
          <ol>
            <li>
              Un fichier SQL n’a pas été exécuté dans Supabase. Le message ci-dessus
              parle alors d’une table ou d’une colonne introuvable.
            </li>
            <li>
              Un fichier de l’application est manquant ou mal placé. Le message parle
              alors d’une fonction ou d’un composant indéfini.
            </li>
            <li>
              Une donnée inattendue. Plus rare, mais le message le dira.
            </li>
          </ol>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="action" onClick={() => window.location.reload()}>
              Recharger
            </button>
            <button className="action discret"
                    onClick={() => { window.location.hash = '#/bord'; }}>
              Retour à l’accueil
            </button>
          </div>
        </div>

        {this.state.pile && (
          <details className="panneau" style={{ display: 'block' }}>
            <summary style={{ cursor: 'pointer' }}>Détail technique</summary>
            <pre className="bloc-code" style={{ marginTop: 10 }}>{this.state.pile}</pre>
          </details>
        )}
      </>
    );
  }
}
