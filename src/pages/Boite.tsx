import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { derniersFils, SCOPES_GMAIL, type FilGmail } from '../lib/gmail';
import { jetonGoogle } from '../lib/session';
import { ajouterFil, enregistrerDemande, enregistrerTiers, listerTiers } from '../lib/db';
import { corpsComplet } from '../lib/gmail';
import { lireFormulaireAvecIA } from '../lib/formulaire';
import type { Tiers } from '../lib/types';

/**
 * La boîte mail, rattachée aux clients.
 * Un fil est rouge tant que le dernier message vient du client.
 * C'est la réponse à « à qui ai-je répondu ? » côté e-mail.
 */
export default function PageBoite() {
  const [fils, setFils] = useState<FilGmail[]>([]);
  const [clients, setClients] = useState<Tiers[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const [seulementARepondre, setSeulement] = useState(true);

  const recharger = useCallback(async () => {
    setCharge(false);
    try {
      const [f, c] = await Promise.all([derniersFils(30), listerTiers()]);
      setFils(f);
      setClients(c);
      setErreur(null);
    } catch (e) {
      setErreur((e as Error).message);
    }
    setCharge(true);
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  async function connecterGoogle() {
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

  if (!jetonGoogle() || erreur === 'NON_CONNECTE' || erreur === 'JETON_EXPIRE') {
    return (
      <>
        <div className="entete"><h1>Boîte mail</h1></div>
        <div className="vide">
          <p style={{ marginBottom: 12 }}>
            {erreur === 'JETON_EXPIRE'
              ? 'La session Google a expiré. Google limite l’accès à une heure.'
              : 'Connectez votre compte Google pour voir vos e-mails ici.'}
          </p>
          <button className="action" onClick={() => void connecterGoogle()}>Connecter Google</button>
          <p className="statut" style={{ marginTop: 12 }}>
            Batinium lit les e-mails depuis votre navigateur, avec votre propre compte.
            Aucun mot de passe n’est stocké et aucun message ne transite par un autre serveur.
          </p>
        </div>
      </>
    );
  }

  const parEmail = new Map(clients.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]));
  const visibles = seulementARepondre ? fils.filter((f) => f.aRepondre) : fils;
  const inconnus = fils.filter((f) => f.aRepondre && !parEmail.has(f.email)).length;

  /**
   * Crée le prospect et la demande depuis un message.
   *
   * Un e-mail de formulaire — Squarespace, Wix — arrive sous le nom du
   * prestataire et non sous celui du prospect. Créer la fiche depuis
   * l'expéditeur donnait un client nommé « Squarespace » avec l'adresse d'un
   * robot, et il fallait tout retaper en lisant le message.
   *
   * On va donc chercher le corps entier — l'extrait de la liste est tronqué
   * bien avant les coordonnées — et on y lit le vrai nom, le vrai e-mail et le
   * vrai téléphone. Une requête de plus, au moment où elle sert.
   */
  async function creerProspect(f: FilGmail) {
    try {
      const corps = await corpsComplet(f.messageId).catch(() => f.extrait);
      const lu = await lireFormulaireAvecIA({
        sujet: f.sujet, corps, expediteur: f.expediteur, adresse: f.email,
      });

      // On ne remplace l'expéditeur que si le message est bien un formulaire :
      // sur un vrai échange, le nom de la signature vaut moins que celui de
      // l'en-tête.
      const nom = lu.estFormulaire ? (lu.nom ?? f.expediteur) : f.expediteur;
      const email = lu.estFormulaire ? (lu.email ?? f.email) : f.email;

      const t = await enregistrerTiers({
        type: 'particulier', categorie: 'prospect', nom, email,
        telephone: lu.telephone ?? null,
      });
      await enregistrerDemande({
        source: 'email', source_ref: f.threadId, nom, email,
        telephone: lu.telephone ?? null,
        besoin: lu.message ?? f.sujet,
        resume: (lu.estFormulaire ? corps : f.extrait).slice(0, 2000),
        tiers_id: t.id, recu_le: f.date.toISOString(),
      });
      await ajouterFil({
        tiers_id: t.id, type: 'email_recu', sujet: f.sujet, contenu: corps.slice(0, 4000),
        source: 'gmail', source_ref: f.messageId, a_traiter: true, occurred_at: f.date.toISOString(),
      });
      setClients((c) => [...c, t]);
    } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <>
      <div className="entete">
        <h1>Boîte mail</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={seulementARepondre} style={{ width: 'auto' }}
                   onChange={(e) => setSeulement(e.target.checked)} />
            Sans réponse seulement
          </label>
          <button className="action discret" onClick={() => void recharger()}>Actualiser</button>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}
      {!charge && <p className="statut">Lecture de la boîte…</p>}

      {inconnus > 0 && (
        <p className="statut" style={{ marginBottom: 12 }}>
          {inconnus} message{inconnus > 1 ? 's' : ''} en attente vient d’une adresse inconnue.
          Créez le prospect pour le faire entrer dans le suivi.
        </p>
      )}

      {visibles.length === 0 && charge ? (
        <div className="vide">Aucun message en attente de réponse.</div>
      ) : (
        <table>
          <thead>
            <tr><th style={{ width: 90 }}>Reçu</th><th>Expéditeur</th><th>Objet</th><th style={{ width: 190 }}>Client</th><th /></tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const client = parEmail.get(f.email);
              return (
                <tr key={f.threadId} style={f.aRepondre ? { borderLeft: '3px solid var(--alerte)' } : undefined}>
                  <td className="num ref">
                    {f.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                  </td>
                  <td>{f.expediteur}<div className="ref">{f.email}</div></td>
                  <td>
                    <a href={f.lien} target="_blank" rel="noreferrer">{f.sujet}</a>
                    <div className="fiche">{f.extrait}</div>
                  </td>
                  <td>
                    {client
                      ? <a href={`#/clients/${client.id}`}>{client.nom}</a>
                      : <span className="statut">inconnu</span>}
                  </td>
                  <td className="sans-impression">
                    {!client && (
                      <button className="action discret" onClick={() => void creerProspect(f)}>
                        Créer le prospect
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
