import { useCallback, useEffect, useState } from 'react';
import {
  approuverRattachement, calerCompteur, chargerEntreprise, chargerJeuPrealables,
  chargerParametres, clePrealable, enregistrerParametres, enregistrerPrealable, etatCompteurs,
  JEUX_PREALABLES, listerMembres, listerPrealables, listerRattachements, majMembre,
  refuserRattachement, supprimerPrealable,
} from '../lib/db';
import ChampAdresse from '../components/ChampAdresse';
import PiecesJointes from '../components/PiecesJointes';
import Modale from '../components/Modale';
import type {
  Entreprise, Membre, Parametres, Prealable, Rattachement, Role, TypeDocument,
} from '../lib/types';

/** Les pièces que l'entreprise doit pouvoir produire à la demande. */
const PIECES_ENTREPRISE: TypeDocument[] = [
  'attestation_capacite_fluides', 'kbis', 'decennale', 'rc_pro',
  'attestation_urssaf', 'rib', 'autre',
];

export default function PageParametres() {
  const [p, setP] = useState<Parametres | null>(null);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [demandes, setDemandes] = useState<Rattachement[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tic, setTic] = useState(0);
  const [compteurs, setCompteurs] = useState<{ type: string; annee: number; dernier: number }[]>([]);
  const [reprise, setReprise] = useState('');
  const [confirmation, setConfirmation] = useState<number | null>(null);

  useEffect(() => {
    chargerParametres().then(setP).catch((e) => setErreur((e as Error).message));
    listerMembres().then(setMembres).catch(() => setMembres([]));
    chargerEntreprise().then(setEntreprise).catch(() => setEntreprise(null));
    listerRattachements().then(setDemandes).catch(() => setDemandes([]));
    etatCompteurs().then(setCompteurs).catch(() => setCompteurs([]));
  }, [tic]);

  if (!p) return erreur ? <div className="erreur">{erreur}</div> : null;
  const set = (k: keyof Parametres, v: unknown) => setP({ ...p, [k]: v } as Parametres);

  async function enregistrer() {
    if (!p) return;
    try {
      setP(await enregistrerParametres(p));
      setMessage('Réglages enregistrés.');
      window.setTimeout(() => setMessage(null), 3000);
    } catch (e) { setErreur((e as Error).message); }
  }

  function chargerLogo(f: File | undefined) {
    if (!f) return;
    const lecteur = new FileReader();
    lecteur.onload = () => set('logo_data_url', String(lecteur.result));
    lecteur.readAsDataURL(f);
  }

  const champ = (k: keyof Parametres, libelle: string, span = 1) => (
    <div style={{ gridColumn: `span ${span}` }}>
      <label>{libelle}</label>
      <input value={(p[k] as string) ?? ''} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  const zone = (k: keyof Parametres, libelle: string, rows = 3) => (
    <div style={{ gridColumn: 'span 4' }}>
      <label>{libelle}</label>
      <textarea rows={rows} value={(p[k] as string) ?? ''} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  const manque = (v: string | null) => !v || v.includes('[À COMPLÉTER');

  return (
    <>
      <div className="entete">
        <h1>Réglages</h1>
        <button className="action" onClick={() => void enregistrer()}>Enregistrer</button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}
      {message && (
        <div className="erreur" style={{ borderColor: 'var(--vert)', color: 'var(--vert)', background: '#f1f7f3' }}>
          {message}
        </div>
      )}

      <h2 style={{ marginBottom: 8 }}>Entreprise</h2>
      <div className="panneau" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {champ('raison_sociale', 'Raison sociale', 2)}
        {champ('forme_juridique', 'Forme juridique et capital', 2)}
        {champ('siret', 'SIRET')}
        {champ('rcs', 'RCS')}
        {champ('code_ape', 'Code APE')}
        {champ('tva_intracom', 'TVA intracommunautaire')}
        <div style={{ gridColumn: 'span 2' }}>
          <label>Adresse</label>
          <ChampAdresse valeur={p.adresse ?? ''} onChange={(v) => set('adresse', v)}
            onChoisir={(sug) => setP({
              ...p, adresse: sug.voie || sug.texte,
              code_postal: sug.codePostal || p.code_postal,
              ville: sug.ville || p.ville,
            } as Parametres)} />
        </div>
        {champ('code_postal', 'Code postal')}
        {champ('ville', 'Ville')}
        {champ('telephone', 'Téléphone')}
        {champ('portable', 'Portable')}
        {champ('email', 'E-mail')}
        {champ('site_web', 'Site web')}
        {champ('iban', 'IBAN', 2)}
        {champ('rge_qualification', 'Qualification RGE')}
        <div style={{ gridColumn: 'span 4' }}>
          <label>Logo, imprimé en tête de devis</label>
          <input type="file" accept="image/*" onChange={(e) => chargerLogo(e.target.files?.[0])} />
          {p.logo_data_url && (
            <img src={p.logo_data_url} alt="" style={{ maxHeight: 54, marginTop: 8, display: 'block' }} />
          )}
        </div>
      </div>

      <h2 style={{ marginBottom: 8 }}>Numérotation</h2>
      <p className="statut" style={{ marginBottom: 12 }}>
        Fabrice numérote déjà ses devis hors de Batinium. La numérotation doit reprendre
        la suite, jamais recommencer : une série qui repart de 1 est irrégulière.
      </p>
      <div className="panneau" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {champ('prefixe_devis', 'Préfixe des devis')}
        {champ('prefixe_chantier', 'Préfixe des chantiers')}
        {champ('prefixe_facture', 'Préfixe des factures')}
        <div>
          <label>Format</label>
          <select value={p.numero_avec_mois ? 'mois' : 'annee'}
                  onChange={(e) => set('numero_avec_mois', e.target.value === 'mois')}>
            <option value="mois">{p.prefixe_devis}-2026/09-0057</option>
            <option value="annee">{p.prefixe_devis}-2026-0057</option>
          </select>
        </div>

        <div style={{ gridColumn: 'span 4', borderTop: '1px solid var(--filet)', paddingTop: 12 }}>
          <strong style={{ fontSize: 13 }}>Reprendre la numérotation existante</strong>
          <p className="statut">
            Saisissez le numéro du dernier devis émis hors de Batinium. Le prochain
            portera le suivant. On ne peut que faire avancer le compteur, jamais le reculer :
            un numéro déjà attribué ne doit pas resservir.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'end', marginTop: 8 }}>
            <div style={{ width: 200 }}>
              <label>Dernier numéro utilisé</label>
              <input type="number" className="num" placeholder="56" value={reprise}
                     onChange={(e) => setReprise(e.target.value)} />
            </div>
            <button className="action" onClick={() => {
              const n = Number(reprise);
              if (!Number.isFinite(n) || n < 0) return setErreur('Saisissez un numéro valide.');
              setConfirmation(n);
            }}>Caler le compteur</button>
            <div className="statut">
              {compteurs.length === 0 ? 'Aucun numéro attribué cette année.'
                : compteurs.map((c) => `${c.type} : ${c.dernier}`).join(' · ')}
            </div>
          </div>
        </div>
      </div>

      {confirmation !== null && (
        <Modale titre="Confirmer la reprise de numérotation" taille="petite"
                onFermer={() => setConfirmation(null)}>
          <div className="erreur" style={{ borderColor: '#b8860b', color: 'var(--encre)',
                                           background: '#fdf7ee' }}>
            Cette opération n’est pas réversible.
          </div>
          <p>
            Le compteur des devis sera porté à <strong>{confirmation}</strong>.
            Le prochain devis émis portera donc le numéro{' '}
            <strong>{confirmation + 1}</strong>.
          </p>
          <p className="statut">
            On ne peut jamais faire reculer un compteur : un numéro déjà attribué ne doit
            pas resservir, sous peine de rendre la numérotation irrégulière. Si vous saisissez
            un chiffre trop élevé, il faudra vivre avec.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="action" onClick={() => {
              const n = confirmation;
              setConfirmation(null);
              void calerCompteur('devis', n)
                .then(() => { setReprise(''); setTic((t) => t + 1);
                              setMessage(`Le prochain devis portera le numéro ${n + 1}.`); })
                .catch((e) => setErreur((e as Error).message));
            }}>Je confirme, caler à {confirmation}</button>
            <button className="action discret" onClick={() => setConfirmation(null)}>
              Annuler
            </button>
          </div>
        </Modale>
      )}

      <h2 style={{ marginBottom: 8 }}>Mentions obligatoires</h2>
      <p className="statut" style={{ marginBottom: 12 }}>
        Ces quatre mentions manquent aux devis actuels de Pilotech. Une fois renseignées,
        elles s’impriment automatiquement.
      </p>
      <div className="panneau" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {champ('assureur_nom', 'Assureur décennale')}
        <div style={{ gridColumn: 'span 2' }}>
          <label>
            Adresse de l’assureur{' '}
            {manque(p.assureur_adresse) && <span style={{ color: 'var(--alerte)' }}>— à compléter</span>}
          </label>
          <input value={p.assureur_adresse ?? ''} onChange={(e) => set('assureur_adresse', e.target.value)} />
        </div>
        {champ('assureur_police', 'N° de contrat')}
        {champ('assureur_couverture', 'Couverture géographique', 2)}
        <div style={{ gridColumn: 'span 2' }}>
          <label>
            Médiateur de la consommation{' '}
            {manque(p.mediateur_nom) && <span style={{ color: 'var(--alerte)' }}>— à compléter</span>}
          </label>
          <input value={p.mediateur_nom ?? ''} onChange={(e) => set('mediateur_nom', e.target.value)} />
        </div>
        {champ('mediateur_url', 'Site du médiateur', 2)}
        {zone('delai_execution', 'Délai d’exécution', 2)}
        {zone('mention_retractation', 'Droit de rétractation', 3)}
        <div style={{ gridColumn: 'span 4' }}>
          <label style={{ color: 'var(--encre)' }}>
            <input type="checkbox" checked={p.afficher_retractation} style={{ width: 'auto', marginRight: 8 }}
                   onChange={(e) => set('afficher_retractation', e.target.checked)} />
            Imprimer la mention et le formulaire de rétractation sur les devis aux particuliers
          </label>
          <p className="statut">
            À laisser coché tant qu’un avocat n’a pas confirmé qu’une exception s’applique.
            Sans information écrite, le délai de rétractation ne court pas normalement.
          </p>
        </div>
      </div>

      <h2 style={{ marginBottom: 8 }}>Conditions générales</h2>
      <div className="panneau" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {zone('conditions_generales', 'Texte imprimé en fin de devis', 10)}
        <p className="statut" style={{ gridColumn: 'span 4' }}>
          Les conditions actuelles de Pilotech parlent de peinture, de robinetterie et de parois de
          douche : un modèle générique de rénovation jamais adapté à la climatisation. À faire
          réécrire par un avocat avant de le coller ici.
        </p>
      </div>

      <h2 style={{ marginBottom: 8 }}>Facturation</h2>
      <div className="panneau" style={{ display: 'block' }}>
        <div style={{ display: 'grid', gap: 12,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div>
            <label>Acompte proposé par défaut</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="number" min={0} max={100} step={1} className="num"
                     style={{ width: 90 }}
                     value={p.acompte_defaut_pct ?? 30}
                     onChange={(e) => set('acompte_defaut_pct', Number(e.target.value))} />
              <span className="statut">%</span>
            </div>
            <p className="statut">
              Modifiable à chaque facture. Ce n’est qu’une proposition.
            </p>
          </div>
          <div>
            <label>Délai de règlement</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="number" min={0} max={60} step={1} className="num"
                     style={{ width: 90 }}
                     value={p.delai_paiement_jours ?? 30}
                     onChange={(e) => set('delai_paiement_jours', Number(e.target.value))} />
              <span className="statut">jours</span>
            </div>
            <p className="statut">
              Trente jours est le délai supplétif du code de commerce, soixante le
              maximum entre professionnels. Un particulier paie à réception.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Mentions de retard, imprimées sur chaque facture</label>
          <textarea rows={4} value={p.penalites_retard ?? ''}
                    onChange={(e) => set('penalites_retard', e.target.value)} />
          <p className="statut">
            Ces mentions sont obligatoires. Le texte posé par défaut reprend les articles
            L. 441-10 et D. 441-5 du code de commerce : ne le videz pas sans le remplacer.
          </p>
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Autres mentions de règlement</label>
          <textarea rows={2} value={p.mentions_reglement ?? ''}
                    placeholder="Escompte, conditions particulières, référence à rappeler…"
                    onChange={(e) => set('mentions_reglement', e.target.value)} />
        </div>
      </div>

      <h2 style={{ marginBottom: 8 }}>Attestation de capacité fluides</h2>
      <div className="panneau" style={{ display: 'block' }}>
        <p className="statut" style={{ marginBottom: 12 }}>
          Celle de l’entreprise, à ne pas confondre avec l’attestation d’aptitude de chaque
          technicien. Valable cinq ans, avec un audit annuel de surveillance. Sans elle,
          l’entreprise ne peut plus acheter ni manipuler de fluide frigorigène : ce n’est
          pas une formalité, c’est l’activité qui s’arrête. La cloche prévient
          quatre-vingt-dix jours avant, parce que le renouvellement passe par un audit
          qui se planifie.
        </p>
        <div style={{ display: 'grid', gap: 12,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
          <div>
            <label>Numéro, imprimé en pied de devis</label>
            <input value={p.attestation_capacite ?? ''}
                   onChange={(e) => set('attestation_capacite', e.target.value)} />
          </div>
          <div>
            <label>Organisme agréé</label>
            <input value={p.attestation_capacite_organisme ?? ''} placeholder="Dekra, Apave…"
                   onChange={(e) => set('attestation_capacite_organisme', e.target.value)} />
          </div>
          <div>
            <label>Catégorie</label>
            <select value={p.attestation_capacite_categorie ?? ''}
                    onChange={(e) => set('attestation_capacite_categorie', e.target.value || null)}>
              <option value="">—</option>
              {['I', 'II', 'III', 'IV', 'V'].map((c) => <option key={c} value={c}>Catégorie {c}</option>)}
            </select>
          </div>
          <div>
            <label>Expire le</label>
            <input type="date" value={p.attestation_capacite_expire_le ?? ''}
                   onChange={(e) => set('attestation_capacite_expire_le', e.target.value || null)} />
            {p.attestation_capacite_expire_le && (() => {
              const jours = Math.ceil(
                (new Date(p.attestation_capacite_expire_le).getTime() - Date.now()) / 86400000);
              return (
                <p className="statut" style={{
                  color: jours <= 0 ? 'var(--alerte)' : jours <= 90 ? '#b8860b' : undefined,
                }}>
                  {jours <= 0 ? 'Périmée.' : `Encore ${jours} jours.`}
                </p>
              );
            })()}
          </div>
        </div>
        <p className="statut" style={{ marginTop: 10 }}>
          N’oubliez pas d’enregistrer les réglages après avoir changé ces champs.
        </p>

        <PiecesJointes cible={{ portee_entreprise: true }} presentation="bibliotheque"
                       types={PIECES_ENTREPRISE} titre="Pièces de l’entreprise"
                       onErreur={setErreur}
          aide="L’attestation elle-même, le Kbis, la RC pro, la décennale. Ce sont les
                pièces qu’un client professionnel ou un donneur d’ordre vous demandera,
                et qu’il vaut mieux ne pas chercher dans un classeur." />
      </div>

      <h2 style={{ marginBottom: 8 }}>Préalables de chantier</h2>
      <PreparationChantier onErreur={setErreur} />

      <h2 style={{ marginBottom: 8 }}>Équipe</h2>

      <div className="panneau" style={{ display: 'block' }}>
        <label>Coefficient de charges patronales</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="number" step="0.01" min="1" max="2" className="num"
                 style={{ width: 110 }}
                 value={p.coefficient_charges ?? 1.42}
                 onChange={(e) => set('coefficient_charges', Number(e.target.value))} />
          <span className="statut">
            1 000 € de brut coûtent environ{' '}
            {Math.round(1000 * (Number(p.coefficient_charges) || 1.42))} € à l’entreprise.
          </span>
        </div>
        <p className="statut" style={{ marginTop: 6 }}>
          Sert au prévisionnel de masse salariale, rien d’autre : Batinium ne calcule
          pas la paie, ne produit ni bulletin ni déclaration. Environ 1,42 pour un
          non-cadre au régime général, mais les allègements, la taille de l’entreprise
          et la convention collective le font bouger — demandez le vôtre à votre
          comptable. Le coût saisi salarié par salarié l’emporte toujours sur ce calcul.
        </p>
      </div>

      {entreprise && (
        <div className="panneau" style={{ display: 'block' }}>
          <label>Code d’invitation</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <strong style={{ fontSize: 24, letterSpacing: '.18em', fontVariantNumeric: 'tabular-nums' }}>
              {entreprise.code_invitation}
            </strong>
            <button className="action discret"
                    onClick={() => void navigator.clipboard.writeText(entreprise.code_invitation)}>
              Copier
            </button>
          </div>
          <p className="statut" style={{ marginTop: 6 }}>
            Donnez ce code à un salarié ou à un sous-traitant. Il crée son compte, saisit le code,
            et vous apparaissez ci-dessous pour lui attribuer un rôle. Rien ne lui est visible avant.
          </p>
        </div>
      )}

      {demandes.length > 0 && (
        <div className="panneau" style={{ display: 'block', borderLeft: '3px solid var(--alerte)' }}>
          <h3 style={{ marginBottom: 8 }}>
            {demandes.length} demande{demandes.length > 1 ? 's' : ''} en attente
          </h3>
          <table>
            <thead><tr><th>Nom</th><th>E-mail</th><th>Demandé le</th><th>Rôle à attribuer</th><th /></tr></thead>
            <tbody>
              {demandes.map((d) => <LigneDemande key={d.id} demande={d}
                onFait={() => setTic((t) => t + 1)} onErreur={setErreur} />)}
            </tbody>
          </table>
        </div>
      )}

      <table>
        <thead><tr><th>Nom</th><th>Rôle</th><th>Attestation fluides</th><th>Expire le</th><th>Actif</th></tr></thead>
        <tbody>
          {membres.map((m) => (
            <tr key={m.id}>
              <td>{m.nom}</td>
              <td>
                <select value={m.role}
                        onChange={(e) => void majMembre(m.id, { role: e.target.value as Role })
                          .then(() => setTic((t) => t + 1))
                          .catch((x) => setErreur((x as Error).message))}>
                  <option value="direction">direction</option>
                  <option value="chef_chantier">chef de chantier</option>
                  <option value="technicien">technicien</option>
                  <option value="sous_traitant">sous-traitant</option>
                </select>
              </td>
              <td className="ref">{m.aptitude_fluides_num ?? '—'}</td>
              <td className="ref">
                {m.aptitude_fluides_expire_le
                  ? new Date(m.aptitude_fluides_expire_le).toLocaleDateString('fr-FR') : '—'}
              </td>
              <td>
                <input type="checkbox" checked={m.actif} style={{ width: 'auto' }}
                       onChange={(e) => void majMembre(m.id, { actif: e.target.checked })
                         .then(() => setTic((t) => t + 1))
                         .catch((x) => setErreur((x as Error).message))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="statut" style={{ marginTop: 10 }}>
        Les techniciens ne voient ni les prix, ni les marges, ni les devis : la restriction est
        appliquée par la base de données, pas par l’interface.
      </p>
    </>
  );
}


function LigneDemande({ demande, onFait, onErreur }: {
  demande: Rattachement; onFait: () => void; onErreur: (m: string) => void;
}) {
  const [role, setRole] = useState<Role>('technicien');
  return (
    <tr>
      <td>{demande.nom}</td>
      <td className="ref">{demande.email ?? '—'}</td>
      <td className="ref">{new Date(demande.created_at).toLocaleDateString('fr-FR')}</td>
      <td>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="technicien">technicien</option>
          <option value="sous_traitant">sous-traitant</option>
          <option value="chef_chantier">chef de chantier</option>
          <option value="direction">direction</option>
        </select>
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button className="action" onClick={() =>
          void approuverRattachement(demande.id, role).then(onFait)
            .catch((e) => onErreur((e as Error).message))}>Accepter</button>{' '}
        <button className="action discret" onClick={() =>
          void refuserRattachement(demande.id).then(onFait)
            .catch((e) => onErreur((e as Error).message))}>Refuser</button>
      </td>
    </tr>
  );
}


// --- Préalables de chantier -------------------------------------------------

/**
 * La liste par défaut : ce qu'il faut avoir obtenu avant de planifier.
 *
 * Elle ne s'applique qu'aux chantiers créés ensuite. Chaque chantier emporte
 * sa copie à sa création et peut l'ajuster : changer d'avis sur
 * l'organisation ne doit pas rouvrir un chantier prêt à démarrer, ni décocher
 * ce qui a été obtenu.
 */
function PreparationChantier({ onErreur }: { onErreur: (m: string) => void }) {
  const [liste, setListe] = useState<Prealable[]>([]);
  const [ajout, setAjout] = useState('');
  const [travail, setTravail] = useState(false);

  const recharger = useCallback(async () => {
    try { setListe(await listerPrealables()); }
    catch (e) { onErreur((e as Error).message); }
  }, [onErreur]);

  useEffect(() => { void recharger(); }, [recharger]);

  async function ajouter() {
    const libelle = ajout.trim();
    if (!libelle) return;
    let cle = clePrealable(libelle);
    let n = 1;
    while (liste.some((x) => x.cle === cle)) cle = `${clePrealable(libelle)}_${++n}`;
    try {
      await enregistrerPrealable({
        cle, libelle, position: liste.length ? Math.max(...liste.map((x) => x.position)) + 1 : 0,
      });
      setAjout('');
      void recharger();
    } catch (e) { onErreur((e as Error).message); }
  }

  async function charger(jeu: string) {
    if (!window.confirm(
      `Remplacer la liste par « ${JEUX_PREALABLES[jeu].libelle} » ? Les chantiers déjà ouverts gardent la leur.`
    )) return;
    setTravail(true);
    try { await chargerJeuPrealables(jeu); void recharger(); }
    catch (e) { onErreur((e as Error).message); }
    setTravail(false);
  }

  return (
    <div className="panneau" style={{ display: 'block' }}>
      <p className="statut" style={{ marginBottom: 10 }}>
        Première cause de chantier bloqué après signature. Cette liste sert de point de
        départ : chaque nouveau chantier en reçoit une copie, qu’on ajuste ensuite au cas
        par cas. Les chantiers déjà ouverts ne bougent pas.
      </p>

      {liste.length === 0 ? (
        <div className="vide" style={{ padding: 18 }}>
          Aucun préalable. Chargez un jeu type ci-dessous, ou écrivez le vôtre.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Préalable</th>
              <th>Précision affichée sous le libellé</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {liste.map((x, i) => (
              <tr key={x.id}>
                <td className="num ref">{i + 1}</td>
                <td>
                  <input defaultValue={x.libelle} style={{ padding: '3px 5px' }}
                         onBlur={(e) => e.target.value !== x.libelle && e.target.value.trim()
                           && void enregistrerPrealable({ id: x.id, libelle: e.target.value })
                             .then(recharger)} />
                  {/* La clé ne se modifie pas : c'est elle qui porte les coches
                      des chantiers en cours. Renommer le libellé est sans risque. */}
                  <div className="ref">{x.cle}</div>
                </td>
                <td>
                  <input defaultValue={x.aide ?? ''} placeholder="—"
                         style={{ padding: '3px 5px', fontSize: 12 }}
                         onBlur={(e) => e.target.value !== (x.aide ?? '')
                           && void enregistrerPrealable({ id: x.id, aide: e.target.value || null })
                             .then(recharger)} />
                </td>
                <td>
                  <button className="action discret" style={{ padding: '2px 8px' }}
                          title="Retirer de la liste par défaut"
                          onClick={() => void supprimerPrealable(x.id).then(recharger)
                            .catch((e) => onErreur((e as Error).message))}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input placeholder="Ajouter un préalable" value={ajout} style={{ width: 300 }}
               onChange={(e) => setAjout(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && void ajouter()} />
        <button className="action" onClick={() => void ajouter()}>Ajouter</button>
      </div>

      <div style={{ marginTop: 14, borderTop: '1px solid var(--filet)', paddingTop: 12 }}>
        <label>Repartir d’un jeu type</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(JEUX_PREALABLES).map(([cle, jeu]) => (
            <button key={cle} className="action discret" disabled={travail}
                    onClick={() => void charger(cle)}>
              {jeu.libelle}
            </button>
          ))}
        </div>
        <p className="statut" style={{ marginTop: 6 }}>
          Remplace entièrement la liste ci-dessus. À faire une fois, au démarrage,
          puis à ajuster à la main.
        </p>
      </div>
    </div>
  );
}
