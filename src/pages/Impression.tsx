import { useEffect, useState } from 'react';
import { calculerDevis, eur, type DevisCalcule, type LotCalcule } from '../lib/calcul';
import {
  chargerDevis, chargerParametres, listerProduits, resoudrePhotos, type DevisComplet,
} from '../lib/db';
import type { Parametres, Produit } from '../lib/types';

/**
 * Le devis imprimable. C'est le PDF : le navigateur s'en charge.
 * Reprend la mise en page actuelle de Pilotech, et ajoute les quatre mentions
 * qui manquent à ses devis : délai d'exécution, médiateur, assurance complète
 * et droit de rétractation.
 */
export default function PageImpression({ devisId }: { devisId: string }) {
  const [d, setD] = useState<DevisComplet | null>(null);
  const [p, setP] = useState<Parametres | null>(null);
  const [calcul, setCalcul] = useState<DevisCalcule | null>(null);
  const [produits, setProduits] = useState<Map<string, Produit>>(new Map());
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [devis, params, produits] = await Promise.all([
          chargerDevis(devisId), chargerParametres(), listerProduits(true),
        ]);
        setD(devis); setP(params);
        setProduits(new Map(produits.map((x) => [x.id, x])));
        // Les photos sont résolues avant l'affichage, et non pendant : sur un
        // document destiné à l'impression, une image qui arrive après le clic
        // sur « Imprimer » ne figure pas dans le PDF.
        setPhotos(await resoudrePhotos(produits).catch(() => ({})));
        setCalcul(calculerDevis(devis.devis, devis.lots, devis.lignes,
          new Map(produits.map((x) => [x.id, x])), devis.site));
      } catch (e) { setErreur((e as Error).message); }
    })();
  }, [devisId]);

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!d || !p || !calcul) return null;

  const { devis, tiers, site } = d;
  const particulier = tiers?.type === 'particulier';
  const validite = new Date(devis.date_emission);
  validite.setDate(validite.getDate() + devis.validite_jours);

  return (
    <div className="document">
      <div className="sans-impression" style={{ padding: 12, display: 'flex', gap: 8, background: 'var(--papier)' }}>
        <button className="action" onClick={() => window.print()}>Imprimer ou enregistrer en PDF</button>
        <button className="action discret" onClick={() => history.back()}>Retour</button>
        <span className="statut" style={{ alignSelf: 'center' }}>
          Dans la boîte d’impression, choisissez « Enregistrer au format PDF ».
        </span>
      </div>

      <header className="doc-entete">
        <div>
          {p.logo_data_url
            ? <img src={p.logo_data_url} alt={p.raison_sociale} style={{ maxHeight: 60, marginBottom: 10 }} />
            : <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', marginBottom: 10 }}>
                {p.raison_sociale}
              </div>}
          <div className="doc-petit">
            {p.adresse}<br />{p.code_postal} {p.ville}<br />France<br /><br />
            Tél : {p.telephone}{p.portable ? ` — Port. : ${p.portable}` : ''}<br />
            {p.email}<br />{p.site_web}
          </div>
        </div>
        <div className="doc-client">
          <strong>{tiers?.nom ?? '—'}</strong><br />
          {tiers?.adresse}<br />
          {tiers?.code_postal} {tiers?.ville}<br />France
        </div>
      </header>

      <div className="doc-titre">
        <div>
          <h1 style={{ fontSize: 19 }}>Devis n° {devis.numero}</h1>
          <div className="doc-petit">
            Valable jusqu’au {validite.toLocaleDateString('fr-FR')}
          </div>
        </div>
        <div className="doc-petit">
          En date du {new Date(devis.date_emission).toLocaleDateString('fr-FR')}
        </div>
      </div>

      {site && (
        <div className="doc-encadre">
          <em>Adresse du projet</em><br />
          {site.adresse}<br />{site.code_postal} {site.ville}
        </div>
      )}

      {devis.titre && <h2 style={{ fontStyle: 'italic', margin: '18px 0 6px', fontSize: 17 }}>{devis.titre}</h2>}
      {devis.intro && <p style={{ fontStyle: 'italic', whiteSpace: 'pre-line', marginBottom: 12 }}>{devis.intro}</p>}
      {devis.resume_materiel && (
        <ul style={{ marginBottom: 14 }}>
          {devis.resume_materiel.split('\n').filter(Boolean).map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}

      <table className="doc-table">
        <thead>
          <tr>
            <th style={{ width: 52 }}>N°</th>
            <th>Désignation</th>
            <th style={{ width: 54 }} className="num">Qté</th>
            <th style={{ width: 84 }} className="num">PU HT</th>
            <th style={{ width: 52 }} className="num">TVA</th>
            <th style={{ width: 96 }} className="num">Total HT</th>
          </tr>
        </thead>
        <tbody>
          {calcul.arbre.map((lot) => (
            <LigneLot key={lot.lot.id} noeud={lot} niveau={0} produits={produits} photos={photos} />
          ))}
        </tbody>
      </table>

      <table className="doc-totaux">
        <tbody>
          <tr><td>Sous-total HT</td><td className="num">{eur(calcul.sousTotalHt)}</td></tr>
          {calcul.remise > 0 && (
            <tr><td>{devis.remise_libelle ?? 'Remise'}</td><td className="num">− {eur(calcul.remise)}</td></tr>
          )}
          <tr className="fort"><td>Total HT</td><td className="num">{eur(calcul.totalHt)}</td></tr>
          {calcul.ventilation.map((v) => (
            <tr key={v.taux}>
              <td>TVA {String(v.taux).replace('.', ',')} % sur {eur(v.baseHt)}</td>
              <td className="num">{eur(v.montantTva)}</td>
            </tr>
          ))}
          <tr className="fort grand"><td>Total TTC</td><td className="num">{eur(calcul.totalTtc)}</td></tr>
        </tbody>
      </table>

      {calcul.echeances.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <strong>Modalités de règlement</strong>
          <p className="doc-petit">Paiement par virement bancaire. IBAN : {p.iban}</p>
          <ul>
            {calcul.echeances.map((e, i) => (
              <li key={i}>{e.libelle} : {e.pourcentage} %, soit {eur(e.montant)}</li>
            ))}
          </ul>
        </div>
      )}

      {calcul.mentions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {calcul.mentions.map((m, i) => <p key={i} className="doc-petit">{m}</p>)}
        </div>
      )}

      {/* Les mentions absentes des devis actuels */}
      <div className="doc-mentions">
        <h3>Informations légales</h3>
        {p.delai_execution && <p><strong>Délai d’exécution.</strong> {p.delai_execution}</p>}
        <p>
          <strong>Assurance décennale.</strong> {p.assureur_nom}
          {p.assureur_adresse ? `, ${p.assureur_adresse}` : ''}
          {p.assureur_police ? ` — contrat n° ${p.assureur_police}` : ''}
          {p.assureur_couverture ? `. Couverture : ${p.assureur_couverture}.` : '.'}
        </p>
        {p.mediateur_nom && (
          <p>
            <strong>Médiation de la consommation.</strong> En cas de litige, vous pouvez saisir
            gratuitement {p.mediateur_nom}
            {p.mediateur_url ? ` — ${p.mediateur_url}` : ''}.
          </p>
        )}
        {particulier && p.afficher_retractation && p.mention_retractation && (
          <p><strong>Droit de rétractation.</strong> {p.mention_retractation}</p>
        )}
      </div>

      {p.conditions_generales && (
        <div className="doc-cgv">
          <h3>Conditions générales</h3>
          <div style={{ whiteSpace: 'pre-line' }}>{p.conditions_generales}</div>
        </div>
      )}

      <div className="doc-signature">
        <div>
          <strong>Le client</strong>
          <p className="doc-petit">
            « Devis reçu avant l’exécution des travaux. Bon pour travaux. »<br />
            Mention datée et signée :
          </p>
          <div className="doc-cadre" />
        </div>
        <div>
          <strong>Pour {p.raison_sociale}</strong>
          <div className="doc-cadre" />
        </div>
      </div>

      {particulier && p.afficher_retractation && (
        <div className="doc-retractation">
          <h3>Formulaire de rétractation</h3>
          <p className="doc-petit">
            À compléter et renvoyer uniquement si vous souhaitez vous rétracter du contrat,
            dans les quatorze jours suivant sa conclusion.
          </p>
          <p>
            À l’attention de {p.raison_sociale}, {p.adresse}, {p.code_postal} {p.ville} — {p.email}
          </p>
          <p>
            Je vous notifie par la présente ma rétractation du contrat portant sur le devis
            n° {devis.numero} du {new Date(devis.date_emission).toLocaleDateString('fr-FR')}.
          </p>
          <p>Nom du consommateur : ______________________________________</p>
          <p>Adresse : __________________________________________________</p>
          <p>Date : ______________  Signature : ____________________________</p>
        </div>
      )}

      <footer className="doc-pied">
        {p.raison_sociale} — {p.adresse}, {p.code_postal} {p.ville} — Tél. {p.telephone} — {p.email}<br />
        {p.forme_juridique} — {p.siret} {p.rcs} — TVA intra. {p.tva_intracom} — Code APE {p.code_ape}<br />
        Assurance {p.assureur_nom} n° {p.assureur_police} — IBAN {p.iban}
        {p.attestation_capacite ? ` — Attestation de capacité fluides n° ${p.attestation_capacite}` : ''}
      </footer>
    </div>
  );
}

function LigneLot({ noeud, niveau, produits, photos }: {
  noeud: LotCalcule; niveau: number; produits: Map<string, Produit>;
  photos: Record<string, string>;
}) {
  return (
    <>
      <tr className={niveau === 0 ? 'doc-lot' : 'doc-souslot'}>
        <td className="num">{noeud.numero}</td>
        <td colSpan={4}>{noeud.lot.titre}</td>
        <td className="num">{eur(noeud.totalHt)}</td>
      </tr>
      {noeud.lignes.map((l) => {
        const produit = l.produit_id ? produits.get(l.produit_id) : undefined;
        const photo = produit?.afficher_photo === false ? null : photos[produit?.id ?? ''];
        return (
        <tr key={l.id}>
          <td className="num doc-petit">{l.numero}</td>
          <td>
            <div style={{ display: 'flex', gap: 10 }}>
              {photo && <img src={photo} alt="" className="doc-photo" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                {l.designation}
                {l.description && <div className="doc-fiche">{l.description}</div>}
              </div>
            </div>
          </td>
          <td className="num">{Number(l.quantite)} {l.unite}</td>
          <td className="num">{eur(Number(l.prix_unitaire_ht))}</td>
          <td className="num">{String(l.taux_tva).replace('.', ',')} %</td>
          <td className="num">{eur(l.totalHt)}</td>
        </tr>
      );})}
      {noeud.enfants.map((e) => (
        <LigneLot key={e.lot.id} noeud={e} niveau={niveau + 1} produits={produits} photos={photos} />
      ))}
    </>
  );
}
