import { demanderIAJson } from './ia';

/**
 * Reconnaissance des e-mails de formulaire.
 *
 * Un formulaire de site web arrive dans la boîte sous le nom du prestataire —
 * Squarespace, Wix, Typeform — et pas sous celui du prospect. L'expéditeur est
 * une adresse de robot, le sujet dit « New form submission », et le vrai nom,
 * le vrai e-mail et le vrai téléphone sont dans le corps du message.
 *
 * Créer le prospect depuis l'expéditeur donnait donc une fiche « Squarespace »
 * avec l'adresse du robot, et il fallait tout retaper à la main en lisant le
 * message. C'est exactement le genre de ressaisie que ce projet s'interdit.
 *
 * Aucune IA ici : les formulaires sont structurés en « Étiquette : valeur »,
 * et des règles font le travail. Une IA serait plus lente, payante, et pas
 * meilleure sur un texte aussi régulier.
 */

export interface Coordonnees {
  nom: string | null;
  email: string | null;
  telephone: string | null;
  message: string | null;
  /** Vrai quand le message ressemble à un formulaire et non à un vrai échange. */
  estFormulaire: boolean;
}

/** Les expéditeurs qui parlent au nom de quelqu'un d'autre. */
const ROBOTS = [
  'squarespace', 'form-submission', 'formsubmission', 'wixformbuilder', 'wix.com',
  'typeform', 'jotform', 'tally.so', 'no-reply', 'noreply', 'donotreply',
  'mailer', 'notification',
];

/** Les intitulés rencontrés dans un formulaire français ou anglais. */
const ETIQUETTES: Record<keyof Omit<Coordonnees, 'estFormulaire'>, string[]> = {
  nom: ['nom et prénom', 'nom complet', 'votre nom', 'name', 'full name', 'first name',
        'prénom', 'nom'],
  email: ['adresse e-mail', 'adresse email', 'courriel', 'e-mail', 'email'],
  telephone: ['numéro de téléphone', 'téléphone', 'tél', 'phone number', 'phone',
              'mobile', 'portable'],
  message: ['votre message', 'message', 'demande', 'projet', 'comment', 'commentaire',
            'précisions', 'besoin'],
};

const sansAccent = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Un e-mail plausible. On refuse ceux du prestataire lui-même : un message
 * Squarespace contient toujours des adresses de leur domaine en pied de page,
 * et les prendre pour le prospect serait pire que de ne rien trouver.
 */
function emailsPlausibles(texte: string): string[] {
  const trouves = texte.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
  return trouves
    .map((e) => e.replace(/[.,;:)]+$/, ''))
    .filter((e) => !ROBOTS.some((r) => sansAccent(e).includes(r)))
    .filter((e) => !/\.(png|jpg|gif)$/i.test(e));
}

/**
 * Un numéro français, sous toutes ses formes d'écriture.
 *
 * On exige au moins neuf chiffres : un « 2026 » dans une date ou un « 60 m² »
 * dans un message ne doivent pas devenir un numéro de téléphone.
 */
function telephonePlausible(texte: string): string | null {
  const motif = /(?:(?:\+|00)33[\s.-]?|0)\s?[1-9](?:[\s.-]?\d{2}){4}/g;
  const trouve = texte.match(motif)?.[0];
  if (!trouve) return null;
  const chiffres = trouve.replace(/\D/g, '');
  return chiffres.length >= 9 ? trouve.trim() : null;
}

/** Cherche « Étiquette : valeur », sur la même ligne ou sur la suivante. */
function valeurDe(lignes: string[], etiquettes: string[]): string | null {
  for (let i = 0; i < lignes.length; i++) {
    const ligne = sansAccent(lignes[i]);
    for (const e of etiquettes) {
      const cle = sansAccent(e);
      // Ancré en début de ligne : « nom » ne doit pas se déclencher sur
      // « nom de votre entreprise » au milieu d'une phrase.
      const m = ligne.match(new RegExp(`^\\s*${cle}\\s*[:：]\\s*(.*)$`));
      if (m) {
        const valeur = lignes[i].slice(lignes[i].indexOf(':') + 1).trim();
        // Certains formulaires mettent la valeur sur la ligne d'après.
        if (valeur) return valeur;
        const suivante = lignes[i + 1]?.trim();
        if (suivante && !suivante.includes(':')) return suivante;
      }
    }
  }
  return null;
}

/**
 * Extrait les coordonnées d'un e-mail de formulaire.
 *
 * `expediteur` et `adresse` servent à décider s'il s'agit d'un robot. Le
 * repérage par étiquette passe en premier : il est exact. La recherche par
 * motif ne sert que de filet.
 */
export function lireFormulaire(
  { sujet, corps, expediteur, adresse }:
  { sujet: string; corps: string; expediteur: string; adresse: string },
): Coordonnees {
  const identite = sansAccent(`${expediteur} ${adresse} ${sujet}`);
  const estFormulaire = ROBOTS.some((r) => identite.includes(r))
    || /form submission|nouveau message du formulaire|formulaire de contact|nouvelle demande/i
      .test(`${sujet} ${corps}`);

  const lignes = corps.split(/\r?\n/);

  const parEtiquette = {
    nom: valeurDe(lignes, ETIQUETTES.nom),
    email: valeurDe(lignes, ETIQUETTES.email),
    telephone: valeurDe(lignes, ETIQUETTES.telephone),
    message: valeurDe(lignes, ETIQUETTES.message),
  };

  const email = parEtiquette.email && parEtiquette.email.includes('@')
    ? parEtiquette.email
    : emailsPlausibles(corps)[0] ?? null;

  const telephone = parEtiquette.telephone && /\d/.test(parEtiquette.telephone)
    ? parEtiquette.telephone
    : telephonePlausible(corps);

  return {
    nom: parEtiquette.nom,
    email,
    telephone,
    message: parEtiquette.message,
    estFormulaire,
  };
}


/**
 * La même lecture, confiée au modèle quand les règles ne suffisent pas.
 *
 * Les règles marchent sur un formulaire bien rangé en « étiquette : valeur ».
 * Elles échouent sur un tableau HTML, sur un formulaire dont les intitulés
 * sont ceux du client, sur un mélange de français et d'anglais — et il n'y a
 * aucune limite au nombre de formes qu'un formulaire peut prendre.
 *
 * D'où cet ordre : les règles d'abord, gratuites et instantanées ; le modèle
 * ensuite, seulement si elles n'ont pas trouvé l'essentiel. Sur un formulaire
 * Squarespace ordinaire, aucun appel payant. Sur les autres, une lecture qui
 * aboutit au lieu d'une fiche à retaper.
 */
export async function lireFormulaireAvecIA(
  x: { sujet: string; corps: string; expediteur: string; adresse: string },
): Promise<Coordonnees & { parIA: boolean }> {
  const regles = lireFormulaire(x);

  // Assez, c'est un nom et un moyen de recontacter. Sans l'un des deux, la
  // fiche créée serait à compléter à la main : autant demander au modèle.
  const suffisant = Boolean(regles.nom && (regles.email || regles.telephone));
  if (suffisant || !regles.estFormulaire) return { ...regles, parIA: false };

  try {
    const lu = await demanderIAJson<{
      nom: string | null; email: string | null; telephone: string | null;
      message: string | null; adresse: string | null; est_formulaire: boolean;
    }>('formulaire', `SUJET\n${x.sujet}\n\nDE\n${x.expediteur} <${x.adresse}>\n\nCORPS\n${x.corps}`);

    // Le modèle complète, il ne remplace pas : une valeur trouvée par les
    // règles est exacte par construction, celle du modèle est une lecture.
    return {
      nom: regles.nom ?? lu.nom,
      email: regles.email ?? lu.email,
      telephone: regles.telephone ?? lu.telephone,
      message: regles.message ?? lu.message,
      estFormulaire: regles.estFormulaire || lu.est_formulaire,
      parIA: true,
    };
  } catch {
    // La passerelle n'est pas déployée, ou le modèle a échoué : on rend ce que
    // les règles ont trouvé. Une lecture partielle vaut mieux qu'une erreur.
    return { ...regles, parIA: false };
  }
}
