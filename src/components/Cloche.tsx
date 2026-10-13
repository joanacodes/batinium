import { useCallback, useEffect, useRef, useState } from 'react';
import { calculerAlertes, masquerAlerte, type Alerte, type Gravite } from '../lib/alertes';
import { preavisEntretien, reglerPreavisEntretien } from '../lib/session';

/** Les préavis proposés, dits comme on les dit. Le réglage reste en jours. */
const PREAVIS: [number, string][] = [
  [3, '3 jours avant'], [7, '1 semaine avant'], [14, '2 semaines avant'],
  [30, '1 mois avant'], [60, '2 mois avant'], [90, '3 mois avant'],
];

/** Chaque gravité porte son mot : la couleur seule ne se lit pas. */
const MOT: Record<Gravite, string> = {
  urgent: 'urgent', attention: 'à surveiller', information: 'pour information',
};

/** La cloche : ce qui demande une action, trié par gravité. */
export default function Cloche() {
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [filtre, setFiltre] = useState<Gravite | null>(null);
  // Par gravité d'abord, c'est ce qu'on veut le matin. Par date quand on
  // cherche « qu'est-ce qui est arrivé depuis hier » — l'autre question,
  // aussi fréquente, et à laquelle un tri par gravité ne répond pas.
  const [ordre, setOrdre] = useState<'gravite' | 'date'>('gravite');
  const [preavis, setPreavis] = useState(preavisEntretien);
  const [erreurPreavis, setErreurPreavis] = useState<string | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const minuteur = useRef<number | undefined>(undefined);

  const recharger = useCallback(() => {
    calculerAlertes().then(setAlertes).catch(() => setAlertes([]));
  }, []);

  useEffect(() => {
    recharger();
    const t = window.setInterval(recharger, 120000);
    return () => window.clearInterval(t);
  }, [recharger]);

  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => {
      if (zone.current && !zone.current.contains(e.target as Node)) fermer();
    };
    const echap = (e: KeyboardEvent) => e.key === 'Escape' && fermer();
    document.addEventListener('mousedown', dehors);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('keydown', echap);
    };
  }, [ouvert]);

  useEffect(() => () => window.clearTimeout(minuteur.current), []);

  /** Fermer remet le filtre à zéro : on ne veut pas rouvrir sur une vue tronquée. */
  function fermer() {
    window.clearTimeout(minuteur.current);
    setOuvert(false);
    setFiltre(null);
  }

  // Sortir du volet le referme, après un court délai pour laisser le temps
  // de revenir si la souris déborde d'un pixel.
  function sortie() {
    setOrdre('gravite');
    window.clearTimeout(minuteur.current);
    minuteur.current = window.setTimeout(fermer, 400);
  }
  function retour() {
    window.clearTimeout(minuteur.current);
  }

  const urgentes = alertes.filter((a) => a.gravite === 'urgent').length;
  const parGravite = (g: Gravite) => alertes.filter((a) => a.gravite === g).length;
  const visibles = (filtre ? alertes.filter((a) => a.gravite === filtre) : alertes)
    .slice()
    .sort((x, y) => (ordre === 'date'
      // Du plus récent au plus ancien : une alerte de ce matin passe avant
      // une échéance dépassée depuis trois semaines.
      ? (y.date ?? '').localeCompare(x.date ?? '')
      : 0));

  async function changerPreavis(jours: number) {
    setErreurPreavis(null);
    const avant = preavis;
    setPreavis(jours);
    try {
      await reglerPreavisEntretien(jours);
      recharger();
    } catch (e) {
      setPreavis(avant);
      setErreurPreavis((e as Error).message);
    }
  }

  async function ecarter(cle: string) {
    setAlertes((p) => p.filter((a) => a.cle !== cle));
    try { await masquerAlerte(cle); } catch { recharger(); }
  }

  return (
    <div ref={zone} style={{ position: 'relative' }}
         onMouseLeave={ouvert ? sortie : undefined}
         onMouseEnter={retour}>
      <button className="cloche" onClick={() => (ouvert ? fermer() : setOuvert(true))}
              aria-label={`${alertes.length} alerte${alertes.length > 1 ? 's' : ''}`}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {alertes.length > 0 && (
          <span className="pastille" data-urgent={urgentes > 0 ? 'oui' : 'non'}>
            {alertes.length}
          </span>
        )}
      </button>

      {ouvert && (
        <div className="volet">
          <div className="volet-entete">
            <strong>Alertes</strong>
            <span className="statut">
              {alertes.length === 0 ? 'rien à signaler'
                : filtre ? `${visibles.length} sur ${alertes.length}`
                : `${alertes.length} en cours`}
            </span>
          </div>

          {alertes.length > 0 && (
            <div className="volet-legende">
              {(['urgent', 'attention', 'information'] as Gravite[]).map((g) => (
                parGravite(g) > 0 && (
                  <button key={g} className="legende-bouton"
                          data-actif={filtre === g ? 'oui' : 'non'}
                          title={filtre === g ? 'Tout afficher' : `N’afficher que « ${MOT[g]} »`}
                          onClick={() => setFiltre(filtre === g ? null : g)}>
                    <i className="pastille-gravite" data-gravite={g} />
                    {MOT[g]}
                    <span className="num"> {parGravite(g)}</span>
                  </button>
                )
              ))}
              <button className="legende-bouton" data-actif={!filtre ? 'oui' : 'non'}
                      title="Afficher toutes les alertes"
                      onClick={() => setFiltre(null)}>
                Tout
                <span className="num"> {alertes.length}</span>
              </button>

              <button className="legende-bouton" data-actif={ordre === 'date' ? 'oui' : 'non'}
                      title={ordre === 'date'
                        ? 'Revenir au classement par gravité'
                        : 'Classer de la plus récente à la plus ancienne'}
                      onClick={() => setOrdre(ordre === 'date' ? 'gravite' : 'date')}>
                {ordre === 'date' ? 'par gravité' : 'par date'}
              </button>
            </div>
          )}

          {visibles.length === 0 ? (
            <p className="statut" style={{ padding: 16 }}>
              {alertes.length === 0
                ? 'Tout est à jour. Les alertes réapparaîtront d’elles-mêmes.'
                : 'Rien à ce niveau de gravité.'}
            </p>
          ) : (
            <div style={{ maxHeight: '62vh', overflow: 'auto' }}>
              {visibles.map((a) => (
                <div key={a.cle} className="alerte" data-gravite={a.gravite}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="alerte-gravite" data-gravite={a.gravite}>{MOT[a.gravite]}</div>
                    {a.lien
                      ? <a href={a.lien} onClick={() => setOuvert(false)}>{a.titre}</a>
                      : <span>{a.titre}</span>}
                    {a.detail && <div className="fiche">{a.detail}</div>}
                    {a.date && (
                      <div className="statut" title={new Date(a.date).toLocaleString('fr-FR')}>
                        {quand(a.date)}
                      </div>
                    )}
                  </div>
                  <button className="action discret" style={{ padding: '1px 7px' }}
                          title="Écarter cette alerte" onClick={() => void ecarter(a.cle)}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Le préavis est propre à chacun : c'est la cloche de chacun qu'il règle. */}
          <div className="volet-pied">
            <label htmlFor="preavis-entretien">Me prévenir des entretiens</label>
            <select id="preavis-entretien" value={preavis}
                    onChange={(e) => void changerPreavis(Number(e.target.value))}>
              {!PREAVIS.some(([j]) => j === preavis) && (
                <option value={preavis}>{preavis} jours avant</option>
              )}
              {PREAVIS.map(([j, libelle]) => <option key={j} value={j}>{libelle}</option>)}
            </select>
            {erreurPreavis && <div className="statut" style={{ color: 'var(--alerte)' }}>{erreurPreavis}</div>}
          </div>
        </div>
      )}
    </div>
  );
}


/**
 * Date lisible : l'heure pour aujourd'hui, le jour pour cette semaine,
 * la date complète au-delà. Une alerte de ce matin et une d'il y a trois
 * semaines ne demandent pas la même précision.
 */
function quand(iso: string): string {
  const d = new Date(iso);
  const maintenant = new Date();
  const minutes = Math.round((maintenant.getTime() - d.getTime()) / 60000);

  // Une échéance à venir — un entretien, une expiration — d'abord : sans ce
  // test, toute date future passait pour « à l'instant », et un entretien
  // dû dans trois semaines se lisait comme un événement qui vient d'arriver.
  if (d.toDateString() !== maintenant.toDateString() && d > maintenant) {
    const dans = Math.ceil((d.getTime() - maintenant.getTime()) / 86400000);
    return dans <= 1 ? 'demain' : `dans ${dans} jours`;
  }
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;

  const memeJour = d.toDateString() === maintenant.toDateString();
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (memeJour) return `aujourd’hui à ${heure}`;

  const jours = Math.round((maintenant.getTime() - d.getTime()) / 86400000);
  if (jours === 1) return `hier à ${heure}`;
  if (jours > 1 && jours < 7) {
    return `${d.toLocaleDateString('fr-FR', { weekday: 'long' })} à ${heure}`;
  }
  return `${d.toLocaleDateString('fr-FR')} à ${heure}`;
}
