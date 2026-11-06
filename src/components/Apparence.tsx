import { useEffect, useState } from 'react';
import Icone from './Icone';
import {
  THEMES, TONS, apparenceInstallee, choisirTheme, choisirTon, surChangement, themeActuel,
  tonActuel, tonEffectif, type Theme, type Ton,
} from '../lib/apparence';
import { entrepriseId, estDirection } from '../lib/session';

/** Se redessine quand le thème ou le ton change, d'où qu'en vienne l'ordre. */
function useApparence() {
  const [, setTic] = useState(0);
  useEffect(() => surChangement(() => setTic((t) => t + 1)), []);
  return { theme: themeActuel(), ton: tonActuel() };
}

const ICONE_TON: Record<Ton, string> = { auto: 'auto', clair: 'soleil', sombre: 'lune' };

/**
 * Clair, sombre ou celui du téléphone, pour soi.
 *
 * Dans le pied du rail, à la portée de tous : un technicien n'ouvre jamais la
 * page Entreprise, et c'est lui qui travaille au soleil comme dans une cave.
 * Replié, le rail n'a la place que d'une icône : elle passe au mode suivant.
 */
export function ChoixTon({ compact = false, etiquettes = true, onErreur }: {
  compact?: boolean;
  etiquettes?: boolean;
  onErreur?: (message: string | null) => void;
}) {
  const { ton } = useApparence();

  function changer(t: Ton) {
    onErreur?.(null);
    choisirTon(t).catch((e) => onErreur?.((e as Error).message));
  }

  if (compact) {
    const suivant: Ton = ton === 'auto' ? 'clair' : ton === 'clair' ? 'sombre' : 'auto';
    const nom = (TONS.find((x) => x.cle === ton)?.nom ?? '').toLowerCase();
    return (
      <button className="ton-replie" onClick={() => changer(suivant)}
              title={`Mode ${nom}`} aria-label={`Mode ${nom} : passer au suivant`}>
        <Icone nom={ICONE_TON[ton]} />
      </button>
    );
  }

  return (
    <div className="segments" role="group" aria-label="Mode d’affichage">
      {TONS.map((t) => (
        <button key={t.cle} aria-pressed={ton === t.cle} onClick={() => changer(t.cle)}
                title={t.nom} aria-label={etiquettes ? undefined : t.nom}>
          <Icone nom={ICONE_TON[t.cle]} taille={15} />
          {etiquettes && <span>{t.cle === 'auto' ? 'Auto' : t.nom}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * La section Apparence de la page Entreprise.
 *
 * Le thème vaut pour toute l'équipe et seule la direction le choisit : c'est
 * l'image de l'entreprise sur chaque téléphone. Chaque aperçu porte son propre
 * data-theme et se dessine avec les vrais jetons de ce thème (src/index.css),
 * pas avec une copie de ses couleurs.
 */
export default function Apparence() {
  const { theme } = useApparence();
  const [installee, setInstallee] = useState<boolean | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const direction = estDirection();
  const ton = tonEffectif();

  useEffect(() => {
    apparenceInstallee(entrepriseId())
      .then(setInstallee)
      .catch((e) => setErreur((e as Error).message));
  }, []);

  function choisir(t: Theme) {
    setErreur(null);
    setMessage(null);
    choisirTheme(t)
      .then(() => setMessage(`« ${THEMES.find((x) => x.cle === t)?.nom} » s’applique à toute l’équipe.`))
      .catch((e) => setErreur((e as Error).message));
  }

  return (
    <section aria-labelledby="titre-apparence" style={{ marginBottom: 28 }}>
      <h2 id="titre-apparence" style={{ marginBottom: 4 }}>Apparence</h2>
      <p className="statut" style={{ marginBottom: 12 }}>
        Le thème vaut pour toute l’équipe
        {direction ? '' : ', et c’est la direction qui le choisit'}. Le mode clair
        ou sombre se règle par personne, ici ou en bas du menu.
      </p>

      {installee === false && (
        <div className="erreur">
          Le SQL 41 n’a pas encore été exécuté : un choix fait ici vaut pour cette session,
          il ne sera pas retenu à la prochaine ouverture.
        </div>
      )}
      {erreur && <div className="erreur">{erreur}</div>}
      {message && (
        <div className="erreur" style={{ borderLeftColor: 'var(--encre)', background: 'var(--ok-pale)' }}>
          {message}
        </div>
      )}

      <div className="themes">
        {THEMES.map((t) => (
          <button key={t.cle} className="theme-choix" aria-pressed={theme === t.cle}
                  disabled={!direction} onClick={() => choisir(t.cle)}>
            <span className="theme-apercu" data-theme={t.cle} data-ton={ton} aria-hidden="true">
              <span className="theme-apercu-titre">Bonjour Fabrice</span>
              <span className="theme-apercu-tuiles">
                <span><b>2</b>Urgent</span>
                <span><b>5</b>À décider</span>
              </span>
              <span className="theme-apercu-bouton">Voir le mail et envoyer</span>
            </span>
            <strong>{t.nom}</strong>
            <em>{t.detail}</em>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
        <span className="statut">Mode d’affichage, pour vous :</span>
        <ChoixTon onErreur={setErreur} />
      </div>
    </section>
  );
}
