import { eur, type DevisCalcule } from '../lib/calcul';
import type { Devis } from '../lib/types';

/**
 * Le panneau que Fabrice regarde en permanence.
 * Deux zones distinctes : ce que voit le client (en haut), ce qu'il est seul
 * à voir (en bas, marge). La séparation est visuelle autant que technique.
 */
export default function PanneauTotaux({
  devis,
  calcul,
  onChange,
}: {
  devis: Devis;
  calcul: DevisCalcule;
  onChange: (patch: Partial<Devis>) => void;
}) {
  const bloc = {
    background: 'var(--surface)',
    border: '1px solid var(--filet)',
    padding: 14,
    marginBottom: 12,
  } as const;

  const ligne = (g: string, d: string, gras = false) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '3px 0',
        fontWeight: gras ? 600 : 400,
      }}
    >
      <span>{g}</span>
      <span className="num">{d}</span>
    </div>
  );

  return (
    <aside style={{ position: 'sticky', top: 70, alignSelf: 'start' }}>
      <div style={bloc}>
        {ligne('Sous-total HT', eur(calcul.sousTotalHt))}

        <div style={{ display: 'flex', gap: 8, alignItems: 'end', margin: '8px 0' }}>
          <div style={{ flex: 1 }}>
            <label>Remise globale</label>
            <input
              value={devis.remise_libelle ?? ''}
              onChange={(e) => onChange({ remise_libelle: e.target.value })}
            />
          </div>
          <div style={{ width: 110 }}>
            <label>Montant</label>
            <input
              type="number"
              step="0.01"
              className="num"
              value={devis.remise_montant ?? 0}
              onChange={(e) => onChange({ remise_montant: Number(e.target.value) })}
            />
          </div>
        </div>

        {ligne('Total HT', eur(calcul.totalHt), true)}

        <div style={{ borderTop: '1px solid var(--filet)', margin: '8px 0', paddingTop: 8 }}>
          {calcul.ventilation.map((v) => (
            <div key={v.taux}>
              {ligne(`TVA ${String(v.taux).replace('.', ',')} % sur ${eur(v.baseHt)}`, eur(v.montantTva))}
            </div>
          ))}
        </div>

        <div
          style={{
            borderTop: '2px solid var(--encre)',
            paddingTop: 8,
            fontSize: 17,
          }}
        >
          {ligne('Total TTC', eur(calcul.totalTtc), true)}
        </div>
      </div>

      {/* Majoration de marge : atterrit sur une ligne, invisible au client. */}
      <div style={bloc}>
        <h3 style={{ marginBottom: 8 }}>Majoration</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <div style={{ flex: 1 }}>
            <label>Mode</label>
            <select
              value={devis.marge_mode}
              onChange={(e) => onChange({ marge_mode: e.target.value as Devis['marge_mode'] })}
            >
              <option value="aucune">Aucune</option>
              <option value="pourcentage">Pourcentage</option>
              <option value="montant">Montant fixe</option>
            </select>
          </div>
          <div style={{ width: 100 }}>
            <label>Valeur</label>
            <input
              type="number"
              step="0.01"
              className="num"
              disabled={devis.marge_mode === 'aucune'}
              value={devis.marge_valeur ?? 0}
              onChange={(e) => onChange({ marge_valeur: Number(e.target.value) })}
            />
          </div>
        </div>
        <p className="statut" style={{ marginTop: 6 }}>
          Absorbée par la dernière ligne de main-d’œuvre du devis, en général la logistique. Elle
          n’apparaît nulle part comme telle. Placée sur de la main-d’œuvre, elle est taxée à 10 %
          plutôt qu’à 20 %.
        </p>
      </div>

      {calcul.margeHt != null && (
        <div style={{ ...bloc, borderLeft: '3px solid var(--bleu)' }}>
          <h3 style={{ marginBottom: 8 }}>Interne</h3>
          {ligne('Déboursé sec', eur(calcul.deboursSecHt ?? 0))}
          {ligne('Marge', `${eur(calcul.margeHt)} (${calcul.margePct?.toFixed(1)} %)`, true)}
          <p className="statut" style={{ marginTop: 6 }}>
            Jamais imprimé, jamais envoyé au téléphone d’un poseur.
          </p>
        </div>
      )}

      {calcul.echeances.length > 0 && (
        <div style={bloc}>
          <h3 style={{ marginBottom: 8 }}>Échéancier</h3>
          {calcul.echeances.map((e, i) => (
            <div key={i}>{ligne(`${e.pourcentage} % — ${e.libelle}`, eur(e.montant))}</div>
          ))}
        </div>
      )}

      {calcul.reserves.length > 0 && (
        <div style={{ ...bloc, borderLeft: '3px solid var(--alerte)' }}>
          <h3 style={{ marginBottom: 8 }}>À faire trancher</h3>
          {calcul.reserves.map((r, i) => (
            <p key={i} className="statut" style={{ marginBottom: 6 }}>
              {r}
            </p>
          ))}
        </div>
      )}
    </aside>
  );
}
