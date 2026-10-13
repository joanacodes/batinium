import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { voitLesPrix } from '../lib/session';
import { lienDocument, listerDocuments } from '../lib/db';
import { demanderIAFichier, IANonConfiguree } from '../lib/ia';
import {
  ajouterMachine, codeFluide, frequence, LIBELLES_FREQUENCE, listerFluides, listerMachines,
  machinesAvecPlaque, produitsFactures, tonnage, verifierMachine,
  type FluideFrigorigene, type Machine, type MachineAvecChantier, type SaisieMachine,
} from '../lib/machines';
import { creerFicheFluide, listerFichesFluide } from '../lib/fichesFluide';
import Modale from './Modale';
import Bulle from './Bulle';
import PiecesJointes from './PiecesJointes';

/**
 * Les machines d'un chantier.
 *
 * Elles naissent à la signature du devis, une par unité vendue, sans numéro
 * de série : celui-ci se relève sur la plaque, qui fait foi — elle l'emporte
 * sur le devis et sur la facture. Rien ici ne porte de prix : toute l'équipe
 * lit cette section, et c'est le technicien qui la remplit.
 */
export function MachinesChantier({ chantierId, siteId, onErreur }: {
  chantierId: string;
  siteId: string | null;
  onErreur: (message: string) => void;
}) {
  const [machines, setMachines] = useState<MachineAvecChantier[]>([]);
  const [plaques, setPlaques] = useState<Set<string>>(new Set());
  const [factures, setFactures] = useState<Set<string> | null>(null);
  const [charge, setCharge] = useState(false);
  const [ouverte, setOuverte] = useState<Machine | 'nouvelle' | null>(null);
  const [travail, setTravail] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try {
      const m = await listerMachines({ chantierId });
      setMachines(m);
      setPlaques(await machinesAvecPlaque(m.map((x) => x.id)));
      // Un technicien n'a pas accès aux achats : on ne cherche même pas, et
      // l'écran n'affichera aucun jugement de cohérence.
      setFactures(voitLesPrix() ? await produitsFactures(chantierId) : null);
    } catch (e) { onErreur((e as Error).message); }
    setCharge(true);
  }, [chantierId, onErreur]);

  useEffect(() => { void recharger(); }, [recharger]);

  /**
   * La fiche fluides d'une machine, hors intervention.
   *
   * On rouvre le brouillon qui existe plutôt que d'en créer un second : deux
   * brouillons pour la même machine, et l'un des deux finit signé pendant que
   * l'autre traîne, sans que personne sache lequel fait foi.
   */
  async function ficheFluide(m: Machine) {
    setTravail(m.id);
    try {
      const existantes = await listerFichesFluide({ equipementId: m.id });
      const brouillon = existantes.find((f) => f.statut === 'brouillon' && !f.intervention_id);
      aller(`/fluide/${brouillon?.id ?? await creerFicheFluide(m.id)}`);
    } catch (e) { onErreur((e as Error).message); }
    setTravail(null);
  }

  if (!charge) return <p className="statut">Chargement des machines…</p>;

  const aRelever = machines.filter((m) => !m.numero_serie || !plaques.has(m.id)).length;

  return (
    <>
      <p className="statut" style={{ marginBottom: 8 }}>
        Une ligne par appareil posé. Le numéro de série se recopie depuis la plaque
        signalétique, photo à l’appui : c’est elle qui fait foi pour la fiche Cerfa, la
        garantie et l’entretien.
        {aRelever > 0 && <> <strong>{aRelever} à relever sur place.</strong></>}
      </p>

      {machines.length === 0 ? (
        <div className="vide" style={{ padding: 18 }}>
          Aucune machine. Elles se créent à la signature du devis, une par unité vendue ;
          pour un appareil existant, ajoutez-le à la main.
        </div>
      ) : (
        <div className="tableau-defilant">
          <table>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Pièce</th>
                <th>Marque / modèle</th>
                <th style={{ width: 130 }}>N° de série</th>
                <th style={{ width: 110 }}>Fluide</th>
                <th className="num" style={{ width: 80 }}>t éq. CO2</th>
                <th style={{ width: 120 }}>Contrôle</th>
                <th style={{ width: 150 }}>État</th>
                <th style={{ width: 150 }} className="sans-impression" />
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => {
                const t = m.tonnage_co2 ?? tonnage(m.charge_kg, m.prp);
                const f = frequence(t, m.hermetique, m.detection_permanente);
                const verifiee = Boolean(m.numero_serie) && plaques.has(m.id);
                const incoherente = factures !== null && m.produit_id != null
                  && !factures.has(m.produit_id);
                return (
                  <tr key={m.id}>
                    <td>{m.piece ?? m.emplacement ?? '—'}</td>
                    <td>
                      {[m.marque, m.modele].filter(Boolean).join(' ') || '—'}
                      {m.puissance_kw != null && <div className="statut">{m.puissance_kw} kW</div>}
                    </td>
                    <td className="ref">{m.numero_serie ?? <span className="statut">à relever</span>}</td>
                    <td>
                      {m.fluide ?? '—'}
                      {m.charge_kg != null && <div className="statut">{Number(m.charge_kg)} kg</div>}
                    </td>
                    <td className="num">{t != null ? t.toLocaleString('fr-FR') : '—'}</td>
                    <td className="statut">{f ? LIBELLES_FREQUENCE[f] : 'charge inconnue'}</td>
                    <td>
                      {verifiee && m.verifie_le
                        ? <span className="jeton" data-r="recu">
                            vérifiée le {new Date(m.verifie_le).toLocaleDateString('fr-FR')}
                          </span>
                        : <span className="jeton" data-r="retard">à relever</span>}
                      {incoherente && (
                        <div style={{ marginTop: 4 }}>
                          <Bulle texte="Aucune facture fournisseur rapprochée ne porte ce produit sur ce chantier. Ce n’est pas bloquant : la plaque fait foi. Mais si l’appareil posé n’est pas celui du devis, c’est le moment de le voir.">
                            <span className="jeton" style={{ color: '#b8860b', borderColor: '#b8860b' }}>
                              facture ≠ devis
                            </span>
                          </Bulle>
                        </div>
                      )}
                    </td>
                    <td className="sans-impression" style={{ whiteSpace: 'nowrap' }}>
                      <button className="action discret" style={{ padding: '2px 9px' }}
                              onClick={() => setOuverte(m)}>Fiche</button>{' '}
                      <button className="action discret" style={{ padding: '2px 9px' }}
                              disabled={travail === m.id}
                              onClick={() => void ficheFluide(m)}>
                        {travail === m.id ? '…' : 'Fiche fluides'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <button className="action discret" style={{ marginTop: 8 }}
              onClick={() => setOuverte('nouvelle')}>
        Ajouter une machine
      </button>

      {ouverte && (
        <Modale titre={ouverte === 'nouvelle' ? 'Nouvelle machine' : 'Machine'} taille="large"
                onFermer={() => { setOuverte(null); void recharger(); }}>
          <FormulaireMachine machine={ouverte === 'nouvelle' ? null : ouverte}
                             cible={{ chantierId, siteId }} onErreur={onErreur}
                             onFait={() => { setOuverte(null); void recharger(); }} />
        </Modale>
      )}
    </>
  );
}

/**
 * Lire la plaque, et l'enregistrer.
 *
 * Exporté : la fiche fluides l'ouvre aussi, pour qu'une erreur sur la machine
 * se corrige à sa source et non dans la fiche. On ne corrige pas une adresse
 * dans une facture, on la corrige sur le client.
 */
export function FormulaireMachine({ machine, cible, onFait, onErreur }: {
  machine: Machine | null;
  cible: { chantierId?: string | null; siteId?: string | null };
  onFait: () => void;
  onErreur: (message: string) => void;
}) {
  const [m, setM] = useState<Machine | null>(machine);
  const [s, setS] = useState<SaisieMachine>(() => ({
    numero_serie: machine?.numero_serie ?? '',
    marque: machine?.marque ?? '',
    modele: machine?.modele ?? '',
    piece: machine?.piece ?? machine?.emplacement ?? '',
    fluide: machine?.fluide ?? '',
    charge_kg: machine?.charge_kg ?? null,
    puissance_kw: machine?.puissance_kw ?? null,
    hermetique: machine?.hermetique ?? false,
    detection_permanente: machine?.detection_permanente ?? false,
  }));
  const [fluides, setFluides] = useState<FluideFrigorigene[]>([]);
  const [plaque, setPlaque] = useState(false);
  const [travail, setTravail] = useState(false);
  const [lecture, setLecture] = useState<'idle' | 'en_cours' | 'faite'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const set = <K extends keyof SaisieMachine>(k: K, v: SaisieMachine[K]) =>
    setS((x) => ({ ...x, [k]: v }));

  const verifierPlaque = useCallback(async () => {
    if (!m) return;
    setPlaque((await machinesAvecPlaque([m.id])).has(m.id));
  }, [m]);

  useEffect(() => { void listerFluides().then(setFluides).catch(() => setFluides([])); }, []);
  useEffect(() => { void verifierPlaque(); }, [verifierPlaque]);

  const prp = fluides.find((f) => f.code === codeFluide(s.fluide))?.prp ?? null;
  const t = tonnage(s.charge_kg ?? null, prp);
  const freq = frequence(t, Boolean(s.hermetique), Boolean(s.detection_permanente));

  /** Une machine hors devis doit exister avant qu'on lui accroche une photo. */
  async function creer() {
    setTravail(true);
    try {
      const neuve = await ajouterMachine(cible, s);
      setM(neuve);
      setMessage('Machine créée. Photographiez maintenant sa plaque.');
    } catch (e) { onErreur((e as Error).message); }
    setTravail(false);
  }

  async function enregistrer() {
    if (!m) return creer();
    setTravail(true);
    try {
      const { verifiee } = await verifierMachine(m.id, s);
      if (verifiee) onFait();
      else {
        setMessage(!plaque
          ? 'Enregistré. Il manque la photo de la plaque pour que la machine soit vérifiée.'
          : 'Enregistré. Il manque le numéro de série pour que la machine soit vérifiée.');
      }
    } catch (e) { onErreur((e as Error).message); }
    setTravail(false);
  }

  /**
   * Proposer une lecture de la plaque par le modèle.
   *
   * Il ne remplit que les champs vides, jamais ceux déjà saisis : une valeur
   * tapée par quelqu'un qui a la plaque sous les yeux vaut plus qu'une lecture
   * de photo. Et la vérification reste un geste humain — rien n'est enregistré
   * avant le clic sur « Enregistrer ».
   */
  async function lirePlaque() {
    if (!m) return;
    setLecture('en_cours'); setMessage(null);
    try {
      const photo = (await listerDocuments({ equipement_id: m.id }))
        .find((d) => d.type === 'plaque_signaletique' && d.chemin);
      if (!photo?.chemin) throw new Error('Photographiez d’abord la plaque.');
      const blob = await (await fetch(await lienDocument(photo.chemin))).blob();
      const fichier = new File([blob], photo.nom, { type: photo.type_mime ?? blob.type ?? 'image/jpeg' });
      const lu = await demanderIAFichier<{
        marque: string | null; modele: string | null; numero_serie: string | null;
        fluide: string | null; charge_kg: number | null; puissance_kw: number | null;
      }>('plaque', fichier);
      setS((x) => ({
        ...x,
        marque: x.marque || lu.marque || '',
        modele: x.modele || lu.modele || '',
        numero_serie: x.numero_serie || lu.numero_serie || '',
        fluide: x.fluide || codeFluide(lu.fluide) || '',
        charge_kg: x.charge_kg ?? lu.charge_kg ?? null,
        puissance_kw: x.puissance_kw ?? lu.puissance_kw ?? null,
      }));
      setLecture('faite');
    } catch (e) {
      setLecture('idle');
      setMessage(e instanceof IANonConfiguree
        ? `${(e as Error).message} La saisie à la main fonctionne sans elle.`
        : (e as Error).message);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {m ? (
        <PiecesJointes cible={{ equipement_id: m.id }} presentation="galerie" accepte="image/*"
                       types={['plaque_signaletique']} titre="Photo de la plaque signalétique"
                       aide="Une photo nette, de face, où le numéro de série se lit. C’est elle qui fait foi."
                       onErreur={onErreur} onChange={() => void verifierPlaque()} />
      ) : (
        <p className="statut">
          Une machine hors devis — un appareil existant repris en entretien, par exemple.
          Créez-la, puis photographiez sa plaque.
        </p>
      )}

      {m && plaque && (
        <div>
          <button className="action discret" disabled={lecture === 'en_cours'}
                  onClick={() => void lirePlaque()}>
            {lecture === 'en_cours' ? 'Lecture…' : 'Lire la plaque'}
          </button>
          {lecture === 'faite' && (
            <span className="statut" style={{ marginLeft: 8, color: '#b8860b' }}>
              Proposé par l’IA, à relire avant d’enregistrer.
            </span>
          )}
        </div>
      )}

      <div>
        <label>Numéro de série</label>
        <input value={s.numero_serie ?? ''} autoComplete="off"
               style={{ fontSize: 18, fontFamily: 'ui-monospace, monospace', letterSpacing: 0.5 }}
               onChange={(e) => set('numero_serie', e.target.value)} />
        <p className="statut">
          Recopiez le numéro depuis la plaque. La plaque fait foi : elle l’emporte sur le
          devis et sur la facture.
        </p>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <label>Marque</label>
          <input value={s.marque ?? ''} onChange={(e) => set('marque', e.target.value)} />
        </div>
        <div>
          <label>Modèle</label>
          <input value={s.modele ?? ''} onChange={(e) => set('modele', e.target.value)} />
        </div>
        <div>
          <label>Pièce</label>
          <input value={s.piece ?? ''} placeholder="Séjour, chambre 1…"
                 onChange={(e) => set('piece', e.target.value)} />
        </div>
        <div>
          <label>Puissance (kW)</label>
          <input type="number" step="0.1" className="num" value={s.puissance_kw ?? ''}
                 onChange={(e) => set('puissance_kw', e.target.value ? Number(e.target.value) : null)} />
        </div>
        <div>
          <label>Fluide</label>
          <select value={codeFluide(s.fluide) ?? ''} onChange={(e) => set('fluide', e.target.value || null)}>
            <option value="">—</option>
            {fluides.map((f) => (
              <option key={f.code} value={f.code} disabled={!f.actif && codeFluide(s.fluide) !== f.code}>
                {f.libelle} — PRP {f.prp}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Charge totale (kg)</label>
          <input type="number" step="0.01" className="num" value={s.charge_kg ?? ''}
                 onChange={(e) => set('charge_kg', e.target.value ? Number(e.target.value) : null)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <label style={{ color: 'var(--encre)' }}>
          <input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={Boolean(s.hermetique)}
                 onChange={(e) => set('hermetique', e.target.checked)} />
          Hermétiquement scellé{' '}
          <Bulle texte="Un équipement hermétiquement scellé n’est soumis au contrôle d’étanchéité qu’à partir de 10 t éq. CO2, au lieu de 5.">
            <span className="statut">?</span>
          </Bulle>
        </label>
        <label style={{ color: 'var(--encre)' }}>
          <input type="checkbox" style={{ width: 'auto', marginRight: 6 }}
                 checked={Boolean(s.detection_permanente)}
                 onChange={(e) => set('detection_permanente', e.target.checked)} />
          Détection permanente de fuite{' '}
          <Bulle texte="Avec un système permanent de détection, la périodicité du contrôle d’étanchéité est doublée.">
            <span className="statut">?</span>
          </Bulle>
        </label>
      </div>

      <div className="panneau" style={{ display: 'block', margin: 0 }}>
        <span className="statut">Calculé</span>
        <div>
          {t != null ? `${t.toLocaleString('fr-FR')} t éq. CO2` : 'Tonnage inconnu : fluide et charge requis'}
          {freq && <> — contrôle d’étanchéité : <strong>{LIBELLES_FREQUENCE[freq].toLowerCase()}</strong></>}
        </div>
      </div>

      {message && <p className="statut" style={{ color: '#b8860b' }}>{message}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="action" disabled={travail} onClick={() => void enregistrer()}>
          {travail ? '…' : m ? 'Enregistrer' : 'Créer la machine'}
        </button>
      </div>
    </div>
  );
}

/**
 * Toutes les machines d'un client, tous chantiers confondus.
 *
 * En lecture : on les corrige sur leur chantier. C'est ce qu'on consulte
 * quand le client appelle pour une panne — « quel appareil, posé quand ».
 */
export function MachinesClient({ tiersId, onErreur }: {
  tiersId: string;
  onErreur: (message: string) => void;
}) {
  const [machines, setMachines] = useState<MachineAvecChantier[] | null>(null);

  useEffect(() => {
    listerMachines({ tiersId }).then(setMachines).catch((e) => {
      onErreur((e as Error).message); setMachines([]);
    });
  }, [tiersId, onErreur]);

  if (machines === null) return <p className="statut">Chargement…</p>;
  if (machines.length === 0) {
    return <p className="statut">Aucune machine posée chez ce client.</p>;
  }

  return (
    <div className="tableau-defilant">
      <table>
        <thead>
          <tr>
            <th>Machine</th>
            <th style={{ width: 130 }}>N° de série</th>
            <th style={{ width: 90 }}>Fluide</th>
            <th style={{ width: 110 }}>Mise en service</th>
            <th style={{ width: 120 }}>Chantier</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => (
            <tr key={m.id}>
              <td>
                {[m.marque, m.modele].filter(Boolean).join(' ') || '—'}
                {(m.piece ?? m.emplacement) && <div className="statut">{m.piece ?? m.emplacement}</div>}
              </td>
              <td className="ref">{m.numero_serie ?? <span className="statut">à relever</span>}</td>
              <td>{m.fluide ?? '—'}</td>
              <td className="num ref">
                {m.mise_en_service_le ? new Date(m.mise_en_service_le).toLocaleDateString('fr-FR') : '—'}
              </td>
              <td>
                {m.chantier
                  ? <a href={`#/chantiers/${m.chantier.id}`}>{m.chantier.numero}</a>
                  : <span className="statut">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
