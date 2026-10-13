import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { calculerFacture, eur } from '../lib/calcul';
import {
  chargerFacture, chargerParametres, chargerTousLesDevis, emettreFacture, factureDepuisDevis,
  LIBELLES_FACTURE, listerFactures, supprimerFacture,
  type DevisGroupe, type FactureAvecTiers,
} from '../lib/db';
import type { TypeFacture } from '../lib/types';
import Modale from '../components/Modale';
import Menu from '../components/Menu';
import Squelette from '../components/Squelette';

/**
 * Les factures.
 *
 * Le maillon qui manquait : Batinium savait chiffrer, ouvrir un chantier, le
 * réceptionner et attendre des échéances — mais n'avait jamais émis le seul
 * document qui rende une créance exigible.
 *
 * Un brouillon n'a pas de numéro, et c'est voulu : la série doit être
 * continue. Le numéro arrive à l'émission, et à ce moment la facture se fige.
 */

const COULEUR: Record<string, string> = {
  brouillon: 'var(--encre-pale)', emise: 'var(--bleu)',
  payee: 'var(--vert)', annulee: 'var(--alerte)',
};

export default function PageFactures() {
  const [factures, setFactures] = useState<FactureAvecTiers[]>([]);
  const [totaux, setTotaux] = useState<Record<string, number>>({});
  const [devis, setDevis] = useState<DevisGroupe[]>([]);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);
  const [acomptePct, setAcomptePct] = useState(30);
  const [filtre, setFiltre] = useState<'tout' | 'brouillon' | 'emise' | 'payee'>('tout');

  const recharger = useCallback(async () => {
    try {
      const [f, d, params] = await Promise.all([
        listerFactures(), chargerTousLesDevis().catch(() => []),
        chargerParametres().catch(() => null),
      ]);
      setFactures(f);
      if (params?.acompte_defaut_pct) setAcomptePct(Number(params.acompte_defaut_pct));
      setDevis(d.filter((g) => g.devis.statut === 'signe'));

      // Les totaux se calculent depuis les lignes : une facture ne stocke pas
      // son montant, sinon il faudrait le maintenir à chaque correction.
      const montants: Record<string, number> = {};
      await Promise.all(f.slice(0, 200).map(async (x) => {
        try {
          const complete = await chargerFacture(x.id);
          montants[x.id] = calculerFacture(complete.facture, complete.lignes).netAPayer;
        } catch { /* une facture illisible ne doit pas vider la liste */ }
      }));
      setTotaux(montants);
    } catch (e) { setErreur((e as Error).message); }
    setCharge(true);
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);
  if (!charge) return (
    <>
      <div className="entete"><h1>Factures</h1></div>
      <Squelette chiffres={3} lignes={7} colonnes={6} />
    </>
  );

  const visibles = factures.filter((f) => filtre === 'tout' || f.statut === filtre);
  const somme = (l: FactureAvecTiers[]) => l.reduce((s, f) => s + (totaux[f.id] ?? 0), 0);
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const emises = factures.filter((f) => f.statut === 'emise');
  const enRetard = emises.filter((f) => f.echeance_le && f.echeance_le < aujourdhui);

  return (
    <>
      <div className="entete">
        <h1>Factures</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)}
                  style={{ width: 170 }}>
            <option value="tout">Toutes</option>
            <option value="brouillon">Brouillons</option>
            <option value="emise">Émises</option>
            <option value="payee">Payées</option>
          </select>
          <button className="action" onClick={() => setCreation(true)}>Nouvelle facture</button>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div style={{ display: 'grid', gap: 12, marginBottom: 16,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Chiffre libelle="Émis, en attente de règlement" valeur={eur(somme(emises))}
                 note={`${emises.length} facture${emises.length > 1 ? 's' : ''}`} />
        <Chiffre libelle="Échéance dépassée" valeur={eur(somme(enRetard))}
                 alerte={enRetard.length > 0}
                 note={enRetard.length ? 'à relancer' : 'rien en retard'} />
        <Chiffre libelle="Encaissé" valeur={eur(somme(factures.filter((f) => f.statut === 'payee')))} />
        <Chiffre libelle="Brouillons" valeur={factures.filter((f) => f.statut === 'brouillon').length}
                 note="sans numéro tant qu’ils ne sont pas émis" />
      </div>

      {visibles.length === 0 ? (
        <div className="vide">
          Aucune facture. Elles se créent depuis un devis signé — acompte, situation
          ou solde — ou de toutes pièces.
        </div>
      ) : (
        <div className="tableau-defilant">
          <table>
            <thead>
              <tr>
                <th style={{ width: 160 }}>Numéro</th>
                <th style={{ width: 150 }}>Nature</th>
                <th>Client</th>
                <th style={{ width: 130 }}>Chantier</th>
                <th style={{ width: 105 }}>Émise le</th>
                <th style={{ width: 105 }}>Échéance</th>
                <th className="num" style={{ width: 120 }}>Net à payer</th>
                <th style={{ width: 100 }}>État</th>
                <th style={{ width: 50 }} className="sans-impression" />
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const retard = f.statut === 'emise' && f.echeance_le && f.echeance_le < aujourdhui;
                return (
                  <tr key={f.id} className="cliquable"
                      onClick={() => aller(`/factures/${f.id}`)}
                      style={retard ? { background: '#fdf3f2' } : undefined}>
                    <td>
                      <strong>{f.numero ?? <span className="statut">brouillon</span>}</strong>
                      {f.titre && <div className="statut">{f.titre}</div>}
                    </td>
                    <td className="statut">{LIBELLES_FACTURE[f.type]}</td>
                    <td>{f.tiers?.nom ?? '—'}</td>
                    <td className="ref">{f.chantier?.numero ?? '—'}</td>
                    <td className="num ref">
                      {new Date(f.date_emission).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="num ref">
                      {f.echeance_le ? new Date(f.echeance_le).toLocaleDateString('fr-FR') : '—'}
                      {retard && <div><span className="jeton" data-r="retard">dépassée</span></div>}
                    </td>
                    <td className="num">
                      {totaux[f.id] != null ? eur(totaux[f.id]) : '…'}
                    </td>
                    <td>
                      <span className="jeton" style={{
                        color: COULEUR[f.statut], borderColor: COULEUR[f.statut],
                      }}>{f.statut}</span>
                    </td>
                    <td className="sans-impression" onClick={(e) => e.stopPropagation()}>
                      <Menu actions={[
                        { libelle: 'Ouvrir', faire: () => aller(`/factures/${f.id}`) },
                        ...(f.statut === 'brouillon'
                          ? [
                              { libelle: 'Émettre', faire: () => {
                                  if (window.confirm(
                                    'Émettre cette facture ? Elle recevra son numéro et ne pourra plus être modifiée.')) {
                                    void emettreFacture(f.id).then(recharger)
                                      .catch((e) => setErreur((e as Error).message));
                                  }
                                } },
                              { libelle: 'Supprimer', danger: true, faire: () => {
                                  if (window.confirm('Supprimer ce brouillon ?')) {
                                    void supprimerFacture(f.id).then(recharger)
                                      .catch((e) => setErreur((e as Error).message));
                                  }
                                } },
                            ]
                          : []),
                      ]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creation && (
        <Modale titre="Nouvelle facture" taille="large" onFermer={() => setCreation(false)}>
          <Creation devis={devis} defaut={acomptePct} onErreur={setErreur}
                    onCree={(id) => { setCreation(false); aller(`/factures/${id}`); }} />
        </Modale>
      )}
    </>
  );
}

function Creation({ devis, defaut, onCree, onErreur }: {
  devis: DevisGroupe[];
  /** Le pourcentage réglé dans Entreprise, pas une constante du code. */
  defaut: number;
  onCree: (id: string) => void;
  onErreur: (m: string) => void;
}) {
  const [devisId, setDevisId] = useState('');
  const [type, setType] = useState<TypeFacture>('acompte');
  const [pourcentage, setPourcentage] = useState(defaut);
  const [travail, setTravail] = useState(false);

  async function creer() {
    if (!devisId) return onErreur('Choisissez le devis à facturer.');
    setTravail(true);
    try {
      const f = await factureDepuisDevis(devisId, { type, pourcentage });
      onCree(f.id);
    } catch (e) { onErreur((e as Error).message); }
    setTravail(false);
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p className="statut">
        Une facture se fabrique depuis un devis signé : le client, le chantier, les lignes
        et les taux de TVA en viennent, avec leur justification. La ressaisie serait le
        meilleur moyen d’obtenir une facture qui ne correspond pas au devis accepté.
      </p>

      <div>
        <label>Devis signé</label>
        <select value={devisId} onChange={(e) => setDevisId(e.target.value)}>
          <option value="">—</option>
          {devis.map((g) => (
            <option key={g.devis.id} value={g.devis.id}>
              {g.devis.numero} — {g.devis.tiers?.nom ?? 'sans client'}
              {g.devis.titre ? ` — ${g.devis.titre}` : ''}
            </option>
          ))}
        </select>
        {devis.length === 0 && (
          <p className="statut">
            Aucun devis signé pour l’instant. Un devis se signe depuis sa fiche.
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 160px' }}>
        <div>
          <label>Nature</label>
          <select value={type} onChange={(e) => setType(e.target.value as TypeFacture)}>
            <option value="acompte">Facture d’acompte</option>
            <option value="situation">Situation de travaux</option>
            <option value="solde">Facture de solde</option>
            <option value="facture">Facture, montant total</option>
          </select>
        </div>
        {(type === 'acompte' || type === 'situation') && (
          <div>
            <label>Pourcentage</label>
            <input type="number" min={1} max={100} className="num" value={pourcentage}
                   onChange={(e) => setPourcentage(Number(e.target.value))} />
          </div>
        )}
      </div>

      <p className="statut">
        {type === 'acompte' || type === 'situation'
          ? 'Une ligne par taux de TVA du devis : un acompte forfaitaire sur un devis mêlant 5,5 % et 20 % donnerait sinon une TVA fausse.'
          : type === 'solde'
            ? 'Toutes les lignes du devis. Pensez à renseigner l’acompte déjà facturé dans la facture, il se déduira du net à payer.'
            : 'Toutes les lignes du devis, sans déduction.'}
      </p>

      <div>
        <button className="action" disabled={travail || !devisId} onClick={() => void creer()}>
          {travail ? 'Création…' : 'Créer le brouillon'}
        </button>
        <p className="statut" style={{ marginTop: 6 }}>
          Elle sera modifiable tant qu’elle reste un brouillon, et n’aura pas encore de numéro.
        </p>
      </div>
    </div>
  );
}

function Chiffre({ libelle, valeur, note, alerte }:
  { libelle: string; valeur: string | number; note?: string; alerte?: boolean }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--filet)',
      borderLeft: `3px solid ${alerte ? 'var(--alerte)' : 'var(--filet)'}`, padding: '12px 14px',
    }}>
      <div className="statut">{libelle}</div>
      <div className="num" style={{ fontSize: 23, fontWeight: 600, textAlign: 'left' }}>{valeur}</div>
      {note && <div className="statut">{note}</div>}
    </div>
  );
}
