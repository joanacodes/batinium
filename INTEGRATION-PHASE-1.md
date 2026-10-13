# Phase 1 — Intégration dans les fichiers existants

Les fichiers **nouveaux** de la phase 1 se déposent tels quels. Ce document
décrit les **petites modifications** à faire dans dix fichiers qui existent
déjà chez vous. Je ne vous livre pas ces fichiers entiers : je n'ai pas leur
version actuelle, et vous les remplacer par ma copie effacerait le travail des
lots 23 à 37.

**Pour Claude Code**, une seule phrase suffit :

```
Applique INTEGRATION-PHASE-1.md, modification par modification. Pour chacune,
trouve le passage décrit dans le fichier réel, même s'il a un peu bougé, et
fais la modification. Lance npx tsc -b à la fin et corrige ce qui ne compile pas.
```

**À la main**, chaque modification dit quoi chercher (Ctrl+F) et quoi faire.

Les dix modifications ont été appliquées et compilées sur une copie du projet
au lot 22 : elles fonctionnent. Les deux qui touchent du code du lot 23
(`signerDevis`, compte rendu de signature) ont été écrites d'après le code que
je vous avais livré à ce lot.

---

## 1. `src/lib/types.ts` — trois ajouts

**a.** Cherchez `export type TypeDocument =`. Dans la liste, juste avant
`| 'autre';`, ajoutez :

```ts
  | 'plaque_signaletique' | 'signature' | 'fiche_fluide'
```

**b.** Cherchez `export interface Document {`, puis la ligne `fil_id: string | null;`.
Juste après, ajoutez :

```ts
  /** La machine dont c'est la plaque signalétique (SQL 32). */
  equipement_id: string | null;
  /** La fiche fluides dont c'est une signature ou le PDF (SQL 33). */
  fiche_fluide_id: string | null;
```

**c.** Cherchez `attestation_capacite_organisme: string | null;` (dans
`interface Parametres`). Juste après, ajoutez :

```ts
  /** Catégorie I à V, reprise dans la rubrique 1 de chaque fiche fluides. */
  attestation_capacite_categorie: string | null;
```

## 2. `src/lib/db.ts` — cinq ajouts

**a.** Cherchez `export type CibleDocument =`. Juste après la ligne
`| { fil_id: string }`, ajoutez :

```ts
  /** La plaque signalétique d'une machine. */
  | { equipement_id: string }
  /** Une signature, ou le PDF, d'une fiche fluides. */
  | { fiche_fluide_id: string }
```

**b.** Cherchez `const DOSSIERS`. Dans la ligne qui contient
`portee_entreprise: 'entreprise',`, ajoutez à la fin de cette ligne :

```ts
 equipement_id: 'machine', fiche_fluide_id: 'fluide',
```

**c.** Cherchez `export const LIBELLES_DOCUMENT`, puis la ligne
`photo: { libelle: 'Photo' },`. Juste après, ajoutez :

```ts
  plaque_signaletique:          { libelle: 'Plaque signalétique' },
  signature:                    { libelle: 'Signature' },
  fiche_fluide:                 { libelle: 'Fiche d’intervention fluides (Cerfa)' },
```

**d.** En haut du fichier, avec les autres `import`, ajoutez :

```ts
import { machinesDepuisDevis } from './machines';
```

**e.** La signature du devis crée les machines. Cherchez
`export interface SuiteSignature {` et ajoutez dans l'interface :

```ts
  machines: number;
```

Puis dans `export async function signerDevis(`, cherchez la ligne
`if (!chantier) chantier = await chantierDepuisDevis(devisId);`. Juste après,
ajoutez :

```ts

  // 1 bis. Les machines : une par unité vendue, numéro de série à relever
  // sur place. La plaque fera foi, pas le devis.
  let machines = 0;
  try {
    machines = await machinesDepuisDevis(devisId, chantier.id);
  } catch (e) {
    avertissements.push(`Machines non créées : ${(e as Error).message}`);
  }
```

Enfin, en bas de la même fonction, dans la ligne `return { devis, chantier, …}`,
ajoutez `machines,` dans les accolades.

## 3. `src/lib/ia.ts` — un mot

Cherchez `export type TacheIA =`. Ajoutez `| 'plaque'` dans la liste, par
exemple juste après `'formulaire'`.

## 4. `src/lib/alertes.ts` — deux ajouts

**a.** Avec les autres `import`, ajoutez :

```ts
import { alertesFluides } from './alertesFluides';
```

**b.** Cherchez `const cachees = new Set(masquees);`. Juste **avant**, ajoutez :

```ts
  // Machines et fiches fluides (phase 1). Une panne de cette lecture ne doit
  // pas priver l'utilisateur de toutes ses autres alertes.
  a.push(...await alertesFluides().catch(() => []));

```

## 5. `src/App.tsx` — deux ajouts

**a.** Avec les autres `import`, ajoutez :

```ts
import PageFicheFluide from './pages/FicheFluide';
```

**b.** Cherchez `case 'pose':`. Juste **avant** cette ligne, ajoutez :

```tsx
    // La fiche fluides d'une machine (Cerfa 15497*04). Ouverte depuis la
    // fiche chantier ou depuis Ma journée ; sans identifiant, rien à montrer.
    case 'fluide':     return id ? <PageFicheFluide ficheId={id} /> : <PageChantiers />;
```

## 6. `src/pages/FicheChantier.tsx` — remplacer « Matériel posé »

C'est la modification la plus longue : les machines remplacent l'ancienne
liste « Matériel posé », qui portait les mêmes lignes sans ce que la
réglementation demande d'en savoir.

**a.** Avec les autres `import`, ajoutez :

```ts
import { MachinesChantier } from '../components/Machines';
import { FichesFluideChantier } from '../components/FichesFluide';
```

**b.** Cherchez ce bloc (il commence par le titre « Matériel posé ») :

```tsx
          <h2 style={{ margin: '20px 0 8px' }}>Matériel posé</h2>
          <p className="statut" style={{ marginBottom: 8 }}>
            Le numéro de série saisi ici devient la mémoire de l’installation : garantie, entretien, SAV.
          </p>
          <Materiel chantierId={chantierId} siteId={c.site_id} equipements={equipements}
                    onErreur={setErreur} onChange={recharger} />
```

Remplacez-le entièrement par :

```tsx
          {/* Les machines remplacent l'ancienne liste « Matériel posé » : mêmes
              lignes d'equipement, mais avec ce que la réglementation demande
              d'en savoir et la plaque comme source de vérité. */}
          <h2 style={{ margin: '20px 0 8px' }}>Machines</h2>
          <MachinesChantier chantierId={chantierId} siteId={c.site_id} onErreur={setErreur} />

          <h2 style={{ margin: '20px 0 8px' }}>Fiches fluides</h2>
          <FichesFluideChantier chantierId={chantierId} interventions={interventions}
                                onErreur={setErreur} />
```

**c.** Ce qui servait à l'ancienne liste ne sert plus. Le compilateur refusera
de construire tant qu'il reste. À retirer :

- la ligne `const [equipements, setEquipements] = useState<Equipement[]>([]);`
- dans la fonction `recharger`, l'appel `listerEquipements({ chantierId }),`
  dans le `Promise.all`, **et** la variable `e` qui lui correspond dans la
  liste `const [ch, i, e, m, …]` juste au-dessus — retirez les deux ensemble,
  sinon tout se décale ;
- dans la même fonction, `setEquipements(e);`
- toute la fonction `function Materiel(…) { … }`, plus bas dans le fichier ;
- dans les `import` du haut : `enregistrerEquipement`, `listerEquipements` et
  le type `Equipement`, s'ils ne servent plus ailleurs dans le fichier.

## 7. `src/pages/FicheClient.tsx` — la liste des machines du client

**a.** Avec les autres `import`, ajoutez :

```ts
import { MachinesClient } from '../components/Machines';
```

**b.** Cherchez la section « Chantiers » de la colonne de droite, puis la
balise `</aside>` qui la ferme. Juste **avant** `</aside>`, ajoutez :

```tsx

          <h2 style={{ margin: '18px 0 8px' }}>Machines</h2>
          <MachinesClient tiersId={tiersId} onErreur={setErreur} />
```

## 8. `src/pages/MaJournee.tsx` — les boutons de terrain

**a.** Avec les autres `import`, ajoutez :

```ts
import { BoutonsIntervention } from '../components/FichesFluide';
```

**b.** Cherchez le bouton « Journal et photos » :

```tsx
                    <button className="action discret" onClick={() => aller(`/chantiers/${c.id}`)}>
                      Journal et photos
                    </button>
```

Juste après ce bouton, ajoutez :

```tsx
                    <BoutonsIntervention intervention={i} onErreur={setErreur} />
```

Ce composant n'affiche rien pour une intervention qui ne touche pas au fluide.
Les phases 2 et 3 y ajouteront leurs boutons : vous n'aurez plus à revenir
dans ce fichier.

## 9. `src/pages/Editeur.tsx` — le compte rendu de signature

Cherchez la ligne :

```tsx
            <li>{suite.approvisionnements} référence(s) à commander, reprises du devis.</li>
```

Juste après, ajoutez :

```tsx
            <li>{suite.machines} machine(s) créée(s) — numéro de série à relever sur la plaque.</li>
```

## 10. `src/pages/Parametres.tsx` — la catégorie de l'attestation

Cherchez, dans la section de l'attestation de capacité, le champ
`<label>Expire le</label>` qui suit « Organisme agréé ». Juste **avant** le
`<div>` qui contient ce champ, ajoutez :

```tsx
          <div>
            <label>Catégorie</label>
            <select value={p.attestation_capacite_categorie ?? ''}
                    onChange={(e) => set('attestation_capacite_categorie', e.target.value || null)}>
              <option value="">—</option>
              {['I', 'II', 'III', 'IV', 'V'].map((c) => <option key={c} value={c}>Catégorie {c}</option>)}
            </select>
          </div>
```

---

## Ensuite

1. Exécutez `sql/32_machines.sql`, puis `sql/33_fiche_fluide.sql`, dans
   l'éditeur SQL de Supabase. Chacun finit par « SQL 3x appliqué ».
2. `npx tsc -b` : aucune erreur.
3. Redéployez la passerelle : `npx supabase functions deploy ia`.
4. Dans Entreprise, remplissez la catégorie de l'attestation de capacité.
5. Dans Équipe, vérifiez que chaque technicien a son numéro d'attestation
   d'aptitude : sans lui, il ne pourra signer aucune fiche — c'est voulu.
