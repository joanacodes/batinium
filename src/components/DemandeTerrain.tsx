import { useState } from 'react';
import {
  enregistrerDemande, LIBELLE_SUITE, libelleEnvoi, noterAuJournal, reserverEnvois, TAILLE_MAXIMALE,
} from '../lib/db';
import type { Site, SuiteDemande } from '../lib/types';
import Modale from './Modale';
import Dictee from './Dictee';
import ChoixMedias from './ChoixMedias';

const AIDE_SUITE: Record<SuiteDemande, string> = {
  a_facturer: 'Du travail en plus sur ce chantier, fait ou à faire',
  sav: 'Un défaut à reprendre sur ce qui a été posé',
  nouveau_devis: 'Autre chose, à chiffrer',
};

/**
 * « Le client demande autre chose. »
 *
 * Sur place, le client — ou le client du client : l'occupant, le voisin, le
 * syndic — veut quelque chose en plus. Le technicien le note ici, avec des
 * photos, et la demande arrive au bureau dans la même liste que les appels.
 *
 * Aucun prix : c'est un écran de terrain (règle 8). Le bureau chiffre.
 * Aucune ressaisie quand c'est le client du chantier : la demande pointe sa
 * fiche (règle 3). Les coordonnées ne se tapent que pour quelqu'un d'autre.
 */
export default function DemandeTerrain({ chantier, site, interventionId, onFermer, onCree }: {
  chantier: { id: string; numero: string; tiers_id: string | null; tiers?: { nom: string } | null };
  site?: Site | null;
  interventionId?: string | null;
  onFermer: () => void;
  onCree: () => void;
}) {
  const [suite, setSuite] = useState<SuiteDemande | null>(null);
  const [qui, setQui] = useState<'client' | 'autre'>(chantier.tiers_id ? 'client' : 'autre');
  const [contact, setContact] = useState({
    nom: '', telephone: '', email: '',
    adresse: [site?.adresse, site?.code_postal, site?.ville].filter(Boolean).join(' '),
  });
  const [texte, setTexte] = useState('');
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [part, setPart] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  // Une fois la demande créée, un nouvel essai ne la recrée pas : seules les
  // photos repartent. Sans ça, un envoi coupé en sous-sol donnait deux demandes.
  const [demandeId, setDemandeId] = useState<string | null>(null);

  async function transmettre() {
    if (!suite) return setErreur('Choisissez ce que la demande appelle : à facturer, SAV ou nouveau devis.');
    if (!texte.trim() && fichiers.length === 0) {
      return setErreur('Dites en une phrase ce que le client veut, ou joignez une photo.');
    }
    if (qui === 'autre' && (!contact.nom.trim() || !(contact.telephone.trim() || contact.email.trim()))) {
      return setErreur('Pour quelqu’un d’autre que le client, il faut son nom et un téléphone ou un e-mail.');
    }

    const tropLourd = fichiers.find((f) => f.size > TAILLE_MAXIMALE);
    if (tropLourd) {
      return setErreur(`« ${tropLourd.name} » dépasse ${TAILLE_MAXIMALE / 1048576} Mo : retirez-le `
        + 'ou filmez plus court.');
    }

    setEnvoi(true); setErreur(null);
    try {
      // Les vidéos sont annoncées à Supabase avant que la demande ne s'écrive :
      // refusées, elles ne laissent pas une demande sans ses photos.
      const reserves = await reserverEnvois({ chantier_id: chantier.id }, fichiers);
      const besoin = texte.trim() || '(voir les photos)';
      const id = demandeId ?? (await enregistrerDemande({
        source: 'terrain', statut: 'nouvelle', urgence: 'projet', repondu: false,
        suite, besoin, chantier_id: chantier.id, intervention_id: interventionId ?? null,
        ...(qui === 'client'
          ? { tiers_id: chantier.tiers_id }
          : {
              nom: contact.nom.trim(), telephone: contact.telephone.trim() || null,
              email: contact.email.trim() || null, adresse: contact.adresse.trim() || null,
            }),
      })).id;
      setDemandeId(id);
      // La même chose dans le journal du chantier, photos comprises : c'est
      // là que l'équipe la retrouvera en reprenant le chantier.
      await noterAuJournal({
        chantierId: chantier.id, tiersId: chantier.tiers_id,
        texte: `Demande sur place — ${LIBELLE_SUITE[suite]}`
          + `${qui === 'autre' ? ` (pour ${contact.nom.trim()})` : ''} : ${besoin}`,
        fichiers, demandeId: id, onProgression: setPart, reserves,
      });
      onCree();
    } catch (e) {
      const m = (e as Error).message;
      // Seules les erreurs de schéma disent « SQL 36 absent » : les messages
      // d'envoi citent le nom du fichier, et une « suite-parentale.mov »
      // refusée ne doit pas envoyer chercher un script.
      setErreur(/schema cache|"(suite|chantier_id|intervention_id|demande_id)" of relation/i.test(m)
        ? 'Les demandes du terrain demandent le SQL 36 : exécutez-le dans Supabase.' : m);
      setEnvoi(false);
      setPart(null);
    }
  }

  return (
    <Modale titre="Le client demande autre chose" onFermer={onFermer}>
      {erreur && <div className="erreur">{erreur}</div>}

      <label>Ce que la demande appelle</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
        {(Object.keys(LIBELLE_SUITE) as SuiteDemande[]).map((s) => (
          <button key={s} className={`action ${suite === s ? '' : 'discret'}`}
                  style={{ textAlign: 'left', padding: '10px 12px' }}
                  aria-pressed={suite === s} onClick={() => setSuite(s)}>
            <strong style={{ display: 'block' }}>{LIBELLE_SUITE[s]}</strong>
            <span style={{ fontSize: 12, opacity: 0.85 }}>{AIDE_SUITE[s]}</span>
          </button>
        ))}
      </div>

      <label style={{ marginTop: 14 }}>Qui le demande</label>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {chantier.tiers_id && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--encre)' }}>
            <input type="radio" style={{ width: 'auto' }} checked={qui === 'client'}
                   onChange={() => setQui('client')} />
            Le client du chantier{chantier.tiers?.nom ? ` (${chantier.tiers.nom})` : ''}
          </label>
        )}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--encre)' }}>
          <input type="radio" style={{ width: 'auto' }} checked={qui === 'autre'}
                 onChange={() => setQui('autre')} />
          Quelqu’un d’autre : occupant, voisin, syndic…
        </label>
      </div>

      {qui === 'autre' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: 8, marginTop: 8 }}>
          <div><label>Nom</label>
            <input value={contact.nom} autoComplete="off"
                   onChange={(e) => setContact((c) => ({ ...c, nom: e.target.value }))} /></div>
          <div><label>Téléphone</label>
            <input type="tel" value={contact.telephone} autoComplete="off"
                   onChange={(e) => setContact((c) => ({ ...c, telephone: e.target.value }))} /></div>
          <div><label>E-mail</label>
            <input type="email" value={contact.email} autoComplete="off"
                   onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} /></div>
          <div><label>Adresse</label>
            <input value={contact.adresse}
                   onChange={(e) => setContact((c) => ({ ...c, adresse: e.target.value }))} /></div>
        </div>
      )}

      <label style={{ marginTop: 14 }}>Ce qu’il veut</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
        <textarea rows={3} value={texte} style={{ flex: 1 }}
                  placeholder="Une deuxième clim dans la chambre du fond, même modèle"
                  onChange={(e) => setTexte(e.target.value)} />
        <Dictee onErreur={setErreur} onTexte={(t) => setTexte((x) => (x ? `${x} ${t}` : t))} />
      </div>

      <div style={{ marginTop: 12 }}>
        <ChoixMedias fichiers={fichiers} onChange={setFichiers} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="action" disabled={envoi} onClick={() => void transmettre()}>
          {envoi ? libelleEnvoi(fichiers.length ? part : null) : 'Transmettre au bureau'}
        </button>
        <button className="action discret" disabled={envoi} onClick={onFermer}>Annuler</button>
      </div>
      <p className="statut" style={{ marginTop: 8 }}>
        La demande arrive dans Demandes, rattachée au chantier {chantier.numero}, et dans son
        journal avec les photos.
      </p>
    </Modale>
  );
}
