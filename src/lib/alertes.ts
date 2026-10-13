import {
  chargerParametres, listerAlertesMasquees, listerChantiers, listerDemandes, listerDevis,
  listerEquipements, listerInterventions, LIBELLES_DOCUMENT, listerDocumentsAEcheance,
  listerJournal, listerTaches, masquerAlerte,
} from './db';
import { preavisEntretien, voitLesPrix } from './session';
import { alertesFluides } from './alertesFluides';
import { contratsActifs, visitesPrevues } from './contrats';

/**
 * Les alertes ne sont pas stockées : elles se recalculent à chaque affichage.
 * Une alerte périmée disparaît donc d'elle-même, sans tâche de fond ni
 * risque d'incohérence. On ne mémorise que celles que l'utilisateur écarte.
 */

export type Gravite = 'urgent' | 'attention' | 'information';

export interface Alerte {
  cle: string;          // stable : c'est elle qui permet de masquer durablement
  gravite: Gravite;
  titre: string;
  detail?: string;
  lien?: string;
  date?: string;
}

const jour = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const dans = (n: number) => jour(new Date(Date.now() + n * 86400000));

export async function calculerAlertes(): Promise<Alerte[]> {
  const aujourdhui = jour(new Date());
  const prix = voitLesPrix();
  // Chacun choisit combien de temps à l'avance il veut être prévenu d'un
  // entretien (SQL 37) : un mois pour caler la tournée, une semaine pour un autre.
  const preavis = preavisEntretien();

  const [demandes, devis, chantiers, vigilance, taches, interventions, journal,
         equipements, parametres, masquees] = await Promise.all([
    listerDemandes(),
    prix ? listerDevis() : Promise.resolve([]),
    listerChantiers(),
    prix ? listerDocumentsAEcheance() : Promise.resolve([]),
    listerTaches(),
    listerInterventions(),
    listerJournal().catch(() => []),
    // L'entretien concerne le terrain : tout le monde le voit.
    listerEquipements().catch(() => []),
    prix ? chargerParametres().catch(() => null) : Promise.resolve(null),
    listerAlertesMasquees(),
  ]);

  const a: Alerte[] = [];

  // Quelqu'un attend une réponse
  for (const d of demandes) {
    if (d.repondu || ['perdue', 'spam'].includes(d.statut)) continue;
    const jours = Math.floor((Date.now() - new Date(d.recu_le).getTime()) / 86400000);
    // Le détail porte le besoin, et à défaut la transcription de l'appel :
    // sur un appel manqué, c'est la seule chose qui dise de quoi il s'agit.
    // Une alerte « quelqu'un a appelé » sans contenu oblige à rouvrir la
    // page pour savoir s'il faut se lever.
    const contexte = (d.besoin ?? d.resume ?? d.transcription ?? '').trim();
    const extrait = contexte.length > 240 ? `${contexte.slice(0, 240)}…` : contexte;

    if (d.urgence === 'panne') {
      a.push({
        cle: `demande:panne:${d.id}`, gravite: 'urgent',
        titre: `Panne signalée par ${d.nom || d.tiers?.nom || d.telephone || 'un client'}`,
        detail: extrait || undefined, lien: '#/demandes', date: d.recu_le,
      });
    } else if (jours >= 2) {
      a.push({
        cle: `demande:attente:${d.id}:${jours >= 7 ? 'semaine' : 'jours'}`,
        gravite: jours >= 7 ? 'urgent' : 'attention',
        titre: `${d.nom || d.tiers?.nom || d.telephone || 'Un client'} attend depuis ${jours} jours`,
        detail: extrait || undefined, lien: '#/demandes', date: d.recu_le,
      });
    }
    if (d.rappeler_le && d.rappeler_le <= aujourdhui) {
      a.push({
        cle: `demande:rappel:${d.id}:${d.rappeler_le}`, gravite: 'urgent',
        titre: `Rappel prévu : ${d.nom || d.tiers?.nom || d.telephone || 'client'}`,
        lien: '#/demandes', date: d.rappeler_le,
      });
    }
  }

  // Devis envoyés sans réponse
  for (const d of devis) {
    if (d.statut !== 'envoye') continue;
    if (!d.relance_prochaine_le || d.relance_prochaine_le <= aujourdhui) {
      a.push({
        cle: `devis:relance:${d.id}:${d.relance_prochaine_le ?? 'sans'}`, gravite: 'attention',
        titre: `Devis ${d.numero} à relancer`,
        detail: d.tiers?.nom ?? undefined, lien: `#/devis/${d.id}`,
        date: d.envoye_le ?? undefined,
      });
    }
    if (d.date_emission) {
      const fin = new Date(d.date_emission);
      fin.setDate(fin.getDate() + d.validite_jours);
      if (jour(fin) <= dans(7) && jour(fin) >= aujourdhui) {
        a.push({
          cle: `devis:expire:${d.id}`, gravite: 'attention',
          titre: `Devis ${d.numero} expire le ${fin.toLocaleDateString('fr-FR')}`,
          lien: `#/devis/${d.id}`,
        });
      }
    }
  }

  // Encaissement bloqué par le délai de rétractation
  for (const d of devis) {
    if (d.statut === 'signe' && d.encaissement_autorise_le && d.encaissement_autorise_le > aujourdhui) {
      a.push({
        cle: `devis:encaissement:${d.id}`, gravite: 'information',
        titre: `Devis ${d.numero} : encaissement possible le ${new Date(d.encaissement_autorise_le).toLocaleDateString('fr-FR')}`,
        detail: 'Contrat conclu hors établissement, aucun acompte avant cette date.',
        lien: `#/devis/${d.id}`,
      });
    }
  }

  // Chantiers bloqués
  for (const c of chantiers) {
    if (c.statut === 'bloque') {
      a.push({
        cle: `chantier:bloque:${c.id}`, gravite: 'attention',
        titre: `Chantier ${c.numero} bloqué`, detail: c.libelle,
        lien: `#/chantiers/${c.id}`,
      });
    }
    if (c.statut === 'a_receptionner') {
      a.push({
        cle: `chantier:reception:${c.id}`, gravite: 'information',
        titre: `Chantier ${c.numero} à réceptionner`, lien: `#/chantiers/${c.id}`,
      });
    }
  }

  // Documents à échéance : vigilance des sous-traitants, mais aussi permis,
  // visite médicale, attestation d'aptitude d'un salarié. Le lien mène à la
  // fiche concernée plutôt qu'à une liste : on veut agir, pas chercher.
  for (const v of vigilance) {
    if (!v.expire_le) continue;
    const quoi = LIBELLES_DOCUMENT[v.type]?.libelle ?? 'Document';
    const ou = v.tiers_id ? `#/soustraitant/${v.tiers_id}`
      : v.membre_id ? `#/equipe/${v.membre_id}` : '#/equipe';
    const solidarite = LIBELLES_DOCUMENT[v.type]?.vigilance
      ? 'Un sous-traitant non à jour vous expose à la solidarité financière.'
      : undefined;
    if (v.expire_le <= aujourdhui) {
      a.push({
        cle: `document:perime:${v.id}:${v.expire_le}`, gravite: 'urgent',
        titre: `${quoi} périmé`, detail: solidarite, lien: ou, date: v.expire_le,
      });
    } else if (v.expire_le <= dans(30)) {
      a.push({
        cle: `document:bientot:${v.id}:${v.expire_le}`, gravite: 'attention',
        titre: `${quoi} à renouveler avant le ${new Date(v.expire_le).toLocaleDateString('fr-FR')}`,
        lien: ou, date: v.expire_le,
      });
    }
  }

  // Entretiens d'équipements à échéance
  //
  // La colonne existait depuis le premier jour, avec son index, et personne ne
  // la lisait : un entretien annuel oublié, c'est une garantie qui tombe et un
  // client qui appelle en panne au premier jour de chaleur.
  for (const e of equipements) {
    if (!e.prochain_entretien_le || e.statut !== 'actif') continue;
    const quoi = [e.marque, e.modele].filter(Boolean).join(' ') || 'Équipement';
    const ou = e.chantier_id ? `#/chantiers/${e.chantier_id}` : '#/calendrier';
    if (e.prochain_entretien_le <= aujourdhui) {
      a.push({
        cle: `entretien:retard:${e.id}:${e.prochain_entretien_le}`, gravite: 'urgent',
        titre: `Entretien en retard — ${quoi}`,
        detail: e.numero_serie ? `N° de série ${e.numero_serie}` : undefined,
        lien: ou, date: e.prochain_entretien_le,
      });
    } else if (e.prochain_entretien_le <= dans(preavis)) {
      a.push({
        cle: `entretien:bientot:${e.id}:${e.prochain_entretien_le}`, gravite: 'attention',
        titre: `Entretien à prévoir — ${quoi}`,
        detail: `À faire avant le ${new Date(e.prochain_entretien_le).toLocaleDateString('fr-FR')}.`,
        lien: ou, date: e.prochain_entretien_le,
      });
    }
  }

  // Contrats d'entretien à échéance, sans visite planifiée (SQL 37). Une
  // visite calée fait taire l'alerte : il n'y a plus rien à faire, sinon y
  // aller. Réservé à ceux qui voient les prix — le contrat en porte un, et la
  // base ne le leur montre pas de toute façon.
  if (prix) {
    const [contrats, visites] = await Promise.all([
      contratsActifs().catch(() => []),
      visitesPrevues().catch(() => []),
    ]);
    const calees = new Set(visites.map((v) => v.contrat_id));
    for (const c of contrats) {
      if (calees.has(c.id)) continue;
      const qui = c.tiers?.nom ?? 'un client';
      const quand = new Date(c.prochaine_echeance).toLocaleDateString('fr-FR');
      if (c.prochaine_echeance <= aujourdhui) {
        a.push({
          cle: `contrat:retard:${c.id}:${c.prochaine_echeance}`, gravite: 'urgent',
          titre: `Entretien sous contrat en retard — ${qui}`,
          detail: `${c.libelle} : échéance du ${quand}, aucune visite planifiée.`,
          lien: `#/clients/${c.tiers_id}`, date: c.prochaine_echeance,
        });
      } else if (c.prochaine_echeance <= dans(preavis)) {
        a.push({
          cle: `contrat:bientot:${c.id}:${c.prochaine_echeance}`, gravite: 'attention',
          titre: `Entretien sous contrat à planifier — ${qui}`,
          detail: `${c.libelle} : à faire avant le ${quand}.`,
          lien: `#/clients/${c.tiers_id}`, date: c.prochaine_echeance,
        });
      }
    }
  }

  // L'attestation de capacité de l'entreprise
  //
  // Quatre-vingt-dix jours d'avance et non trente : son renouvellement passe
  // par un audit qui se planifie. Sans elle, l'entreprise ne peut plus acheter
  // de fluide frigorigène — ce n'est pas une formalité, c'est l'activité qui
  // s'arrête.
  if (parametres?.attestation_capacite_expire_le) {
    const fin = parametres.attestation_capacite_expire_le;
    if (fin <= aujourdhui) {
      a.push({
        cle: `capacite:perime:${fin}`, gravite: 'urgent',
        titre: 'Attestation de capacité fluides périmée',
        detail: 'Sans elle, plus d’achat ni de manipulation de fluide frigorigène.',
        lien: '#/reglages', date: fin,
      });
    } else if (fin <= dans(90)) {
      a.push({
        cle: `capacite:bientot:${fin}`, gravite: 'attention',
        titre: `Attestation de capacité à renouveler avant le ${new Date(fin).toLocaleDateString('fr-FR')}`,
        detail: 'Le renouvellement passe par un audit : à engager dès maintenant.',
        lien: '#/reglages', date: fin,
      });
    }
  }

  // Tâches en retard ou du jour
  for (const t of taches) {
    if (!t.echeance) continue;
    if (t.echeance < aujourdhui) {
      a.push({
        cle: `tache:retard:${t.id}:${t.echeance}`, gravite: 'urgent',
        titre: `En retard : ${t.titre}`, lien: '#/taches', date: t.echeance,
      });
    } else if (t.echeance === aujourdhui) {
      a.push({
        cle: `tache:jour:${t.id}:${t.echeance}`, gravite: 'attention',
        titre: `Aujourd’hui : ${t.titre}`, lien: '#/taches', date: t.echeance,
      });
    }
  }

  // Interventions du jour
  for (const i of interventions) {
    if (i.date_prevue === aujourdhui && i.statut === 'planifiee') {
      a.push({
        cle: `intervention:jour:${i.id}:${i.date_prevue}`, gravite: 'information',
        titre: `Intervention prévue aujourd’hui`, lien: '#/calendrier', date: i.date_prevue,
      });
    }
  }

  // Ce qui est noté sur un chantier depuis moins de trois jours mérite d'être vu
  for (const j of journal) {
    if (j.type !== 'note' || !j.contenu) continue;
    const jours = Math.floor((Date.now() - new Date(j.occurred_at).getTime()) / 86400000);
    if (jours > 3) continue;
    a.push({
      cle: `journal:${j.id}`, gravite: 'information',
      titre: j.chantier ? `${j.chantier.numero} — note de chantier` : 'Note de chantier',
      detail: j.contenu,
      lien: j.chantier_id ? `#/chantiers/${j.chantier_id}` : '#/journal',
      date: j.occurred_at,
    });
  }

  // Machines et fiches fluides (phase 1). Une panne de cette lecture ne doit
  // pas priver l'utilisateur de toutes ses autres alertes.
  a.push(...await alertesFluides().catch(() => []));

  const cachees = new Set(masquees);
  const ordre: Record<Gravite, number> = { urgent: 0, attention: 1, information: 2 };
  return a
    .filter((x) => !cachees.has(x.cle))
    .sort((x, y) => ordre[x.gravite] - ordre[y.gravite] ||
      (y.date ?? '').localeCompare(x.date ?? ''));
}

export { masquerAlerte };
