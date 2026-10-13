import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { SCOPES_GMAIL } from '../lib/gmail';

/**
 * Connexion et inscription.
 *
 * L'inscription crée seulement le compte. Le rattachement à une entreprise
 * se fait à l'écran suivant : soit on crée l'entreprise, soit on demande à
 * la rejoindre avec son code. Personne n'entre sans validation de la direction.
 */
export default function Connexion() {
  const [mode, setMode] = useState<'connexion' | 'inscription' | 'oubli'>('connexion');
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre() {
    setEnvoi(true);
    setErreur(null);
    setMessage(null);

    if (mode === 'oubli') {
      // On répond la même chose que l'adresse existe ou non. Dire « ce compte
      // n'existe pas » permettrait à n'importe qui de tester des adresses pour
      // savoir qui travaille ici.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) setErreur(traduire(error.message));
      else {
        setMessage(
          'Si un compte existe avec cette adresse, un lien de réinitialisation vient d’y être '
          + 'envoyé. Il est valable une heure. Pensez aux indésirables.',
        );
      }
      setEnvoi(false);
      return;
    }

    if (mode === 'connexion') {
      const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
      if (error) setErreur(traduire(error.message));
    } else {
      if (motDePasse.length < 8) {
        setErreur('Le mot de passe doit faire au moins huit caractères.');
        setEnvoi(false);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password: motDePasse,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) setErreur(traduire(error.message));
      else if (!data.session) {
        setMessage(
          'Compte créé. Ouvrez le lien de confirmation reçu par e-mail, puis revenez vous connecter.',
        );
      }
    }
    setEnvoi(false);
  }

  async function parGoogle() {
    setErreur(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: SCOPES_GMAIL,
        queryParams: { access_type: 'offline', prompt: 'consent' },
        redirectTo: window.location.origin,
      },
    });
    if (error) setErreur(error.message);
  }

  return (
    <div className="connexion">
      <form onSubmit={(e) => { e.preventDefault(); void soumettre(); }}>
        <div className="marque">Bat<em>inium</em></div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--filet)' }}
             hidden={mode === 'oubli'}>
          {(['connexion', 'inscription'] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setErreur(null); setMessage(null); }}
              style={{
                flex: 1, font: 'inherit', padding: '8px 0', cursor: 'pointer',
                background: 'none', border: 0,
                borderBottom: `2px solid ${mode === m ? 'var(--bleu)' : 'transparent'}`,
                color: mode === m ? 'var(--encre)' : 'var(--encre-pale)',
                marginBottom: -1,
              }}>
              {m === 'connexion' ? 'Se connecter' : 'Créer un compte'}
            </button>
          ))}
        </div>

        {mode === 'oubli' && (
          <p className="statut">
            Indiquez l’adresse du compte. Vous recevrez un lien pour choisir un nouveau
            mot de passe.
          </p>
        )}

        {erreur && <div className="erreur">{erreur}</div>}
        {message && (
          <div className="erreur" style={{ borderColor: 'var(--vert)', color: 'var(--vert)', background: '#f1f7f3' }}>
            {message}
          </div>
        )}

        <div>
          <label htmlFor="email">Adresse e-mail</label>
          <input id="email" type="email" autoComplete="username" required
                 value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode !== 'oubli' && (
          <div>
            <label htmlFor="mdp">Mot de passe</label>
            <input id="mdp" type="password" required
                   autoComplete={mode === 'connexion' ? 'current-password' : 'new-password'}
                   value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} />
            {mode === 'inscription' && <p className="statut">Huit caractères au minimum.</p>}
          </div>
        )}

        <button className="action" type="submit" disabled={envoi}>
          {envoi ? '…'
            : mode === 'connexion' ? 'Se connecter'
            : mode === 'inscription' ? 'Créer mon compte'
            : 'Envoyer le lien'}
        </button>

        {mode === 'connexion' && (
          <button type="button" className="lien-discret" style={{ alignSelf: 'start' }}
                  onClick={() => { setMode('oubli'); setErreur(null); setMessage(null); }}>
            Mot de passe oublié ?
          </button>
        )}

        {mode === 'oubli' && (
          <button type="button" className="lien-discret" style={{ alignSelf: 'start' }}
                  onClick={() => { setMode('connexion'); setErreur(null); setMessage(null); }}>
            Revenir à la connexion
          </button>
        )}

        <div style={{ borderTop: '1px solid var(--filet)', paddingTop: 16 }}
             hidden={mode === 'oubli'}>
          <button type="button" className="action discret" style={{ width: '100%' }}
                  onClick={() => void parGoogle()}>
            Continuer avec Google
          </button>
          <p className="statut" style={{ marginTop: 8 }}>
            Passez par Google pour que la boîte mail apparaisse dans l’application.
            Avec le mot de passe, tout le reste fonctionne, mais pas les e-mails.
          </p>
        </div>
      </form>
    </div>
  );
}

/**
 * Choisir un nouveau mot de passe, après avoir suivi le lien reçu.
 *
 * À ce moment Supabase a déjà ouvert une session de récupération : c'est ce
 * qui permet de changer le mot de passe sans redemander l'ancien, et c'est
 * aussi pourquoi cet écran doit passer devant l'application. Sans lui, on
 * arriverait directement dans Batinium, connecté, sans jamais avoir choisi le
 * mot de passe qu'on venait justement changer.
 */
export function NouveauMotDePasse({ onTermine }: { onTermine: () => void }) {
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function enregistrer() {
    if (motDePasse.length < 8) {
      return setErreur('Le mot de passe doit faire au moins huit caractères.');
    }
    if (motDePasse !== confirmation) {
      return setErreur('Les deux saisies ne correspondent pas.');
    }
    setEnvoi(true); setErreur(null);
    const { error } = await supabase.auth.updateUser({ password: motDePasse });
    if (error) setErreur(traduire(error.message));
    else onTermine();
    setEnvoi(false);
  }

  return (
    <div className="connexion">
      <form onSubmit={(e) => { e.preventDefault(); void enregistrer(); }}>
        <div className="marque">Bat<em>inium</em></div>
        <h2 style={{ marginBottom: 4 }}>Nouveau mot de passe</h2>
        <p className="statut">
          Le lien a été reconnu. Choisissez votre mot de passe : vous serez connecté
          dans la foulée.
        </p>

        {erreur && <div className="erreur">{erreur}</div>}

        <div>
          <label htmlFor="mdp1">Mot de passe</label>
          <input id="mdp1" type="password" autoComplete="new-password" required
                 value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} />
          <p className="statut">Huit caractères au minimum.</p>
        </div>
        <div>
          <label htmlFor="mdp2">Le même, pour vérifier</label>
          <input id="mdp2" type="password" autoComplete="new-password" required
                 value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </div>

        <button className="action" type="submit" disabled={envoi}>
          {envoi ? '…' : 'Enregistrer et entrer'}
        </button>
      </form>
    </div>
  );
}

/** Les messages de Supabase sont en anglais : les plus fréquents sont traduits. */
function traduire(m: string): string {
  const t: Record<string, string> = {
    'Invalid login credentials': 'Adresse e-mail ou mot de passe incorrect.',
    'User already registered': 'Un compte existe déjà avec cette adresse. Connectez-vous.',
    'Email not confirmed': 'Adresse non confirmée. Ouvrez le lien reçu par e-mail.',
    'Signups not allowed for this instance':
      'Les inscriptions sont désactivées. Activez-les dans Supabase, Authentication → Sign In / Providers.',
    'New password should be different from the old password.':
      'Le nouveau mot de passe doit être différent de l’ancien.',
    'Auth session missing!':
      'Le lien a expiré ou a déjà servi. Redemandez-en un depuis « Mot de passe oublié ».',
    'For security purposes, you can only request this after 60 seconds.':
      'Un lien vient d’être envoyé. Attendez une minute avant d’en redemander un.',
  };
  return t[m] ?? m;
}
