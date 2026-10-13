import {
  ajouterFil, chargerFacture, listerChantiers, listerDemandes, listerDocumentsAEcheance,
  listerEncaissements, listerFactures, listerPointages, listerPrealables, listerTaches,
  majDevis, chargerDevis, listerDevis, prealablesDu, heuresLisibles, LIBELLES_DOCUMENT,
} from './db';
import { demanderIAJson } from './ia';
import { creerBrouillonDicte, type PropositionDevis } from './devisDicte';
import { membre as moi, voitLesPrix } from './session';

/**
 * L'assistant de Batinium.
 *
 * Il lit, il ne fabrique rien. Une question en français, une réponse tirée
 * des données réelles, et des liens vers les pages concernées.
 *
 * -----------------------------------------------------------------------------
 * POURQUOI LE CONTEXTE EST RASSEMBLÉ ICI, ET NON SUR LE SERVEUR
 *
 * Le navigateur lit la base avec les droits de la personne connectée : c'est
 * la RLS qui décide, table par table, ce qui remonte. Un technicien qui
 * demande « où en sont les devis » n'obtient rien, parce que son navigateur
 * n'a jamais pu lire un devis — pas parce qu'on aurait pensé à l'interdire à
 * l'assistant.
 *
 * Le cloisonnement de la base protège donc l'assistant sans qu'on ait à le
 * redire, et sans qu'on puisse l'oublier. Si on avait fait le contraire — une
 * fonction serveur qui interroge la base avec la clé de service — il aurait
 * fallu réécrire toutes les règles d'accès une seconde fois, dans le prompt.
 * Deux jeux de règles finissent toujours par diverger.
 *
 * Conséquence : le modèle ne voit jamais la base. Il reçoit un extrait déjà
 * filtré, et il ne peut rien demander de plus.
 * -----------------------------------------------------------------------------
 */

export interface ReponseAssistant {
  reponse: string;
  liens?: { libelle: string; url: string }[];
  note?: { cible: 'journal' | 'devis'; id: string; texte: string } | null;
  /** Proposition de devis, quand on lui a dicté un chantier à chiffrer. */
  devis?: PropositionDevis | null;
}

/** Bornes de taille : un extrait qui déborde coûte cher et ne sert à rien. */
const MAX_PAR_LISTE = 60;
const MAX_TEXTE = 220;

const court = (t: string | null | undefined) =>
  t ? t.replace(/\s+/g, ' ').slice(0, MAX_TEXTE) : null;

const jour = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Rassemble ce que la personne connectée a le droit de voir.
 *
 * Chaque bloc échoue silencieusement : un technicien n'a pas accès aux devis,
 * et l'assistant doit répondre quand même sur ce qu'il connaît plutôt que de
 * refuser en bloc.
 */
export async function contexteAssistant(): Promise<Record<string, unknown>> {
  const aujourdhui = jour(new Date());
  const ilYa7 = jour(new Date(Date.now() - 7 * 86400000));
  const prix = voitLesPrix();

  const [demandes, chantiers, taches, prealables, docs, devis, factures, enc, heures] =
    await Promise.all([
      listerDemandes().catch(() => []),
      listerChantiers().catch(() => []),
      listerTaches().catch(() => []),
      listerPrealables().catch(() => []),
      listerDocumentsAEcheance().catch(() => []),
      prix ? listerDevis().catch(() => []) : Promise.resolve([]),
      prix ? listerFactures().catch(() => []) : Promise.resolve([]),
      prix ? listerEncaissements().catch(() => []) : Promise.resolve([]),
      listerPointages({ depuis: ilYa7 }).catch(() => []),
    ]);

  const contexte: Record<string, unknown> = {
    aujourdhui,
    utilisateur: { nom: moi().nom, role: moi().role, voit_les_prix: prix },

    demandes_sans_reponse: demandes
      .filter((d) => !d.repondu && !['perdue', 'spam'].includes(d.statut))
      .slice(0, MAX_PAR_LISTE)
      .map((d) => ({
        nom: d.nom || d.tiers?.nom || null, telephone: d.telephone, recu_le: d.recu_le.slice(0, 10),
        besoin: court(d.besoin), urgence: d.urgence, statut: d.statut,
        rappeler_le: d.rappeler_le, url: '#/demandes',
      })),

    chantiers_ouverts: chantiers
      .filter((c) => c.statut !== 'receptionne')
      .slice(0, MAX_PAR_LISTE)
      .map((c) => {
        const liste = prealablesDu(c, prealables);
        const manquants = liste.filter((x) => !c.checklist?.[x.cle]).map((x) => x.libelle);
        return {
          numero: c.numero, libelle: c.libelle, client: c.tiers?.nom ?? null,
          statut: c.statut, debut: c.date_debut, fin_prevue: c.date_fin,
          prealables_manquants: manquants,
          url: `#/chantiers/${c.id}`,
        };
      }),

    taches_en_cours: taches.slice(0, MAX_PAR_LISTE).map((t) => ({
      titre: t.titre, echeance: t.echeance, priorite: t.priorite,
      en_retard: !!t.echeance && t.echeance < aujourdhui,
      url: '#/taches',
    })),

    documents_a_echeance: docs.slice(0, MAX_PAR_LISTE).map((d) => ({
      nature: LIBELLES_DOCUMENT[d.type]?.libelle ?? d.type,
      expire_le: d.expire_le,
      concerne: d.tiers_id ? 'sous-traitant' : d.membre_id ? 'salarié' : 'entreprise',
      url: d.tiers_id ? `#/soustraitant/${d.tiers_id}`
        : d.membre_id ? `#/equipe/${d.membre_id}` : '#/reglages',
    })),

    heures_sept_derniers_jours: {
      total: heuresLisibles(heures.reduce((s, p) => s + Number(p.heures), 0)),
      non_validees: heures.filter((p) => !p.valide).length,
      par_personne: [...heures.reduce((m, p) => {
        const nom = p.membre?.nom ?? 'inconnu';
        return m.set(nom, (m.get(nom) ?? 0) + Number(p.heures));
      }, new Map<string, number>())].map(([nom, h]) => ({ nom, heures: heuresLisibles(h) })),
      url: '#/heures',
    },
  };

  // Ce qui ne descend que vers ceux qui voient les prix. La RLS l'aurait de
  // toute façon refusé ; on évite juste des listes vides et bavardes.
  if (prix) {
    contexte.devis_en_attente = devis
      .filter((d) => ['envoye', 'relance'].includes(d.statut))
      .slice(0, MAX_PAR_LISTE)
      .map((d) => ({
        numero: d.numero, client: d.tiers?.nom ?? null, titre: court(d.titre),
        emis_le: d.date_emission, statut: d.statut,
        relance_prevue: d.relance_prochaine_le,
        url: `#/devis/${d.id}`,
      }));

    contexte.factures_impayees = factures
      .filter((f) => f.statut === 'emise')
      .slice(0, MAX_PAR_LISTE)
      .map((f) => ({
        numero: f.numero, client: f.tiers?.nom ?? null, echeance: f.echeance_le,
        en_retard: !!f.echeance_le && f.echeance_le < aujourdhui,
        url: `#/factures/${f.id}`,
      }));

    contexte.encaissements_en_retard = enc
      .filter((e) => !e.recu_le && e.du_le && e.du_le < aujourdhui)
      .slice(0, MAX_PAR_LISTE)
      .map((e) => ({
        libelle: e.libelle, client: e.tiers?.nom ?? null, du_le: e.du_le,
        montant_ttc: Number(e.montant_ttc), url: '#/analytique',
      }));
  }

  return contexte;
}

/** Pose une question à l'assistant, avec l'état de l'entreprise en pièce jointe. */
export async function interroger(question: string): Promise<ReponseAssistant> {
  const contexte = await contexteAssistant();
  const charge = `QUESTION\n${question}\n\nÉTAT DE L'ENTREPRISE\n${JSON.stringify(contexte)}`;
  return demanderIAJson<ReponseAssistant>('assistant', charge);
}

/**
 * Applique la seule écriture permise : une note.
 *
 * L'auteur est marqué explicitement. Une note écrite par une machine et
 * signée comme une note humaine, c'est une trace qu'on ne peut plus
 * interpréter six mois plus tard.
 */
export async function appliquerNote(
  note: NonNullable<ReponseAssistant['note']>,
): Promise<void> {
  if (note.cible === 'journal') {
    await ajouterFil({
      chantier_id: note.id,
      type: 'note',
      contenu: note.texte,
      auteur: `Assistant, à la demande de ${moi().nom}`,
      a_traiter: false,
    });
    return;
  }

  // Notes internes d'un devis : on ajoute à la suite, on n'écrase jamais.
  const { devis } = await chargerDevis(note.id);
  const horodatage = new Date().toLocaleDateString('fr-FR');
  const ajout = `[${horodatage} — assistant, à la demande de ${moi().nom}] ${note.texte}`;
  await majDevis(note.id, {
    notes_internes: devis.notes_internes ? `${devis.notes_internes}\n${ajout}` : ajout,
  });
}

/**
 * Crée le brouillon de devis proposé par l'assistant.
 *
 * L'assistant a le droit de créer un brouillon — et rien de plus. Il n'envoie
 * pas, ne signe pas, ne facture pas. Ce qu'il produit est inerte tant qu'une
 * personne n'agit pas dessus, et c'est cette inertie qui permet de lui
 * laisser la main sans y regarder à deux fois.
 *
 * Les références reconnues au catalogue arrivent avec leur prix : c'est le
 * même chemin que « Devis à la voix », pour que les deux entrées donnent
 * exactement le même résultat.
 */
export async function devisDepuisAssistant(
  proposition: PropositionDevis, question: string,
): Promise<string> {
  return (await creerBrouillonDicte(proposition, question)).devisId;
}

/** Sert à vérifier qu'une facture citée existe encore. Utilisé par la page. */
export const factureLisible = (id: string) => chargerFacture(id).then(() => true).catch(() => false);
