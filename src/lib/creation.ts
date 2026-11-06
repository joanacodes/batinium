import { useEffect, useState } from 'react';

/**
 * Ouvrir le formulaire de création d'une page depuis ailleurs : le « + » de la
 * barre d'onglets du téléphone mène à Devis et ouvre directement « Nouveau
 * devis », sans passer par la liste.
 *
 * Une demande en attente plutôt qu'un paramètre d'adresse : `#/devis/nouveau`
 * aurait été pris pour l'identifiant d'un devis, et l'adresse serait restée
 * sur le formulaire — un rechargement l'aurait rouvert. Ici, la demande est
 * consommée une fois, que la page soit déjà ouverte (l'événement) ou qu'elle
 * s'ouvre juste après (la valeur en attente, lue au montage).
 */

export type Cible = 'demande' | 'client' | 'devis' | 'chantier';

const EVENEMENT = 'batinium:creer';
let enAttente: Cible | null = null;

export function demanderCreation(cible: Cible): void {
  enAttente = cible;
  window.dispatchEvent(new CustomEvent<Cible>(EVENEMENT, { detail: cible }));
}

/** Remplace `useState(false)` pour l'état « formulaire de création ouvert ». */
export function useCreation(cible: Cible): [boolean, (ouvert: boolean) => void] {
  // Lecture sans effet de bord : en mode strict, React appelle l'initialiseur
  // deux fois, et la seconde lecture doit voir la même chose que la première.
  const [ouvert, setOuvert] = useState(() => enAttente === cible);

  useEffect(() => {
    if (enAttente === cible) enAttente = null;
    const ecouter = (e: Event) => {
      if ((e as CustomEvent<Cible>).detail !== cible) return;
      enAttente = null;
      setOuvert(true);
    };
    window.addEventListener(EVENEMENT, ecouter);
    return () => window.removeEventListener(EVENEMENT, ecouter);
  }, [cible]);

  return [ouvert, setOuvert];
}
