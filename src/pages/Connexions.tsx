import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { estDirection, jetonGoogle, oublierJetonGoogle } from '../lib/session';
import { SCOPES_GMAIL, derniersFils } from '../lib/gmail';
import { evenements } from '../lib/gcal';
import { diagnosticAllo, diagnosticIA } from '../lib/ia';
import {
  activerConnecteur, desactiverConnecteur, listerConnecteurs, poserSecret, renouvelerJeton,
  consommationIA, installerChezAllo, secretPose, testerWebhook, urlWebhook,
  type ConsommationIA, type Connecteur, type ResultatTest,
} from '../lib/connecteurs';
import Modale from '../components/Modale';

/**
 * Les connecteurs.
 *
 * Une carte par service, un état visible, un bouton. Ce qu'il y avait avant
 * était un journal de bord pour développeur : des commandes à recopier dans un
 * terminal et des états déduits de la présence de données. Ce n'est pas un
 * écran, c'est une documentation déguisée.
 *
 * Ce qui rend cette page possible, c'est le SQL 30 : les jetons et les clés
 * descendent en base au lieu de vivre dans les variables de la fonction
 * serveur, réglables au seul terminal. Reste une chose qu'aucun écran ne peut
 * faire à votre place — déployer du code. Deux commandes, une fois.
 */

type Etat = 'inconnu' | 'actif' | 'partiel' | 'inactif' | 'erreur';

interface Service {
  cle: string;
  nom: string;
  quoi: string;
  couleur: string;
  glyphe: ReactNode;
  etat: Etat;
  detail: string;
  ouvrir?: () => void;
  bientot?: boolean;
}

export default function PageConnexions() {
  const [gmail, setGmail] = useState<Etat>('inconnu');
  const [detail, setDetail] = useState<Record<string, string>>({});
  const [ia, setIa] = useState<Etat>('inconnu');
  const [allo, setAllo] = useState<Etat>('inconnu');
  const [connecteurs, setConnecteurs] = useState<Connecteur[]>([]);
  const [cleIA, setCleIA] = useState(false);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const direction = estDirection();

  const recharger = useCallback(async () => {
    // Chaque service est interrogé pour de vrai. On ne déduit jamais un état
    // d'installation de la présence de données : des demandes peuvent venir
    // d'une démonstration, d'un import ou d'une saisie à la main.
    const [c, k, dIA, dAllo] = await Promise.all([
      listerConnecteurs().catch(() => []),
      secretPose('anthropic'),
      diagnosticIA(),
      diagnosticAllo(),
    ]);
    setConnecteurs(c);
    setCleIA(k);

    setIa(!dIA.deployee ? 'inactif' : dIA.cle || k ? 'actif' : 'partiel');
    setDetail((x) => ({
      ...x,
      ia: !dIA.deployee
        ? 'La fonction serveur n’est pas encore installée.'
        : dIA.cle || k
          ? `Prête. Modèle ${dIA.modele ?? '—'}.`
          : 'Installée, mais il manque votre clé d’API.',
    }));

    const allocon = c.find((x) => x.cle === 'allo');
    setAllo(!dAllo.deployee ? 'inactif'
      : allocon?.actif && allocon.vu_le ? 'actif'
      : allocon?.actif ? 'partiel' : 'partiel');
    setDetail((x) => ({
      ...x,
      allo: !dAllo.deployee
        ? 'La fonction serveur n’est pas encore installée.'
        : allocon?.vu_le
          ? `Dernier appel reçu le ${new Date(allocon.vu_le).toLocaleString('fr-FR')}.`
          : allocon?.actif
            ? 'Adresse prête. En attente du premier appel.'
            : 'Installée. Il reste à générer l’adresse à donner à Allô.',
    }));
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  useEffect(() => {
    if (!jetonGoogle()) { setGmail('inactif'); return; }
    Promise.all([
      derniersFils(1).catch(() => null),
      evenements(new Date(), new Date(Date.now() + 7 * 86400000)).catch(() => null),
    ]).then(([f, e]) => {
      setGmail(f && e ? 'actif' : f || e ? 'partiel' : 'erreur');
      setDetail((x) => ({
        ...x,
        google: f && e
          ? `Boîte et agenda lus. ${e.length} événement(s) cette semaine.`
          : 'Connexion expirée. Reconnectez-vous, le jeton ne dure qu’une heure.',
      }));
    });
  }, []);

  async function connecterGoogle() {
    oublierJetonGoogle();
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

  const services: Service[] = [
    {
      cle: 'allo', nom: 'Allô', quoi: 'Standard téléphonique',
      couleur: '#1f7a4d', glyphe: <Telephone />,
      etat: allo, detail: detail.allo ?? '…',
      ouvrir: () => setOuvert('allo'),
    },
    {
      cle: 'ia', nom: 'Assistant IA', quoi: 'Dictée, lecture de tarifs, assistant',
      couleur: '#8a5cd6', glyphe: <Etincelle />,
      etat: ia, detail: detail.ia ?? '…',
      ouvrir: () => setOuvert('ia'),
    },
    {
      cle: 'google', nom: 'Google', quoi: 'Boîte mail et agenda',
      couleur: '#c5442f', glyphe: <Enveloppe />,
      etat: gmail, detail: detail.google ?? 'Pas encore connecté.',
      ouvrir: () => setOuvert('google'),
    },
    {
      cle: 'pennylane', nom: 'Pennylane', quoi: 'Comptabilité',
      couleur: '#2d6ca8', glyphe: <Livre />,
      etat: 'inactif', detail: 'Prévu. Envoi des factures au comptable.',
      bientot: true,
    },
    {
      cle: 'dropbox', nom: 'Dropbox', quoi: 'Documents par chantier',
      couleur: '#1a6fd4', glyphe: <Boite />,
      etat: 'inactif', detail: 'Prévu. Les fichiers sont déjà stockés dans Batinium.',
      bientot: true,
    },
  ];

  return (
    <>
      <div className="entete">
        <h1>Connexions</h1>
        <button className="action discret" onClick={() => void recharger()}>Actualiser</button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {!direction && (
        <div className="panneau" style={{ display: 'block' }}>
          <p className="statut">
            Le branchement des services extérieurs relève de la direction. Vous voyez
            l’état, vous ne pouvez pas le modifier.
          </p>
        </div>
      )}

      <div className="grille-services">
        {services.map((s) => (
          <Carte key={s.cle} service={s} direction={direction} />
        ))}
      </div>

      {ouvert === 'allo' && (
        <Modale titre="Allô — standard téléphonique" taille="large"
                onFermer={() => { setOuvert(null); void recharger(); }}>
          <ReglageAllo connecteur={connecteurs.find((c) => c.cle === 'allo')}
                       deployee={allo !== 'inactif'} onErreur={setErreur}
                       onChange={recharger} />
        </Modale>
      )}

      {ouvert === 'ia' && (
        <Modale titre="Assistant IA" taille="large"
                onFermer={() => { setOuvert(null); void recharger(); }}>
          <ReglageIA posee={cleIA} deployee={ia !== 'inactif'} onErreur={setErreur}
                     onChange={recharger} />
        </Modale>
      )}

      {ouvert === 'google' && (
        <Modale titre="Google — boîte mail et agenda" onFermer={() => setOuvert(null)}>
          <p style={{ marginBottom: 12 }}>
            Batinium lit vos e-mails et votre agenda depuis votre navigateur, avec votre
            propre compte. Aucun mot de passe n’est enregistré, aucun message ne transite
            par un autre serveur.
          </p>
          <p className="statut" style={{ marginBottom: 14 }}>
            L’autorisation Google dure une heure. Quand la boîte cesse de se mettre à
            jour, il faut repasser par ce bouton. Ce n’est pas une panne.
          </p>
          <button className="action" onClick={() => void connecterGoogle()}>
            {gmail === 'actif' ? 'Reconnecter Google' : 'Connecter Google'}
          </button>
        </Modale>
      )}
    </>
  );
}

// --- Allô -------------------------------------------------------------------

function ReglageAllo({ connecteur, deployee, onErreur, onChange }: {
  connecteur?: Connecteur;
  deployee: boolean;
  onErreur: (m: string) => void;
  onChange: () => void;
}) {
  const [travail, setTravail] = useState(false);
  const [copie, setCopie] = useState(false);
  const [test, setTest] = useState<ResultatTest | null>(null);
  const [forme, setForme] = useState<'parametre' | 'chemin'>('parametre');
  const [cleApi, setCleApi] = useState('');
  const [installation, setInstallation] = useState<ResultatTest | null>(null);
  const url = connecteur?.jeton
    ? urlWebhook('allo-webhook', connecteur.jeton, forme) : null;

  async function installer() {
    if (!connecteur?.jeton) return;
    setTravail(true); setInstallation(null);
    setInstallation(await installerChezAllo(cleApi.trim(), connecteur.jeton, forme));
    setCleApi('');
    setTravail(false);
    onChange();
  }

  async function tester() {
    if (!connecteur?.jeton) return;
    setTravail(true); setTest(null);
    setTest(await testerWebhook('allo-webhook', connecteur.jeton, forme));
    setTravail(false);
    onChange();
  }

  async function activer() {
    setTravail(true);
    try { await activerConnecteur('allo'); onChange(); }
    catch (e) { onErreur((e as Error).message); }
    setTravail(false);
  }

  async function copier() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopie(true);
      setTimeout(() => setCopie(false), 2500);
    } catch { onErreur('Copie refusée par le navigateur. Sélectionnez l’adresse à la main.'); }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {!deployee && (
        <div className="panneau" style={{ display: 'block', margin: 0,
                                          borderLeft: '3px solid var(--alerte)' }}>
          <strong>Une étape technique, une seule fois.</strong>
          <p className="statut">
            Déployer du code est la seule chose qu’aucun écran ne peut faire à votre
            place. Ouvrez un terminal dans le dossier du projet et collez ceci — après
            quoi tout le reste se règle ici :
          </p>
          <pre className="bloc-code">{`npx supabase login
npx supabase link --project-ref sryazbmnhgbtfjvyakgd
npx supabase functions deploy allo-webhook --no-verify-jwt`}</pre>
          <p className="statut">
            Puis revenez sur cette page et cliquez « Actualiser ».
          </p>
        </div>
      )}

      <div>
        <h3 style={{ marginBottom: 6 }}>1. Votre adresse de réception</h3>
        {url ? (
          <>
            <p className="statut" style={{ marginBottom: 8 }}>
              C’est l’adresse à donner à Allô. Elle contient votre jeton : traitez-la
              comme un mot de passe.
            </p>

            {/* Deux formes, parce que beaucoup de plateformes refusent un
                paramètre dans une URL de webhook et répondent « échec de la
                création » sans dire pourquoi. Les deux mènent au même endroit
                et fonctionnent en même temps. */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <button className={`action ${forme === 'parametre' ? '' : 'discret'}`}
                      style={{ fontSize: 13 }} onClick={() => setForme('parametre')}>
                Forme courante
              </button>
              <button className={`action ${forme === 'chemin' ? '' : 'discret'}`}
                      style={{ fontSize: 13 }} onClick={() => setForme('chemin')}>
                Sans paramètre
              </button>
              <span className="statut" style={{ alignSelf: 'center' }}>
                {forme === 'parametre'
                  ? 'Si Allô refuse cette adresse, essayez l’autre.'
                  : 'À utiliser quand la plateforme refuse les adresses contenant « ? ».'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()}
                     style={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
              <button className="action" onClick={() => void copier()}>
                {copie ? 'Copié' : 'Copier'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="statut" style={{ marginBottom: 8 }}>
              Batinium va fabriquer une adresse unique pour votre entreprise.
            </p>
            <button className="action" disabled={travail || !deployee}
                    onClick={() => void activer()}>
              {travail ? '…' : 'Générer mon adresse'}
            </button>
          </>
        )}
      </div>

      {url && (
        <>
          <div>
            <h3 style={{ marginBottom: 6 }}>2. Déclarer l’adresse chez Allô</h3>
            <p className="statut" style={{ marginBottom: 8 }}>
              Batinium peut le faire à votre place, par l’API d’Allô, au lieu de vous
              faire remplir leur formulaire. Rien à payer : « déclarer » veut simplement
              dire « demander à Allô de nous prévenir quand un appel se termine ».
            </p>
            <p className="statut" style={{ marginBottom: 8 }}>
              Il faut une clé d’API. Dans Allô : <strong>Réglages → API</strong> —{' '}
              <a href="https://web.withallo.com/settings/api" target="_blank" rel="noopener">
                web.withallo.com/settings/api
              </a>{' '}
              — puis <strong>Create API Key</strong>, en cochant le droit{' '}
              <code>WEBHOOKS_READ_WRITE</code>. Elle commence par <code>ak_live_</code> et
              ne s’affiche qu’une fois.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="password" value={cleApi} placeholder="Clé d’API Allô"
                     autoComplete="off" style={{ flex: 1 }}
                     onChange={(e) => setCleApi(e.target.value)} />
              <button className="action" disabled={travail || !cleApi.trim()}
                      onClick={() => void installer()}>
                {travail ? '…' : 'Déclarer l’adresse'}
              </button>
            </div>
            <p className="statut" style={{ marginTop: 6 }}>
              Cette clé n’est pas enregistrée : elle part une fois vers Allô, puis elle
              est oubliée. Batinium ne demande à être prévenu que de deux choses — la fin
              d’un appel et un SMS reçu.
            </p>

            {installation && (
              <div style={{ marginTop: 10, padding: 10,
                            background: installation.ok ? 'var(--bleu-pale)' : '#fdf3f2',
                            borderLeft: `3px solid ${installation.ok ? 'var(--vert)' : 'var(--alerte)'}` }}>
                <strong>{installation.titre}</strong>
                <p className="statut" style={{ margin: '4px 0 0' }}>{installation.quoiFaire}</p>
              </div>
            )}

            <p className="statut" style={{ marginTop: 10 }}>
              À la main, si vous préférez : dans l’application mobile Allô,{' '}
              <strong>Réglages → Intégrations → Webhooks</strong>. Il faut{' '}
              <strong>activer l’interrupteur en premier</strong> — c’est l’oubli le plus
              fréquent — puis coller l’adresse et cocher <code>call.completed</code>.
              Depuis un ordinateur, la même page se trouve sur{' '}
              <a href="https://web.withallo.com/settings/webhooks" target="_blank"
                 rel="noopener">web.withallo.com/settings/webhooks</a>.
            </p>
          </div>

          <div>
            <h3 style={{ marginBottom: 6 }}>3. Vérifier</h3>
            <p className="statut" style={{ marginBottom: 8 }}>
              Ce bouton appelle votre adresse exactement comme le ferait Allô. Aucune
              demande n’est créée : il vérifie seulement que l’adresse répond et que le
              jeton est reconnu.
            </p>
            <button className="action" disabled={travail} onClick={() => void tester()}>
              {travail ? 'Test en cours…' : 'Tester la connexion'}
            </button>

            {test && (
              <div style={{ marginTop: 10, padding: 10,
                            background: test.ok ? 'var(--bleu-pale)' : '#fdf3f2',
                            borderLeft: `3px solid ${test.ok ? 'var(--vert)' : 'var(--alerte)'}` }}>
                <strong>{test.titre}</strong>
                <p className="statut" style={{ margin: '4px 0 0' }}>{test.quoiFaire}</p>
              </div>
            )}

            <p className="statut" style={{ marginTop: 10 }}>
              Une fois le test au vert, passez un vrai appel : la ligne ci-dessous
              affichera sa date.
            </p>
            {connecteur?.vu_le ? (
              <p style={{ color: 'var(--vert)' }}>
                Dernier appel reçu le{' '}
                {new Date(connecteur.vu_le).toLocaleString('fr-FR')}. Tout fonctionne.
              </p>
            ) : (
              <p className="statut">Aucun appel reçu pour l’instant.</p>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--filet)', paddingTop: 12 }}>
            <p className="statut" style={{ marginBottom: 8 }}>
              Si cette adresse a circulé par courriel ou dans une capture d’écran,
              remplacez-la. L’ancienne cessera aussitôt de fonctionner, et il faudra
              recoller la nouvelle chez Allô.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="action discret" disabled={travail}
                      onClick={() => {
                        if (window.confirm(
                          'Remplacer l’adresse ? L’ancienne cessera immédiatement de fonctionner, '
                          + 'et Allô n’enverra plus rien tant que la nouvelle n’est pas collée.')) {
                          setTravail(true);
                          void renouvelerJeton('allo').then(onChange)
                            .catch((e) => onErreur((e as Error).message))
                            .finally(() => setTravail(false));
                        }
                      }}>
                Remplacer l’adresse
              </button>
              <button className="action discret" disabled={travail}
                      onClick={() => void desactiverConnecteur('allo').then(onChange)}>
                Désactiver
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// --- Assistant IA -----------------------------------------------------------

function ReglageIA({ posee, deployee, onErreur, onChange }: {
  posee: boolean;
  deployee: boolean;
  onErreur: (m: string) => void;
  onChange: () => void;
}) {
  const [cle, setCle] = useState('');
  const [travail, setTravail] = useState(false);
  const [fait, setFait] = useState(false);
  const [propreCle, setPropreCle] = useState(false);
  const [usage, setUsage] = useState<ConsommationIA | null>(null);

  useEffect(() => { void consommationIA().then(setUsage); }, [fait]);

  const part = usage && usage.quota > 0
    ? Math.min(100, Math.round((usage.jetons / usage.quota) * 100)) : 0;

  async function enregistrer() {
    if (!cle.trim()) return onErreur('Collez votre clé.');
    setTravail(true);
    try {
      await poserSecret('anthropic', cle.trim());
      setCle(''); setFait(true); onChange();
    } catch (e) { onErreur((e as Error).message); }
    setTravail(false);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {!deployee && (
        <div className="panneau" style={{ display: 'block', margin: 0,
                                          borderLeft: '3px solid var(--alerte)' }}>
          <strong>Une étape technique, une seule fois.</strong>
          <p className="statut">
            Ouvrez un terminal dans le dossier du projet et collez ceci, ligne par
            ligne. La dernière pose la clé qui servira à <strong>toutes</strong> les
            entreprises — chacune reste plafonnée séparément.
          </p>
          <pre className="bloc-code">{`npx supabase login
npx supabase link --project-ref sryazbmnhgbtfjvyakgd
npx supabase functions deploy ia
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`}</pre>
          <p className="statut">Puis revenez ici et cliquez « Actualiser ».</p>
        </div>
      )}

      <div>
        <h3 style={{ marginBottom: 6 }}>Votre consommation du mois</h3>
        {usage ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between',
                          marginBottom: 4 }}>
              <span className="statut">
                {usage.appels} demande(s) à l’assistant, {usage.jetons.toLocaleString('fr-FR')} jetons
              </span>
              <span className="num statut">
                {usage.quota < 0 ? 'sans limite' : `${part} %`}
              </span>
            </div>
            {usage.quota >= 0 && (
              <div className="jauge" data-alerte={part > 85 ? 'oui' : 'non'}>
                <i style={{ width: `${part}%` }} />
              </div>
            )}
            <p className="statut" style={{ marginTop: 8 }}>
              {usage.quota < 0
                ? 'Aucun plafond sur ce compte.'
                : part > 85
                  ? 'Le plafond approche. L’assistant s’arrêtera jusqu’au 1er du mois '
                    + 'prochain, le reste de Batinium continuera normalement.'
                  : `Plafond mensuel de ${usage.quota.toLocaleString('fr-FR')} jetons, `
                    + 'remis à zéro le 1er de chaque mois.'}
            </p>
          </>
        ) : (
          <p className="statut">Chiffres indisponibles pour l’instant.</p>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--filet)', paddingTop: 12 }}>
        {!propreCle ? (
          <>
            <h3 style={{ marginBottom: 6 }}>La clé</h3>
            <p className="statut">
              {posee
                ? 'Cette entreprise utilise sa propre clé d’API.'
                : 'L’assistant fonctionne avec la clé fournie avec Batinium. Vous n’avez '
                  + 'rien à faire.'}
            </p>
            <button className="lien-discret" style={{ marginTop: 6 }}
                    onClick={() => setPropreCle(true)}>
              {posee ? 'Remplacer la clé' : 'Utiliser plutôt ma propre clé'}
            </button>
          </>
        ) : (
          <>
            <h3 style={{ marginBottom: 6 }}>Votre propre clé d’API</h3>
            <p className="statut" style={{ marginBottom: 10 }}>
              À n’utiliser que si vous voulez être facturée directement par le
              fournisseur du modèle. Elle s’obtient sur{' '}
              <code>console.anthropic.com</code>, rubrique API keys. Le plafond
              ci-dessus ne s’applique alors plus.
            </p>
            {fait && (
              <p style={{ color: 'var(--vert)', marginBottom: 10 }}>Clé enregistrée.</p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="password" value={cle} placeholder="sk-ant-…" style={{ flex: 1 }}
                     autoComplete="off" onChange={(e) => setCle(e.target.value)} />
              <button className="action" disabled={travail || !cle.trim()}
                      onClick={() => void enregistrer()}>
                {travail ? '…' : 'Enregistrer'}
              </button>
              <button className="action discret" onClick={() => setPropreCle(false)}>
                Annuler
              </button>
            </div>
            <p className="statut" style={{ marginTop: 10 }}>
              Elle est stockée hors de portée du navigateur : la table qui la porte n’a
              aucune règle de lecture, personne ne peut la ressortir, pas même vous.
              Une clé qu’on peut réafficher finit dans une capture d’écran.
            </p>
          </>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--filet)', paddingTop: 12 }}>
        <h3 style={{ marginBottom: 6 }}>Ce que l’assistant s’interdit</h3>
        <ul className="statut" style={{ paddingLeft: 18 }}>
          <li>Il ne voit que ce que <em>vous</em> avez le droit de voir.</li>
          <li>Il ne modifie rien, sauf une note et un brouillon de devis.</li>
          <li>Il n’envoie jamais un devis, ne signe rien, ne facture rien.</li>
          <li>Chaque appel est tracé avec son coût, et le contenu s’efface au bout de trente jours.</li>
        </ul>
      </div>
    </div>
  );
}

// --- Présentation -----------------------------------------------------------

const MOTS: Record<Etat, string> = {
  actif: 'connecté', partiel: 'à finir', inactif: 'non connecté',
  erreur: 'à corriger', inconnu: '…',
};

const COULEURS: Record<Etat, string> = {
  actif: 'var(--vert)', partiel: '#b8860b', inactif: 'var(--encre-pale)',
  erreur: 'var(--alerte)', inconnu: 'var(--encre-pale)',
};

function Carte({ service, direction }: { service: Service; direction: boolean }) {
  return (
    <div className="service">
      <div className="service-logo" style={{ background: service.couleur }}>
        {service.glyphe}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 15 }}>{service.nom}</strong>
          <span className="jeton" style={{
            color: COULEURS[service.etat], borderColor: COULEURS[service.etat],
          }}>{service.bientot ? 'bientôt' : MOTS[service.etat]}</span>
        </div>
        <div className="statut">{service.quoi}</div>
        <div className="statut" style={{ marginTop: 6 }}>{service.detail}</div>
      </div>
      {service.ouvrir && direction && !service.bientot && (
        <button className="action discret" onClick={service.ouvrir}>
          {service.etat === 'actif' ? 'Régler' : 'Connecter'}
        </button>
      )}
    </div>
  );
}

function Telephone() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}

function Etincelle() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l2.2 6.1L20 10l-5.8 1.9L12 18l-2.2-6.1L4 10l5.8-1.9zM19 3v3M20.5 4.5h-3" />
    </svg>
  );
}

function Enveloppe() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18v12H3zM3 7l9 6 9-6" />
    </svg>
  );
}

function Livre() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h9a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-1a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h2z" />
    </svg>
  );
}

function Boite() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l6 3.8-6 3.8-6-3.8zM12 13.4l6 3.8-6 3.8-6-3.8z" />
    </svg>
  );
}
