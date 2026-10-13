import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { creerEntreprise, demanderRattachement, monRattachement } from '../lib/db';

/**
 * Écran des comptes qui n'appartiennent encore à aucune entreprise.
 * Deux chemins : créer la sienne, ou rejoindre celle d'un autre avec son code.
 */
export default function Bienvenue({ email, onRattache }: { email: string; onRattache: () => void }) {
  const [choix, setChoix] = useState<'aucun' | 'creer' | 'rejoindre'>('aucun');
  const [nomEntreprise, setNomEntreprise] = useState('');
  const [nom, setNom] = useState('');
  const [code, setCode] = useState('');
  const [attente, setAttente] = useState<{ statut: string; entreprise: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    monRattachement().then(setAttente).catch(() => setAttente(null));
  }, []);

  async function creer() {
    setEnvoi(true); setErreur(null);
    try { await creerEntreprise(nomEntreprise, nom || email); onRattache(); }
    catch (e) { setErreur((e as Error).message); setEnvoi(false); }
  }

  async function rejoindre() {
    setEnvoi(true); setErreur(null);
    try {
      await demanderRattachement(nom || email, code);
      setAttente(await monRattachement());
      setChoix('aucun');
    } catch (e) { setErreur((e as Error).message); }
    setEnvoi(false);
  }

  const cadre = {
    background: 'var(--surface)', border: '1px solid var(--filet)',
    padding: 20, width: 'min(480px, 94vw)',
  } as const;

  if (attente?.statut === 'en_attente') {
    return (
      <div className="connexion">
        <div style={cadre}>
          <div className="marque" style={{ marginBottom: 14 }}>Bat<em>inium</em></div>
          <h2 style={{ marginBottom: 8 }}>Demande envoyée</h2>
          <p>
            Votre demande pour rejoindre <strong>{attente.entreprise}</strong> attend d’être
            acceptée. Vous verrez l’application dès que la direction vous aura attribué un rôle.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="action discret" onClick={() => window.location.reload()}>Actualiser</button>
            <button className="action discret" onClick={() => void supabase.auth.signOut()}>Se déconnecter</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="connexion">
      <div style={cadre}>
        <div className="marque" style={{ marginBottom: 14 }}>Bat<em>inium</em></div>

        {attente?.statut === 'refuse' && (
          <div className="erreur">Votre demande a été refusée. Rapprochez-vous de la direction.</div>
        )}
        {erreur && <div className="erreur">{erreur}</div>}

        {choix === 'aucun' && (
          <>
            <h2 style={{ marginBottom: 6 }}>Bienvenue</h2>
            <p className="statut" style={{ marginBottom: 16 }}>
              Connecté avec {email}. Ce compte n’appartient encore à aucune entreprise.
            </p>
            <button className="action" style={{ width: '100%', marginBottom: 8 }}
                    onClick={() => setChoix('creer')}>
              Créer mon entreprise
            </button>
            <button className="action discret" style={{ width: '100%' }}
                    onClick={() => setChoix('rejoindre')}>
              Rejoindre une entreprise existante
            </button>
            <p className="statut" style={{ marginTop: 14 }}>
              Salariés et sous-traitants : demandez son code d’invitation à la direction.
            </p>
            <button className="action discret" style={{ width: '100%', marginTop: 14 }}
                    onClick={() => void supabase.auth.signOut()}>
              Se déconnecter
            </button>
          </>
        )}

        {choix === 'creer' && (
          <form onSubmit={(e) => { e.preventDefault(); void creer(); }} style={{ display: 'grid', gap: 12 }}>
            <h2>Créer mon entreprise</h2>
            <div>
              <label>Nom de l’entreprise</label>
              <input required value={nomEntreprise} onChange={(e) => setNomEntreprise(e.target.value)}
                     placeholder="Pilotech" />
            </div>
            <div>
              <label>Votre nom</label>
              <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Fabrice Gibier" />
            </div>
            <p className="statut">
              Vous serez direction : accès complet, y compris aux prix et aux marges.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="action" type="submit" disabled={envoi}>Créer</button>
              <button className="action discret" type="button" onClick={() => setChoix('aucun')}>Retour</button>
            </div>
          </form>
        )}

        {choix === 'rejoindre' && (
          <form onSubmit={(e) => { e.preventDefault(); void rejoindre(); }} style={{ display: 'grid', gap: 12 }}>
            <h2>Rejoindre une entreprise</h2>
            <div>
              <label>Votre nom</label>
              <input required value={nom} onChange={(e) => setNom(e.target.value)} />
            </div>
            <div>
              <label>Code d’invitation</label>
              <input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                     placeholder="A1B2C3" maxLength={6}
                     style={{ letterSpacing: '.2em', textTransform: 'uppercase' }} />
            </div>
            <p className="statut">
              La direction recevra votre demande et vous attribuera un rôle. Tant qu’elle ne
              l’a pas fait, vous ne voyez aucune donnée.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="action" type="submit" disabled={envoi}>Envoyer la demande</button>
              <button className="action discret" type="button" onClick={() => setChoix('aucun')}>Retour</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
