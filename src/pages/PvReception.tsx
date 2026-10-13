import { useEffect, useState } from 'react';
import { aller } from '../lib/router';
import {
  chargerChantier, chargerParametres, listerEquipements, listerSites,
  type ChantierAvecTiers,
} from '../lib/db';
import { chargerTiers } from '../lib/db';
import type { Equipement, Parametres, Site, Tiers } from '../lib/types';

/**
 * Procès-verbal de réception des travaux.
 *
 * C'est le document le plus important de la fin de chantier. La réception
 * fait courir les garanties : parfait achèvement un an, bon fonctionnement
 * deux ans, décennale dix ans. Sans procès-verbal daté et signé, ce point
 * de départ est contestable, et c'est l'entreprise qui en pâtit.
 */
export default function PagePvReception({ chantierId }: { chantierId: string }) {
  const [c, setC] = useState<ChantierAvecTiers | null>(null);
  const [tiers, setTiers] = useState<Tiers | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [p, setP] = useState<Parametres | null>(null);
  const [equipements, setEquipements] = useState<Equipement[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const chantier = await chargerChantier(chantierId);
        setC(chantier);
        const [params, eq, sites, t] = await Promise.all([
          chargerParametres(),
          listerEquipements({ chantierId }),
          listerSites(chantier.tiers_id),
          chargerTiers(chantier.tiers_id),
        ]);
        setP(params); setEquipements(eq); setTiers(t);
        setSite(sites.find((s) => s.id === chantier.site_id) ?? sites[0] ?? null);
      } catch (e) { setErreur((e as Error).message); }
    })();
  }, [chantierId]);

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!c || !p) return null;

  const reserves = (c.reserves ?? []).filter((r) => r.texte?.trim());
  const dateReception = c.pv_date ?? c.date_reception;
  const avecReserves = c.pv_avec_reserves ?? reserves.length > 0;

  const plus = (annees: number) => {
    if (!dateReception) return '—';
    const d = new Date(dateReception);
    d.setFullYear(d.getFullYear() + annees);
    return d.toLocaleDateString('fr-FR');
  };

  return (
    <div className="document">
      <div className="sans-impression" style={{ padding: 12, display: 'flex', gap: 8,
                                                background: 'var(--papier)' }}>
        <button className="action" onClick={() => window.print()}>
          Imprimer ou enregistrer en PDF
        </button>
        <button className="action discret" onClick={() => aller(`/chantiers/${chantierId}`)}>
          Retour au chantier
        </button>
        {!dateReception && (
          <span className="statut" style={{ alignSelf: 'center', color: 'var(--alerte)' }}>
            Aucune date de réception : prononcez-la depuis la fiche du chantier.
          </span>
        )}
      </div>

      <header className="doc-entete">
        <div>
          {p.logo_data_url
            ? <img src={p.logo_data_url} alt={p.raison_sociale} style={{ maxHeight: 60, marginBottom: 10 }} />
            : <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', marginBottom: 10 }}>
                {p.raison_sociale}
              </div>}
          <div className="doc-petit">
            {p.adresse}<br />{p.code_postal} {p.ville}<br />
            Tél. {p.telephone}<br />{p.email}<br />
            SIRET {p.siret}
          </div>
        </div>
        <div className="doc-client">
          <strong>Maître d’ouvrage</strong><br />
          {tiers?.nom ?? c.tiers?.nom ?? '—'}<br />
          {tiers?.adresse}<br />
          {tiers?.code_postal} {tiers?.ville}
        </div>
      </header>

      <div style={{ textAlign: 'center', margin: '28px 0 20px' }}>
        <h1 style={{ fontSize: 21, letterSpacing: '.01em' }}>
          Procès-verbal de réception des travaux
        </h1>
        <div className="doc-petit" style={{ marginTop: 6 }}>
          {c.pv_numero ? `${c.pv_numero} — ` : ''}
          Établi en application de l’article 1792-6 du code civil
        </div>
      </div>

      <table className="doc-table" style={{ marginBottom: 20 }}>
        <tbody>
          <Ligne libelle="Chantier" valeur={`${c.numero} — ${c.libelle}`} />
          <Ligne libelle="Adresse des travaux"
                 valeur={site ? `${site.adresse}, ${site.code_postal ?? ''} ${site.ville ?? ''}` : '—'} />
          <Ligne libelle="Date de début des travaux"
                 valeur={c.date_debut ? new Date(c.date_debut).toLocaleDateString('fr-FR') : '—'} />
          <Ligne libelle="Date de réception"
                 valeur={dateReception ? new Date(dateReception).toLocaleDateString('fr-FR')
                                       : 'à compléter'} />
          <Ligne libelle="Représentant du maître d’ouvrage"
                 valeur={c.pv_representant_client ?? '—'} />
          <Ligne libelle="Représentant de l’entreprise" valeur={p.raison_sociale} />
        </tbody>
      </table>

      <div className="doc-encadre" style={{ marginBottom: 18 }}>
        <strong>
          {avecReserves
            ? 'La réception des travaux est prononcée AVEC réserves.'
            : 'La réception des travaux est prononcée SANS réserve.'}
        </strong>
        <p className="doc-petit" style={{ marginTop: 6, marginBottom: 0 }}>
          Le maître d’ouvrage déclare accepter l’ouvrage tel qu’il a été exécuté,
          {avecReserves
            ? ' sous les réserves énumérées ci-dessous, que l’entreprise s’engage à lever dans le délai convenu.'
            : ' sans formuler de réserve.'}
        </p>
      </div>

      {avecReserves && (
        <>
          <h2 style={{ fontSize: 15, marginBottom: 8 }}>Réserves formulées</h2>
          {reserves.length === 0 ? (
            <p className="doc-petit">Aucune réserve saisie sur la fiche du chantier.</p>
          ) : (
            <table className="doc-table" style={{ marginBottom: 18 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>N°</th>
                  <th>Réserve</th>
                  <th style={{ width: 90 }}>Levée</th>
                </tr>
              </thead>
              <tbody>
                {reserves.map((r, i) => (
                  <tr key={i}>
                    <td className="num">{i + 1}</td>
                    <td>{r.texte}</td>
                    <td>{r.levee ? 'oui' : 'non'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {c.reserves_levees_le && (
            <p className="doc-petit">
              Levée des réserves constatée le{' '}
              {new Date(c.reserves_levees_le).toLocaleDateString('fr-FR')}.
            </p>
          )}
        </>
      )}

      {equipements.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, margin: '18px 0 8px' }}>Matériel installé</h2>
          <table className="doc-table" style={{ marginBottom: 18 }}>
            <thead>
              <tr>
                <th>Marque et modèle</th><th>Numéro de série</th>
                <th>Emplacement</th><th>Fluide</th><th>Garantie</th>
              </tr>
            </thead>
            <tbody>
              {equipements.map((e) => (
                <tr key={e.id}>
                  <td>{[e.marque, e.modele].filter(Boolean).join(' ') || '—'}</td>
                  <td className="doc-petit">{e.numero_serie ?? '—'}</td>
                  <td>{e.emplacement ?? '—'}</td>
                  <td className="doc-petit">
                    {e.charge_kg ? `${e.charge_kg} kg ${e.fluide ?? ''}` : (e.fluide ?? '—')}
                  </td>
                  <td className="doc-petit">
                    {e.garantie_fin ? new Date(e.garantie_fin).toLocaleDateString('fr-FR') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {c.pv_observations && (
        <>
          <h2 style={{ fontSize: 15, margin: '18px 0 8px' }}>Observations</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{c.pv_observations}</p>
        </>
      )}

      <div className="doc-mentions">
        <h3>Effets de la réception</h3>
        <p>
          La réception fait courir les délais de garantie légale. À compter du{' '}
          {dateReception ? new Date(dateReception).toLocaleDateString('fr-FR') : '…'} :
        </p>
        <ul>
          <li>
            <strong>Garantie de parfait achèvement</strong>, un an, soit jusqu’au {plus(1)} :
            l’entreprise répare les désordres signalés, réservés ou apparus après réception.
          </li>
          <li>
            <strong>Garantie de bon fonctionnement</strong>, deux ans, soit jusqu’au {plus(2)} :
            elle couvre les éléments d’équipement dissociables de l’ouvrage.
          </li>
          <li>
            <strong>Garantie décennale</strong>, dix ans, soit jusqu’au {plus(10)} :
            elle couvre les dommages compromettant la solidité de l’ouvrage ou le rendant
            impropre à sa destination.
          </li>
        </ul>
        <p>
          Assurance décennale : {p.assureur_nom}
          {p.assureur_adresse ? `, ${p.assureur_adresse}` : ''}
          {p.assureur_police ? ` — contrat n° ${p.assureur_police}` : ''}
          {p.assureur_couverture ? `. Couverture : ${p.assureur_couverture}.` : '.'}
        </p>
        <p className="doc-petit">
          Le présent procès-verbal est établi en deux exemplaires originaux, dont un remis
          au maître d’ouvrage.
        </p>
      </div>

      <div className="doc-signature">
        <div>
          <strong>Le maître d’ouvrage</strong>
          <p className="doc-petit">
            {tiers?.nom ?? '—'}
            {c.pv_representant_client ? ` — ${c.pv_representant_client}` : ''}<br />
            Mention « lu et approuvé », date et signature :
          </p>
          <div className="doc-cadre" />
        </div>
        <div>
          <strong>Pour {p.raison_sociale}</strong>
          <p className="doc-petit">
            Date et signature :
          </p>
          <div className="doc-cadre" />
        </div>
      </div>

      <footer className="doc-pied">
        {p.raison_sociale} — {p.adresse}, {p.code_postal} {p.ville} — Tél. {p.telephone} — {p.email}<br />
        {p.forme_juridique} — {p.siret} {p.rcs} — TVA intra. {p.tva_intracom}<br />
        Assurance {p.assureur_nom} n° {p.assureur_police}
      </footer>
    </div>
  );
}

function Ligne({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <tr>
      <td style={{ width: 240, color: 'var(--encre-pale)' }}>{libelle}</td>
      <td><strong>{valeur}</strong></td>
    </tr>
  );
}
