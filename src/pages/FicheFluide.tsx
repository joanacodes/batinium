import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { chargerParametres, lienDocument, listerDocuments, listerMembres } from '../lib/db';
import type { Document, Membre, Parametres } from '../lib/types';
import {
  chargerMachine, LIBELLES_FREQUENCE, machinesAvecPlaque, type MachineAvecChantier,
} from '../lib/machines';
import {
  autocontrolesFiche, chargerFicheFluide, LIBELLES_STATUT_FICHE, majFicheFluide, NATURES,
  rafraichirFiche, rectificationDe, rectifierFicheFluide, signerFicheFluide,
  type FicheFluide, type FicheResumee, type Fuite, type NatureFluide,
} from '../lib/fichesFluide';
import FilAriane from '../components/FilAriane';
import Modale from '../components/Modale';
import Signature from '../components/Signature';
import { FormulaireMachine } from '../components/Machines';

/**
 * La fiche d'intervention fluides — Cerfa 15497*04.
 *
 * Deux visages pour la même fiche. En brouillon, un éditeur, avec en tête les
 * sept autocontrôles toujours visibles : on voit ce qui manque pendant qu'on
 * remplit, pas au moment de signer. Une fois signée, le document, rubrique
 * par rubrique dans l'ordre et les intitulés du Cerfa, et plus rien ne bouge.
 *
 * La mise en page officielle du formulaire n'est pas reproduite : c'est son
 * contenu et son ordre qui le sont. Savoir si l'organisme de contrôle accepte
 * cette reproduction est une question ouverte avec SOCOTEC.
 */
export default function PageFicheFluide({ ficheId }: { ficheId: string }) {
  const [f, setF] = useState<FicheFluide | null>(null);
  const [machine, setMachine] = useState<MachineAvecChantier | null>(null);
  const [plaque, setPlaque] = useState(false);
  const [technicien, setTechnicien] = useState<Membre | null>(null);
  const [parametres, setParametres] = useState<Parametres | null>(null);
  const [signatures, setSignatures] = useState<Document[]>([]);
  const [rectification, setRectification] = useState<FicheResumee | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistreA, setEnregistreA] = useState<Date | null>(null);
  const [signer, setSigner] = useState<'operateur' | 'detenteur' | null>(null);
  const [nomClient, setNomClient] = useState('');
  const [machineOuverte, setMachineOuverte] = useState(false);
  const [travail, setTravail] = useState(false);

  const recharger = useCallback(async () => {
    try {
      let fiche = await chargerFicheFluide(ficheId);
      // En brouillon, les rubriques 1 à 3 suivent la base : une machine
      // vérifiée depuis la création de la fiche doit y apparaître.
      if (fiche.statut === 'brouillon') {
        await rafraichirFiche(ficheId);
        fiche = await chargerFicheFluide(ficheId);
      }
      const [m, membres, p, docs, rect] = await Promise.all([
        chargerMachine(fiche.equipement_id),
        listerMembres().catch(() => []),
        chargerParametres().catch(() => null),
        listerDocuments({ fiche_fluide_id: ficheId }).catch(() => []),
        fiche.statut === 'rectifiee' ? rectificationDe(ficheId) : Promise.resolve(null),
      ]);
      setF(fiche);
      setMachine(m);
      setPlaque((await machinesAvecPlaque([m.id])).has(m.id));
      setTechnicien(membres.find((x) => x.id === fiche.technicien_id) ?? null);
      setParametres(p);
      setSignatures(docs.filter((d) => d.type === 'signature'));
      setRectification(rect);
      setNomClient((n) => n || fiche.detenteur?.nom || '');
    } catch (e) { setErreur((e as Error).message); }
  }, [ficheId]);

  useEffect(() => { void recharger(); }, [recharger]);

  async function patcher(patch: Partial<FicheFluide>, rafraichir = false) {
    if (!f) return;
    setF({ ...f, ...patch });
    try {
      await majFicheFluide(f.id, patch);
      // La détection permanente change la fréquence de contrôle : la base la
      // recalcule, on relit.
      if (rafraichir) await recharger();
      setEnregistreA(new Date());
    } catch (e) { setErreur((e as Error).message); }
  }

  async function apresSignature(qui: 'operateur' | 'detenteur') {
    if (!f) return;
    setTravail(true);
    try {
      await signerFicheFluide(f.id, qui, qui === 'detenteur' ? nomClient : technicien?.nom ?? undefined);
      setSigner(null);
      await recharger();
    } catch (e) {
      // La base a le dernier mot : si elle refuse, son message dit pourquoi.
      setSigner(null);
      setErreur((e as Error).message);
    }
    setTravail(false);
  }

  async function rectifier() {
    if (!f) return;
    if (!window.confirm(
      `Établir une fiche rectificative pour ${f.numero} ?\n\nLa fiche actuelle garde son numéro `
      + 'et passe en « rectifiée ». Une nouvelle fiche, copie de celle-ci, s’ouvre en brouillon '
      + 'et recevra son propre numéro à sa signature.')) return;
    try { aller(`/fluide/${await rectifierFicheFluide(f.id)}`); }
    catch (e) { setErreur((e as Error).message); }
  }

  if (!f) return erreur ? <div className="erreur">{erreur}</div> : <p className="statut">Chargement…</p>;

  const signeeOperateur = signatures.some((d) => d.legende === 'operateur');
  const signeeDetenteur = signatures.some((d) => d.legende === 'detenteur');
  const { controles, pretPourSignature } = autocontrolesFiche(
    f, machine, plaque, technicien, parametres,
    { operateur: signeeOperateur, detenteur: signeeDetenteur });

  const chantier = machine?.chantier ?? null;

  return (
    <>
      <FilAriane etapes={[
        { libelle: 'Chantiers', vers: '/chantiers' },
        ...(chantier ? [{ libelle: chantier.numero, vers: `/chantiers/${chantier.id}` }] : []),
        { libelle: 'Fiche fluides' },
        { libelle: f.numero ?? 'Brouillon' },
      ]} />

      <div className="entete sans-impression">
        <div>
          <h1>{f.numero ? `Fiche fluides ${f.numero}` : 'Fiche fluides — brouillon'}</h1>
          <div className="statut">
            {[f.equipement?.marque, f.equipement?.modele].filter(Boolean).join(' ') || 'Machine'}
            {f.equipement?.piece ? ` — ${f.equipement.piece}` : ''}
            {' · '}
            <span className="jeton" data-r={f.statut === 'signee' ? 'recu' : 'retard'}>
              {LIBELLES_STATUT_FICHE[f.statut]}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {f.statut === 'brouillon' && (
            <span className="statut">
              {enregistreA
                ? `Enregistré à ${enregistreA.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                : 'Enregistrement automatique'}
            </span>
          )}
          {f.statut !== 'brouillon' && (
            <button className="action discret" onClick={() => window.print()}>
              Imprimer ou enregistrer en PDF
            </button>
          )}
          {(f.statut === 'signee' || f.statut === 'signee_operateur') && (
            <button className="action discret" onClick={() => void rectifier()}>
              Fiche rectificative
            </button>
          )}
        </div>
      </div>

      {erreur && <div className="erreur sans-impression" onClick={() => setErreur(null)}>{erreur}</div>}

      {f.rectifie_id && (
        <div className="panneau sans-impression" style={{ display: 'block' }}>
          Cette fiche rectifie une fiche précédente.{' '}
          <a href={`#/fluide/${f.rectifie_id}`}>Voir la fiche d’origine</a>
        </div>
      )}
      {f.statut === 'rectifiee' && (
        <div className="panneau sans-impression" style={{ display: 'block',
                                                          borderLeft: '3px solid #b8860b' }}>
          Cette fiche a été rectifiée et ne change plus.
          {rectification && <> <a href={`#/fluide/${rectification.id}`}>
            Ouvrir la fiche rectificative {rectification.numero ?? '(brouillon)'}</a></>}
        </div>
      )}

      {f.statut === 'brouillon' ? (
        <Editeur f={f} machine={machine} controles={controles} pret={pretPourSignature}
                 onPatch={patcher} onCorrigerMachine={() => setMachineOuverte(true)}
                 onSigner={() => setSigner('operateur')} />
      ) : (
        <>
          {f.statut === 'signee_operateur' && (
            <div className="panneau sans-impression" style={{ display: 'flex', gap: 12,
                                                              alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1 }}>
                <span className="jeton" data-r="retard">en attente de signature du client</span>
                <span className="statut"> La fiche est numérotée et figée ; il manque le client.</span>
              </span>
              <button className="action" onClick={() => setSigner('detenteur')}>
                Faire signer le client
              </button>
            </div>
          )}
          <DocumentFiche f={f} signatures={signatures} />
        </>
      )}

      {signer && (
        <Modale titre={signer === 'operateur' ? 'Signature du technicien' : 'Signature du client'}
                onFermer={() => setSigner(null)}>
          {signer === 'operateur' && (
            <p className="statut" style={{ marginBottom: 10 }}>
              En signant, la fiche reçoit son numéro et ne peut plus être modifiée. Une
              erreur se corrigera par une fiche rectificative.
            </p>
          )}
          {travail ? <p className="statut">Enregistrement de la signature…</p> : (
            <Signature cible={{ fiche_fluide_id: f.id }} role={signer}
                       nom={signer === 'operateur' ? (technicien?.nom ?? '') : nomClient}
                       onNom={signer === 'detenteur' ? setNomClient : undefined}
                       onSignee={() => void apresSignature(signer)}
                       onAnnuler={() => setSigner(null)} onErreur={setErreur} />
          )}
        </Modale>
      )}

      {machineOuverte && machine && (
        <Modale titre="Corriger la machine" taille="large"
                onFermer={() => { setMachineOuverte(false); void recharger(); }}>
          <FormulaireMachine machine={machine}
                             cible={{ chantierId: machine.chantier_id, siteId: machine.site_id }}
                             onErreur={setErreur}
                             onFait={() => { setMachineOuverte(false); void recharger(); }} />
        </Modale>
      )}
    </>
  );
}

// --- L'éditeur ------------------------------------------------------------------

function Editeur({ f, machine, controles, pret, onPatch, onCorrigerMachine, onSigner }: {
  f: FicheFluide;
  machine: MachineAvecChantier | null;
  controles: ReturnType<typeof autocontrolesFiche>['controles'];
  pret: boolean;
  onPatch: (patch: Partial<FicheFluide>, rafraichir?: boolean) => Promise<void>;
  onCorrigerMachine: () => void;
  onSigner: () => void;
}) {
  const kg = (v: string) => (v === '' ? 0 : Math.max(0, Number(v.replace(',', '.')) || 0));
  const A = Number(f.charge_vierge) + Number(f.charge_recyclee) + Number(f.charge_regeneree);
  const E = Number(f.recup_traitement) + Number(f.recup_reutilisation);
  const manque = controles.slice(0, 6).find((c) => !c.ok);

  function basculerNature(n: NatureFluide) {
    const nature = f.nature.includes(n) ? f.nature.filter((x) => x !== n) : [...f.nature, n];
    void onPatch({ nature });
  }

  function majFuite(i: number, patch: Partial<Fuite>) {
    void onPatch({ fuites: f.fuites.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  }

  return (
    <>
      {/* Toujours en tête : on voit ce qui manque en remplissant, pas en signant. */}
      <div className="panneau" style={{ display: 'block',
                                        borderLeft: `3px solid ${pret ? 'var(--vert)' : '#b8860b'}` }}>
        <h3 style={{ marginBottom: 8 }}>Autocontrôles</h3>
        <div style={{ display: 'grid', gap: 4 }}>
          {controles.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span className="jeton" data-r={c.ok ? 'recu' : undefined}
                    style={c.ok ? undefined : { color: 'var(--encre-pale)' }}>
                {c.sansObjet ? 'sans objet' : c.ok ? 'fait' : 'à faire'}
              </span>
              <span style={c.ok ? undefined : { fontWeight: 600 }}>{i + 1}. {c.libelle}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="action" disabled={!pret} onClick={onSigner}>
            Signer en tant que technicien
          </button>
          {!pret && manque && (
            <span className="statut">Il manque : {manque.libelle.toLowerCase()}.</span>
          )}
        </div>
      </div>

      <Rubrique numero={1} titre="Opérateur (entreprise intervenante)">
        <Lecture f={f} partie="operateur" />
      </Rubrique>
      <Rubrique numero={2} titre="Détenteur (client, propriétaire de l’équipement)">
        <Lecture f={f} partie="detenteur" />
      </Rubrique>
      <Rubrique numero={3} titre="Équipement">
        <Lecture f={f} partie="equipement" />
        {machine && (
          <button className="lien-discret" style={{ marginTop: 6 }} onClick={onCorrigerMachine}>
            Corriger sur la machine
          </button>
        )}
        <p className="statut" style={{ marginTop: 4 }}>
          Ces trois rubriques se corrigent à leur source — la machine, le client, les
          paramètres de l’entreprise — et se figent à la signature.
        </p>
      </Rubrique>

      <Rubrique numero={4} titre="Nature de l’intervention">
        <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {NATURES.map((n) => (
            <label key={n.cle} style={{ color: 'var(--encre)' }}>
              <input type="checkbox" style={{ width: 'auto', marginRight: 8 }}
                     checked={f.nature.includes(n.cle)} onChange={() => basculerNature(n.cle)} />
              {n.libelle}
            </label>
          ))}
        </div>
        {f.nature.includes('autre') && (
          <input style={{ marginTop: 8 }} placeholder="Précisez" defaultValue={f.nature_autre ?? ''}
                 onBlur={(e) => void onPatch({ nature_autre: e.target.value || null })} />
        )}
      </Rubrique>

      <Rubrique numero={5} titre="Contrôle d’étanchéité">
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '2fr 1fr' }}>
          <div>
            <label>Détecteur manuel de fuite — identification</label>
            <input defaultValue={f.detecteur_identification ?? ''}
                   onBlur={(e) => void onPatch({ detecteur_identification: e.target.value || null })} />
          </div>
          <div>
            <label>Contrôlé le</label>
            <input type="date" defaultValue={f.detecteur_controle_le ?? ''}
                   onChange={(e) => void onPatch({ detecteur_controle_le: e.target.value || null })} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 10 }}>
          <OuiNon libelle="Système permanent de détection de fuite" valeur={f.detection_permanente}
                  onChange={(v) => void onPatch({ detection_permanente: v }, true)} />
          <OuiNon libelle="Fuites constatées" valeur={f.fuites_constatees}
                  onChange={(v) => void onPatch({ fuites_constatees: v })} />
        </div>
        <p className="statut" style={{ marginTop: 8 }}>
          Fréquence minimale du contrôle périodique :{' '}
          <strong>{f.frequence_applicable ? LIBELLES_FREQUENCE[f.frequence_applicable] : 'inconnue — charge ou fluide manquant'}</strong>
          {' '}(calculée depuis la machine).
        </p>
        {f.fuites_constatees && (
          <div style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Localisation de la fuite</th>
                  <th style={{ width: 120 }}>Réparation faite</th>
                  <th style={{ width: 130 }}>Réparation à faire</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {f.fuites.map((x, i) => (
                  <tr key={i}>
                    <td>
                      <input defaultValue={x.localisation} style={{ padding: '3px 6px' }}
                             onBlur={(e) => majFuite(i, { localisation: e.target.value })} />
                    </td>
                    <td><input type="checkbox" style={{ width: 'auto' }} checked={x.reparation_faite}
                               onChange={(e) => majFuite(i, { reparation_faite: e.target.checked })} /></td>
                    <td><input type="checkbox" style={{ width: 'auto' }} checked={x.reparation_a_faire}
                               onChange={(e) => majFuite(i, { reparation_a_faire: e.target.checked })} /></td>
                    <td>
                      <button className="action discret" style={{ padding: '2px 7px' }}
                              onClick={() => void onPatch({ fuites: f.fuites.filter((_, j) => j !== i) })}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="action discret" style={{ marginTop: 6 }}
                    onClick={() => void onPatch({ fuites: [...f.fuites,
                      { localisation: '', reparation_faite: false, reparation_a_faire: false }] })}>
              Ajouter une fuite
            </button>
          </div>
        )}
      </Rubrique>

      <Rubrique numero={6} titre="Manipulation du fluide frigorigène (kg)">
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <strong>Quantité chargée totale (A = B + C + D) : {A.toLocaleString('fr-FR')} kg</strong>
            <Kg libelle="dont fluide vierge (B)" valeur={f.charge_vierge}
                onChange={(v) => void onPatch({ charge_vierge: kg(v) })} />
            <Kg libelle="dont fluide recyclé (C)" valeur={f.charge_recyclee}
                onChange={(v) => void onPatch({ charge_recyclee: kg(v) })} />
            <Kg libelle="dont fluide régénéré (D)" valeur={f.charge_regeneree}
                onChange={(v) => void onPatch({ charge_regeneree: kg(v) })} />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <strong>Quantité récupérée totale (E = F + G) : {E.toLocaleString('fr-FR')} kg</strong>
            <Kg libelle="destinée au traitement (F)" valeur={f.recup_traitement}
                onChange={(v) => void onPatch({ recup_traitement: kg(v) })} />
            <Kg libelle="conservée pour réutilisation (G)" valeur={f.recup_reutilisation}
                onChange={(v) => void onPatch({ recup_reutilisation: kg(v) })} />
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr', marginTop: 12 }}>
          <div>
            <label>Identification du/des contenant(s)</label>
            <input defaultValue={f.contenants ?? ''}
                   onBlur={(e) => void onPatch({ contenants: e.target.value || null })} />
          </div>
          <div>
            <label>Dénomination ADR/RID</label>
            <input defaultValue={f.denomination_adr ?? ''}
                   onBlur={(e) => void onPatch({ denomination_adr: e.target.value || null })} />
          </div>
          <div>
            <label>Installation de destination du fluide récupéré</label>
            <input defaultValue={f.destination ?? ''}
                   onBlur={(e) => void onPatch({ destination: e.target.value || null })} />
          </div>
          <div>
            <label>N° BSFF</label>
            <input defaultValue={f.bsff ?? ''} placeholder="Bordereau Trackdéchets"
                   onBlur={(e) => void onPatch({ bsff: e.target.value || null })} />
          </div>
        </div>
      </Rubrique>

      <Rubrique numero={7} titre="Observations">
        <textarea rows={3} defaultValue={f.observations ?? ''}
                  onBlur={(e) => void onPatch({ observations: e.target.value || null })} />
      </Rubrique>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr', margin: '10px 0 24px' }}>
        <div>
          <label>Date de l’intervention</label>
          <input type="date" defaultValue={f.date_intervention}
                 onChange={(e) => e.target.value && void onPatch({ date_intervention: e.target.value }, true)} />
        </div>
      </div>
    </>
  );
}

function Rubrique({ numero, titre, children }: { numero: number; titre: string; children: React.ReactNode }) {
  return (
    <div className="panneau" style={{ display: 'block' }}>
      <h3 style={{ marginBottom: 10 }}>{numero}. {titre}</h3>
      {children}
    </div>
  );
}

function Kg({ libelle, valeur, onChange }: { libelle: string; valeur: number; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ flex: 1 }} className="statut">{libelle}</span>
      <input type="number" step="0.001" min={0} className="num" style={{ width: 110 }}
             defaultValue={Number(valeur) || ''} onBlur={(e) => onChange(e.target.value)} />
    </div>
  );
}

function OuiNon({ libelle, valeur, onChange }: {
  libelle: string; valeur: boolean | null; onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <span className="statut">{libelle}</span>
      <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
        {[true, false].map((v) => (
          <label key={String(v)} style={{ color: 'var(--encre)' }}>
            <input type="radio" style={{ width: 'auto', marginRight: 6 }}
                   checked={valeur === v} onChange={() => onChange(v)} />
            {v ? 'oui' : 'non'}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Les rubriques 1 à 3 en lecture, telles que la base les a copiées. */
function Lecture({ f, partie }: { f: FicheFluide; partie: 'operateur' | 'detenteur' | 'equipement' }) {
  const lignes: [string, string | number | null | undefined][] =
    partie === 'operateur' ? [
      ['Entreprise', f.operateur.raison_sociale],
      ['Adresse', f.operateur.adresse],
      ['SIRET', f.operateur.siret],
      ['Attestation de capacité', [f.operateur.attestation_capacite, f.operateur.attestation_capacite_organisme,
        f.operateur.attestation_capacite_categorie && `catégorie ${f.operateur.attestation_capacite_categorie}`,
        f.operateur.attestation_capacite_expire_le && `valable jusqu’au ${dateFr(f.operateur.attestation_capacite_expire_le)}`]
        .filter(Boolean).join(' — ')],
      ['Technicien', f.operateur.technicien?.nom],
      ['N° certificat d’aptitude', f.operateur.technicien?.aptitude_fluides_num],
    ] : partie === 'detenteur' ? [
      ['Nom / raison sociale', f.detenteur.nom],
      ['SIRET', f.detenteur.siret],
      ['Adresse de l’installation', f.detenteur.adresse],
      ['Téléphone', f.detenteur.telephone],
    ] : [
      ['Marque / modèle', [f.equipement.marque, f.equipement.modele].filter(Boolean).join(' ')],
      ['N° de série', f.equipement.numero_serie],
      ['Localisation (pièce)', f.equipement.piece],
      ['Fluide', f.equipement.fluide && `${f.equipement.fluide}${f.equipement.prp != null ? ` (PRP ${f.equipement.prp})` : ''}`],
      ['Charge totale', f.equipement.charge_kg != null ? `${f.equipement.charge_kg} kg` : null],
      ['Tonnage équivalent CO2', f.equipement.tonnage_co2 != null ? `${f.equipement.tonnage_co2} t éq. CO2` : null],
      ['Hermétiquement scellé', f.equipement.hermetique == null ? null : f.equipement.hermetique ? 'oui' : 'non'],
    ];
  return (
    <table>
      <tbody>
        {lignes.map(([l, v]) => (
          <tr key={l}>
            <td className="statut" style={{ width: 210 }}>{l}</td>
            <td>{v || <span style={{ color: 'var(--alerte)' }}>non renseigné</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Le document --------------------------------------------------------------

function DocumentFiche({ f, signatures }: { f: FicheFluide; signatures: Document[] }) {
  const [images, setImages] = useState<Record<string, string>>({});

  // La dernière signature de chaque rôle : un tracé raté puis refait laisse
  // deux images, et c'est la seconde qui vaut.
  useEffect(() => {
    const parRole = new Map<string, Document>();
    for (const d of [...signatures].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      if (d.legende && d.chemin) parRole.set(d.legende, d);
    }
    void Promise.all([...parRole.entries()].map(async ([role, d]) =>
      [role, await lienDocument(d.chemin!).catch(() => '')] as const))
      .then((paires) => setImages(Object.fromEntries(paires)));
  }, [signatures]);

  const o = f.operateur, d = f.detenteur, e = f.equipement;
  const t = Number(e.tonnage_co2 ?? NaN);
  const seuil = e.hermetique ? 10 : 5;
  // Les cases du Cerfa sont les fréquences de base ; la détection permanente
  // se coche à part et double la durée.
  const caseFrequence = Number.isNaN(t) ? null
    : t < seuil ? 'non' : t < 50 ? '12' : t < 500 ? '6' : '3';
  const coche = (oui: boolean) => (oui ? '☒' : '☐');

  return (
    <div className="document">
      <div className="doc-titre" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Fiche d’intervention — fluides frigorigènes</h2>
          <div className="doc-petit">
            Modèle Cerfa n° 15497*04 — art. R.543-82 du Code de l’environnement, arrêté du
            29 février 2016<br />
            Équipement de réfrigération, climatisation ou pompe à chaleur
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="doc-petit">Fiche n°</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{f.numero}</div>
          <div className="doc-petit">du {dateFr(f.date_intervention)}</div>
        </div>
      </div>

      <TitreRubrique n={1} titre="Opérateur (entreprise intervenante)" note="titulaire de l’attestation de capacité" />
      <div className="doc-petit">
        <strong>{o.raison_sociale}</strong> — {o.adresse}<br />
        SIRET : {o.siret ?? '—'} · Tél : {[o.telephone, o.portable].filter(Boolean).join(' / ') || '—'}<br />
        Attestation de capacité n° {o.attestation_capacite ?? '—'}
        {o.attestation_capacite_organisme && ` — ${o.attestation_capacite_organisme}`}
        {o.attestation_capacite_categorie && ` — Catégorie ${o.attestation_capacite_categorie}`}
        {o.attestation_capacite_expire_le && ` — valable jusqu’au ${dateFr(o.attestation_capacite_expire_le)}`}
      </div>
      <Champs paires={[['Technicien', o.technicien?.nom], ['N° certificat d’aptitude', o.technicien?.aptitude_fluides_num]]} />

      <TitreRubrique n={2} titre="Détenteur (client, propriétaire de l’équipement)" />
      <Champs paires={[['Nom / raison sociale', d.nom], ['SIRET', d.siret]]} />
      <Champs paires={[['Adresse de l’installation', d.adresse], ['Tél', d.telephone]]} />

      <TitreRubrique n={3} titre="Équipement" />
      <Champs paires={[['Marque / modèle', [e.marque, e.modele].filter(Boolean).join(' ')], ['N° de série', e.numero_serie]]} />
      <Champs paires={[['Localisation (pièce)', e.piece], ['Fluide', e.fluide && `${e.fluide}${e.prp != null ? ` (PRP ${e.prp})` : ''}`],
                       ['Charge totale', e.charge_kg != null ? `${e.charge_kg} kg` : null]]} />
      <Champs paires={[['Tonnage équivalent CO2', e.tonnage_co2 != null ? `${e.tonnage_co2} t éq. CO2` : null],
                       ['Équipement hermétiquement scellé', `${coche(e.hermetique === true)} oui  ${coche(e.hermetique === false)} non`]]} />

      <TitreRubrique n={4} titre="Nature de l’intervention" />
      <div className="doc-petit" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
        {NATURES.map((n) => (
          <span key={n.cle}>{coche(f.nature.includes(n.cle))} {n.libelle}
            {n.cle === 'autre' && f.nature_autre ? ` : ${f.nature_autre}` : ''}</span>
        ))}
      </div>

      <TitreRubrique n={5} titre="Contrôle d’étanchéité" />
      <Champs paires={[['Détecteur manuel de fuite — identification', f.detecteur_identification],
                       ['contrôlé le', f.detecteur_controle_le && dateFr(f.detecteur_controle_le)]]} />
      <div className="doc-petit">
        Système permanent de détection de fuite : {coche(f.detection_permanente === true)} oui{' '}
        {coche(f.detection_permanente === false)} non<br />
        Fréquence minimale du contrôle périodique :{' '}
        {coche(caseFrequence === '12')} 12 mois (5 à &lt; 50 t éq. CO2){' '}
        {coche(caseFrequence === '6')} 6 mois (50 à &lt; 500 t éq. CO2){' '}
        {coche(caseFrequence === '3')} 3 mois (≥ 500 t éq. CO2){' '}
        {coche(caseFrequence === 'non')} Non soumis (&lt; 5 t éq. CO2, ou &lt; 10 t si hermétiquement scellé)<br />
        <span style={{ fontStyle: 'italic' }}>Avec détection permanente : fréquence doublée (24 / 12 / 6 mois).</span><br />
        Fuites constatées : {coche(f.fuites_constatees === true)} oui {coche(f.fuites_constatees === false)} non
      </div>
      {f.fuites.length > 0 && (
        <table className="doc-table">
          <thead>
            <tr><th>Localisation de la fuite</th><th style={{ width: 110 }}>Réparation faite</th>
                <th style={{ width: 120 }}>Réparation à faire</th></tr>
          </thead>
          <tbody>
            {f.fuites.map((x, i) => (
              <tr key={i}><td>{x.localisation}</td><td>{coche(x.reparation_faite)}</td>
                  <td>{coche(x.reparation_a_faire)}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <TitreRubrique n={6} titre="Manipulation du fluide frigorigène" note="quantités en kg" />
      <table className="doc-table">
        <tbody>
          <tr><td><strong>Quantité CHARGÉE totale (A = B + C + D)</strong></td><td className="num">{kg(f.charge_totale)}</td>
              <td><strong>Quantité RÉCUPÉRÉE totale (E = F + G)</strong></td><td className="num">{kg(f.recup_totale)}</td></tr>
          <tr><td>dont fluide vierge (B)</td><td className="num">{kg(f.charge_vierge)}</td>
              <td>destinée au traitement (F)</td><td className="num">{kg(f.recup_traitement)}</td></tr>
          <tr><td>dont fluide recyclé (C)</td><td className="num">{kg(f.charge_recyclee)}</td>
              <td>conservée pour réutilisation (G)</td><td className="num">{kg(f.recup_reutilisation)}</td></tr>
          <tr><td>dont fluide régénéré (D)</td><td className="num">{kg(f.charge_regeneree)}</td><td /><td /></tr>
        </tbody>
      </table>
      <Champs paires={[['Identification du/des contenant(s)', f.contenants]]} />
      <Champs paires={[['Dénomination ADR/RID', f.denomination_adr]]} />
      <Champs paires={[['Installation de destination du fluide récupéré', f.destination], ['N° BSFF', f.bsff]]} />

      <TitreRubrique n={7} titre="Observations" />
      <div className="doc-encadre" style={{ minHeight: 40, whiteSpace: 'pre-line' }}>{f.observations ?? ''}</div>

      <TitreRubrique n={8} titre="Signatures" />
      <div className="doc-signature">
        <div>
          <strong>OPÉRATEUR (technicien)</strong>
          <div className="doc-petit">Nom : {f.signature_operateur_nom ?? ''} — Date : {f.signature_operateur_le ? dateFr(f.signature_operateur_le) : ''}</div>
          <div className="doc-cadre" style={{ display: 'grid', placeItems: 'center' }}>
            {images.operateur && <img src={images.operateur} alt="Signature du technicien" style={{ maxHeight: 84, maxWidth: '100%' }} />}
          </div>
        </div>
        <div>
          <strong>DÉTENTEUR (client)</strong>
          <div className="doc-petit">Nom : {f.signature_detenteur_nom ?? ''} — Date : {f.signature_detenteur_le ? dateFr(f.signature_detenteur_le) : ''}</div>
          <div className="doc-cadre" style={{ display: 'grid', placeItems: 'center' }}>
            {images.detenteur && <img src={images.detenteur} alt="Signature du client" style={{ maxHeight: 84, maxWidth: '100%' }} />}
          </div>
        </div>
      </div>

      <footer className="doc-pied">
        Fiche établie en deux exemplaires, conservée 5 ans par l’opérateur et par le détenteur.
        Un exemplaire est remis au détenteur à l’issue de l’intervention.
        {f.statut === 'rectifiee' && <><br /><strong>Fiche rectifiée — remplacée par une fiche rectificative.</strong></>}
      </footer>
      {/* TODO (phase ultérieure) : ranger le PDF dans la bibliothèque, aux deux
          exemplaires, par une génération côté serveur. L'impression du
          navigateur suffit tant que cette génération n'existe pas — elle ne
          peut pas produire un fichier que la base conserverait elle-même. */}
    </div>
  );
}

function TitreRubrique({ n, titre, note }: { n: number; titre: string; note?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  background: 'var(--encre)', color: '#fff', padding: '3px 8px', margin: '12px 0 6px',
                  fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
      <span>{n}. {titre}</span>
      {note && <span style={{ fontWeight: 400, textTransform: 'none' }}>{note}</span>}
    </div>
  );
}

function Champs({ paires }: { paires: [string, string | null | undefined][] }) {
  return (
    <div className="doc-petit" style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '2px 0' }}>
      {paires.map(([l, v]) => (
        <span key={l}><strong>{l} :</strong> {v || '—'}</span>
      ))}
    </div>
  );
}

const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');
const kg = (v: number | null | undefined) => `${Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} kg`;
