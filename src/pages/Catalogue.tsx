import { Fragment, useCallback, useEffect, useState } from 'react';
import { eur } from '../lib/calcul';
import { aller } from '../lib/router';
import {
  archiverProduit, dupliquerProduit, enregistrerFormat, enregistrerProduit, enregistrerVariante,
  listerBrouillons, listerFormats, listerProduits, listerVariantes, publierProduits,
  resoudrePhotos, retirerPhoto, supprimerBrouillons, supprimerFormat, supprimerVariante,
  televerserPhoto,
} from '../lib/db';
import type { ChampLibre, Famille, FormatProduit, Produit, TypeChamp, Variante } from '../lib/types';
import Menu from '../components/Menu';
import Modale from '../components/Modale';
import Bulle from '../components/Bulle';

const FAMILLES: Famille[] = [
  'mono_split', 'multi_split', 'gainable', 'console', 'cassette', 'groupe_eau',
  'accessoire', 'fourniture', 'plomberie', 'electricite', 'pose', 'phonique', 'logistique',
];

/** Libellés des colonnes techniques, pour que le formulaire se construise seul. */
const CHAMPS_STANDARDS: Record<string, { libelle: string; type: TypeChamp; options?: string[] }> = {
  puissance_kw: { libelle: 'Puissance', type: 'nombre' },
  classe_froid: { libelle: 'Classe froid', type: 'liste', options: ['A', 'A+', 'A++', 'A+++'] },
  classe_chaud: { libelle: 'Classe chaud', type: 'liste', options: ['A', 'A+', 'A++', 'A+++'] },
  fluide:       { libelle: 'Fluide', type: 'texte' },
  fixe:         { libelle: 'Fixe', type: 'booleen' },
  reversible:   { libelle: 'Réversible', type: 'booleen' },
  connecte:     { libelle: 'Connecté', type: 'booleen' },
};

export default function PageCatalogue() {
  const [produits, setProduits] = useState<Produit[]>([]);
  const [brouillons, setBrouillons] = useState<Produit[]>([]);
  const [variantes, setVariantes] = useState<Variante[]>([]);
  const [formats, setFormats] = useState<FormatProduit[]>([]);
  const [deplie, setDeplie] = useState<Set<string>>(new Set());
  const [filtre, setFiltre] = useState('');
  const [parFormat, setParFormat] = useState('');
  const [vue, setVue] = useState<'catalogue' | 'brouillons'>('catalogue');
  // Le seau est privé depuis le SQL 17 : une vignette n'a plus d'adresse
  // durable, on demande les liens signés en une fois pour tout le catalogue.
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [edition, setEdition] = useState<Partial<Produit> | null>(null);
  const [variantesDe, setVariantesDe] = useState<Produit | null>(null);
  const [gestionFormats, setGestionFormats] = useState(false);

  const recharger = useCallback(async () => {
    try {
      const [p, f, v, b] = await Promise.all([
        listerProduits(), listerFormats(), listerVariantes().catch(() => []),
        listerBrouillons().catch(() => []),
      ]);
      setProduits(p); setFormats(f); setVariantes(v); setBrouillons(b);
      setPhotos(await resoudrePhotos([...p, ...b]).catch(() => ({})));
    } catch (e) { setErreur((e as Error).message); }
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  const q = filtre.trim().toLowerCase();
  const visibles = produits
    .filter((p) => !parFormat || p.format_id === parFormat)
    .filter((p) => !q || `${p.reference} ${p.designation} ${p.famille}`.toLowerCase().includes(q));

  const modaleEdition = edition && (
    <Modale titre={edition.id ? `Modifier ${edition.reference}` : 'Nouvelle référence'}
            taille="large" onFermer={() => setEdition(null)}>
      <Formulaire key={edition.id ?? 'nouveau'} produit={edition} formats={formats}
                  onErreur={setErreur}
                  onEnregistre={() => { setEdition(null); void recharger(); }} />
    </Modale>
  );

  // La relecture occupe tout l'écran : on n'y compare pas des brouillons au
  // catalogue, on décide lesquels ont le droit d'y entrer.
  if (vue === 'brouillons') {
    return (
      <>
        {erreur && <div className="erreur">{erreur}</div>}
        <Relecture brouillons={brouillons} onErreur={setErreur} onChange={recharger}
                   onRetour={() => setVue('catalogue')} onOuvrir={setEdition} />
        {modaleEdition}
      </>
    );
  }

  return (
    <>
      <div className="entete">
        <h1>Catalogue</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="Filtrer" value={filtre} onChange={(e) => setFiltre(e.target.value)}
                 style={{ width: 190 }} />
          <select value={parFormat} onChange={(e) => setParFormat(e.target.value)} style={{ width: 190 }}>
            <option value="">Tous les formats</option>
            {formats.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
          <Bulle texte="Définit les champs proposés selon le type de matériel.">
            <button className="action discret" onClick={() => setGestionFormats(true)}>
              Formats
            </button>
          </Bulle>
          <Bulle texte="Lire un fichier ou un devis collé, et en tirer des références à relire avant publication.">
            <button className="action discret" onClick={() => aller('/catalogue/remplir')}>
              Remplir le catalogue
            </button>
          </Bulle>
          <button className="action" onClick={() => setEdition({
            famille: 'mono_split', nature: 'fourniture', unite: 'U',
            format_id: formats[0]?.id ?? null, attributs: {},
          })}>
            Nouvelle référence
          </button>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {brouillons.length > 0 && (
        <div className="brouillon-bandeau">
          <strong>
            {brouillons.length} référence{brouillons.length > 1 ? 's' : ''} en attente de relecture
          </strong>
          <span className="statut" style={{ flex: 1, minWidth: 240 }}>
            Elles n’apparaissent ni dans ce tableau ni dans le sélecteur de lignes de devis
            tant qu’elles n’ont pas été publiées.
          </span>
          <button className="action" onClick={() => setVue('brouillons')}>Les relire</button>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th style={{ width: 60 }}>Photo</th>
            <th>Référence</th>
            <th>Désignation</th>
            <th style={{ width: 150 }}>Format</th>
            <th style={{ width: 120 }}>Déclinaisons</th>
            <th className="num" style={{ width: 100 }}>Achat</th>
            <th className="num" style={{ width: 100 }}>Vente</th>
            <th className="num" style={{ width: 130 }}>Marge</th>
            <th style={{ width: 150 }} className="sans-impression" />
          </tr>
        </thead>
        <tbody>
          {visibles.map((p) => {
            const siennes = variantes
              .filter((v) => v.produit_id === p.id)
              .sort((a, b) => a.position - b.position);
            const ouvert = deplie.has(p.id);
            const achat = p.prix_achat_ht != null ? Number(p.prix_achat_ht) : null;
            const marge = achat != null ? Number(p.prix_vente_ht) - achat : null;
            const pct = achat && marge != null && Number(p.prix_vente_ht) > 0
              ? (marge / Number(p.prix_vente_ht)) * 100 : null;
            return (
              <Fragment key={p.id}>
              <tr>
                <td><Photo produit={p} url={photos[p.id]} onErreur={setErreur}
                           onChange={recharger} /></td>
                <td className="ref">{p.reference}</td>
                <td>
                  {p.designation}
                  {p.description && <div className="fiche">{p.description}</div>}
                </td>
                <td className="statut">
                  {formats.find((f) => f.id === p.format_id)?.nom ?? p.famille}
                </td>
                <td>
                  {siennes.length === 0 ? (
                    <span className="statut">aucune</span>
                  ) : (
                    <button className="action discret" style={{ padding: '2px 9px' }}
                            onClick={() => setDeplie((d) => {
                              const n = new Set(d);
                              if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
                              return n;
                            })}>
                      {siennes.length} {ouvert ? '▴' : '▾'}
                    </button>
                  )}
                </td>
                <td className="num">{achat != null ? eur(achat) : '—'}</td>
                <td className="num">
                  {siennes.length > 0
                    ? <span className="statut">
                        de {eur(Math.min(...siennes.map((v) => Number(v.prix_vente_ht))))}<br />
                        à {eur(Math.max(...siennes.map((v) => Number(v.prix_vente_ht))))}
                      </span>
                    : eur(Number(p.prix_vente_ht))}
                </td>
                <td className="num">
                  {marge != null ? `${eur(marge)}${pct ? ` (${pct.toFixed(0)} %)` : ''}` : '—'}
                </td>
                <td className="sans-impression" style={{ whiteSpace: 'nowrap' }}>
                  <button className="action discret" onClick={() => setEdition(p)}>Modifier</button>
                  {' '}
                  <Menu actions={[
                    { libelle: 'Modifier', faire: () => setEdition(p) },
                    { libelle: 'Dupliquer', faire: () => void dupliquerProduit(p.id)
                        .then(recharger).catch((e) => setErreur((e as Error).message)) },
                    { libelle: 'Gérer les déclinaisons', faire: () => setVariantesDe(p) },
                    { libelle: 'Retirer du catalogue', danger: true, faire: () => {
                        if (window.confirm(`Retirer ${p.reference} du catalogue ?`)) {
                          void archiverProduit(p.id).then(recharger);
                        }
                      } },
                  ]} />
                </td>
              </tr>

              {ouvert && siennes.map((v) => (
                <tr key={v.id} style={{ background: 'var(--papier)' }}>
                  <td />
                  <td className="ref">{v.reference ?? ''}</td>
                  <td style={{ paddingLeft: 26 }}>
                    <strong>{v.nom}</strong>
                    {v.description && <div className="fiche">{v.description}</div>}
                  </td>
                  <td />
                  <td />
                  <td className="num">
                    {v.prix_achat_ht != null ? eur(Number(v.prix_achat_ht)) : '—'}
                  </td>
                  <td className="num">{eur(Number(v.prix_vente_ht))}</td>
                  <td className="num">
                    {v.prix_achat_ht != null
                      ? eur(Number(v.prix_vente_ht) - Number(v.prix_achat_ht)) : '—'}
                  </td>
                  <td className="sans-impression">
                    <button className="action discret" style={{ padding: '2px 8px' }}
                            onClick={() => setVariantesDe(p)}>Modifier</button>
                  </td>
                </tr>
              ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <p className="statut" style={{ marginTop: 14 }}>
        {visibles.length} référence{visibles.length > 1 ? 's' : ''}. Les photos apparaissent
        sur les devis envoyés aux clients : le stockage est public, n’y mettez rien de confidentiel.
      </p>

      {modaleEdition}

      {variantesDe && (
        <Modale titre={`Déclinaisons de ${variantesDe.designation}`} taille="large"
                onFermer={() => setVariantesDe(null)}>
          <GestionVariantes
            produit={variantesDe}
            variantes={variantes.filter((v) => v.produit_id === variantesDe.id)
              .sort((a, b) => a.position - b.position)}
            onErreur={setErreur}
            onChange={recharger}
          />
        </Modale>
      )}

      {gestionFormats && (
        <Modale titre="Formats de produits" taille="large" onFermer={() => setGestionFormats(false)}>
          <GestionFormats formats={formats} onErreur={setErreur} onChange={recharger} />
        </Modale>
      )}
    </>
  );
}

// --- Photo ------------------------------------------------------------------

function Photo({ produit, url, onErreur, onChange }: {
  produit: Produit; url?: string; onErreur: (m: string) => void; onChange: () => void;
}) {
  const [envoi, setEnvoi] = useState(false);

  async function choisir(f: File | undefined) {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return onErreur('Photo trop lourde : cinq mégaoctets au maximum.');
    setEnvoi(true);
    try { await televerserPhoto(produit.id, f); onChange(); }
    catch (e) { onErreur((e as Error).message); }
    setEnvoi(false);
  }

  return (
    <div style={{ position: 'relative', width: 46 }}>
      <label style={{ margin: 0, cursor: 'pointer', display: 'block' }} title="Changer la photo">
        {url
          ? <img src={url} alt="" className="vignette" />
          : <span className="vignette" style={{
              display: 'grid', placeItems: 'center', fontSize: 18, color: 'var(--encre-pale)',
            }}>{envoi ? '…' : '+'}</span>}
        <input type="file" accept="image/*" style={{ display: 'none' }}
               onChange={(e) => void choisir(e.target.files?.[0])} />
      </label>
      {produit.photo_chemin && (
        <button className="action discret"
                style={{ position: 'absolute', top: -6, right: -8, padding: '0 5px', fontSize: 11 }}
                title="Retirer la photo"
                onClick={() => void retirerPhoto(produit.id).then(onChange)}>×</button>
      )}
    </div>
  );
}

// --- Formulaire de référence ------------------------------------------------

function Formulaire({ produit, formats, onEnregistre, onErreur }: {
  produit: Partial<Produit>;
  formats: FormatProduit[];
  onEnregistre: () => void;
  onErreur: (m: string) => void;
}) {
  const [p, setP] = useState<Partial<Produit>>({ attributs: {}, ...produit });
  const set = (k: keyof Produit, v: unknown) => setP((x) => ({ ...x, [k]: v }));
  const format = formats.find((f) => f.id === p.format_id);

  function majAchat(v: string) {
    const achat = v ? Number(v) : null;
    set('prix_achat_ht', achat);
    if (achat && p.coefficient) {
      set('prix_vente_ht', Math.round(achat * Number(p.coefficient) * 100) / 100);
    }
  }
  function majCoef(v: string) {
    const coef = v ? Number(v) : null;
    set('coefficient', coef);
    if (coef && p.prix_achat_ht) {
      set('prix_vente_ht', Math.round(Number(p.prix_achat_ht) * coef * 100) / 100);
    }
  }
  const setAttribut = (cle: string, v: string | number | boolean | null) =>
    setP((x) => ({ ...x, attributs: { ...(x.attributs ?? {}), [cle]: v } }));

  async function enregistrer() {
    if (!p.reference || !p.designation) return onErreur('Référence et désignation obligatoires.');
    try { await enregistrerProduit(p); onEnregistre(); }
    catch (e) { onErreur((e as Error).message); }
  }

  const grille = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(6, 1fr)' } as const;

  return (
    <div style={grille}>
      <div style={{ gridColumn: 'span 2' }}>
        <label>Format</label>
        <select value={p.format_id ?? ''} onChange={(e) => set('format_id', e.target.value || null)}>
          <option value="">—</option>
          {formats.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
        </select>
        {format?.description && <p className="statut">{format.description}</p>}
      </div>
      <div>
        <label>Référence</label>
        <input value={p.reference ?? ''} onChange={(e) => set('reference', e.target.value)} />
      </div>
      <div style={{ gridColumn: 'span 3' }}>
        <label>Désignation</label>
        <input value={p.designation ?? ''} onChange={(e) => set('designation', e.target.value)} />
      </div>

      <div style={{ gridColumn: 'span 6' }}>
        <label>Description technique, imprimée sous la désignation du devis</label>
        <textarea rows={4} value={p.description ?? ''}
                  onChange={(e) => set('description', e.target.value)} />
      </div>

      <div>
        <label>Famille</label>
        <select value={p.famille} onChange={(e) => set('famille', e.target.value)}>
          {FAMILLES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div>
        <label>Nature</label>
        <select value={p.nature} onChange={(e) => set('nature', e.target.value)}>
          <option value="fourniture">Fourniture</option>
          <option value="pose">Pose</option>
          <option value="deplacement">Déplacement</option>
        </select>
      </div>
      <div>
        <label>Unité</label>
        <input value={p.unite ?? 'U'} onChange={(e) => set('unite', e.target.value)} />
      </div>
      <div>
        <label>Prix d’achat HT</label>
        <input type="number" step="0.01" className="num" value={p.prix_achat_ht ?? ''}
               onChange={(e) => majAchat(e.target.value)} />
      </div>
      <div>
        <label>Coefficient</label>
        <input type="number" step="0.001" className="num" value={p.coefficient ?? ''}
               onChange={(e) => majCoef(e.target.value)} />
      </div>
      <div>
        <label>Prix de vente HT</label>
        <input type="number" step="0.01" className="num" value={p.prix_vente_ht ?? ''}
               onChange={(e) => set('prix_vente_ht', Number(e.target.value))} />
      </div>

      {format && format.champs_standards.length > 0 && (
        <>
          <div style={{ gridColumn: 'span 6', borderTop: '1px solid var(--filet)', paddingTop: 12 }}>
            <strong style={{ fontSize: 13 }}>Caractéristiques techniques</strong>
            <p className="statut">
              Ces champs décident du taux de TVA. Un critère manquant fait basculer la ligne
              à 20 %, et le devis affichera pourquoi.
            </p>
          </div>
          {format.champs_standards.map((cle) => {
            const def = CHAMPS_STANDARDS[cle];
            if (!def) return null;
            const valeur = p[cle as keyof Produit];
            return (
              <div key={cle}>
                <label>{def.libelle}</label>
                {def.type === 'booleen' ? (
                  <select value={valeur ? 'oui' : 'non'}
                          onChange={(e) => set(cle as keyof Produit, e.target.value === 'oui')}>
                    <option value="non">Non</option>
                    <option value="oui">Oui</option>
                  </select>
                ) : def.type === 'liste' ? (
                  <select value={(valeur as string) ?? ''}
                          onChange={(e) => set(cle as keyof Produit, e.target.value || null)}>
                    <option value="">—</option>
                    {def.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : def.type === 'nombre' ? (
                  <input type="number" step="0.01" className="num" value={(valeur as number) ?? ''}
                         onChange={(e) => set(cle as keyof Produit,
                           e.target.value ? Number(e.target.value) : null)} />
                ) : (
                  <input value={(valeur as string) ?? ''}
                         onChange={(e) => set(cle as keyof Produit, e.target.value || null)} />
                )}
              </div>
            );
          })}
        </>
      )}

      {format && format.champs_libres.length > 0 && (
        <>
          <div style={{ gridColumn: 'span 6', borderTop: '1px solid var(--filet)', paddingTop: 12 }}>
            <strong style={{ fontSize: 13 }}>Fiche {format.nom.toLowerCase()}</strong>
          </div>
          {format.champs_libres.map((c) => (
            <div key={c.cle}>
              <label>{c.libelle}{c.unite ? ` (${c.unite})` : ''}</label>
              {c.type === 'booleen' ? (
                <select value={p.attributs?.[c.cle] ? 'oui' : 'non'}
                        onChange={(e) => setAttribut(c.cle, e.target.value === 'oui')}>
                  <option value="non">Non</option>
                  <option value="oui">Oui</option>
                </select>
              ) : c.type === 'liste' ? (
                <select value={(p.attributs?.[c.cle] as string) ?? ''}
                        onChange={(e) => setAttribut(c.cle, e.target.value || null)}>
                  <option value="">—</option>
                  {c.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : c.type === 'nombre' ? (
                <input type="number" step="0.01" className="num"
                       value={(p.attributs?.[c.cle] as number) ?? ''}
                       onChange={(e) => setAttribut(c.cle,
                         e.target.value ? Number(e.target.value) : null)} />
              ) : (
                <input value={(p.attributs?.[c.cle] as string) ?? ''}
                       placeholder={c.aide}
                       onChange={(e) => setAttribut(c.cle, e.target.value || null)} />
              )}
            </div>
          ))}
        </>
      )}

      <div style={{ gridColumn: 'span 6', display: 'flex', gap: 8 }}>
        <button className="action" onClick={() => void enregistrer()}>Enregistrer</button>
      </div>
    </div>
  );
}

// --- Gestion des formats ----------------------------------------------------

function GestionFormats({ formats, onErreur, onChange }: {
  formats: FormatProduit[]; onErreur: (m: string) => void; onChange: () => void;
}) {
  const [edition, setEdition] = useState<Partial<FormatProduit> | null>(null);

  return (
    <>
      <p className="statut" style={{ marginBottom: 12 }}>
        Un format décrit les champs proposés selon le type de matériel. Le jour où vous
        posez des fours, créez un format « Four » avec ses propres champs, sans toucher
        au reste du catalogue.
      </p>

      <table>
        <thead><tr><th>Format</th><th>Champs</th><th style={{ width: 120 }} /></tr></thead>
        <tbody>
          {formats.map((f) => (
            <tr key={f.id}>
              <td>
                <strong>{f.nom}</strong>
                {f.description && <div className="fiche">{f.description}</div>}
              </td>
              <td className="statut">
                {f.champs_standards.length} technique{f.champs_standards.length > 1 ? 's' : ''},{' '}
                {f.champs_libres.length} propre{f.champs_libres.length > 1 ? 's' : ''}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="action discret" onClick={() => setEdition(f)}>Modifier</button>{' '}
                <Menu actions={[
                  { libelle: 'Modifier', faire: () => setEdition(f) },
                  { libelle: 'Retirer', danger: true, faire: () => {
                      if (window.confirm(`Retirer le format ${f.nom} ?`)) {
                        void supprimerFormat(f.id).then(onChange);
                      }
                    } },
                ]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="action" style={{ marginTop: 12 }}
              onClick={() => setEdition({ nom: '', champs_standards: [], champs_libres: [], familles: [] })}>
        Nouveau format
      </button>

      {edition && (
        <Modale titre={edition.id ? `Format ${edition.nom}` : 'Nouveau format'}
                onFermer={() => setEdition(null)}>
          <FormulaireFormat format={edition} onErreur={onErreur}
                            onEnregistre={() => { setEdition(null); onChange(); }} />
        </Modale>
      )}
    </>
  );
}

function FormulaireFormat({ format, onEnregistre, onErreur }: {
  format: Partial<FormatProduit>; onEnregistre: () => void; onErreur: (m: string) => void;
}) {
  const [f, setF] = useState<Partial<FormatProduit>>({
    champs_standards: [], champs_libres: [], familles: [], ...format,
  });

  const basculerStandard = (cle: string) => setF((x) => {
    const l = x.champs_standards ?? [];
    return { ...x, champs_standards: l.includes(cle) ? l.filter((c) => c !== cle) : [...l, cle] };
  });

  const majChamp = (i: number, patch: Partial<ChampLibre>) => setF((x) => {
    const l = [...(x.champs_libres ?? [])];
    l[i] = { ...l[i], ...patch };
    return { ...x, champs_libres: l };
  });

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <label>Nom du format</label>
        <input value={f.nom ?? ''} onChange={(e) => setF((x) => ({ ...x, nom: e.target.value }))}
               placeholder="Four encastrable" />
      </div>
      <div>
        <label>Description</label>
        <input value={f.description ?? ''}
               onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} />
      </div>

      <div>
        <label>Caractéristiques techniques à proposer</label>
        <p className="statut" style={{ marginBottom: 6 }}>
          Ces champs existent déjà et alimentent le moteur de TVA. Ne cochez que ceux qui
          ont un sens pour ce type de matériel.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {Object.entries(CHAMPS_STANDARDS).map(([cle, def]) => (
            <label key={cle} style={{ display: 'flex', gap: 6, alignItems: 'center',
                                      margin: 0, color: 'var(--encre)' }}>
              <input type="checkbox" style={{ width: 'auto' }}
                     checked={(f.champs_standards ?? []).includes(cle)}
                     onChange={() => basculerStandard(cle)} />
              {def.libelle}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label>Champs propres à ce format</label>
        {(f.champs_libres ?? []).map((c, i) => (
          <div key={i} style={{ display: 'grid', gap: 8, marginBottom: 8,
                                gridTemplateColumns: '2fr 1fr 1fr auto', alignItems: 'end' }}>
            <div>
              <input value={c.libelle} placeholder="Libellé affiché"
                     onChange={(e) => majChamp(i, {
                       libelle: e.target.value,
                       cle: c.cle || e.target.value.toLowerCase()
                         .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                         .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
                     })} />
            </div>
            <select value={c.type} onChange={(e) => majChamp(i, { type: e.target.value as TypeChamp })}>
              <option value="texte">Texte</option>
              <option value="nombre">Nombre</option>
              <option value="liste">Liste</option>
              <option value="booleen">Oui / non</option>
            </select>
            <input value={c.unite ?? ''} placeholder="Unité"
                   onChange={(e) => majChamp(i, { unite: e.target.value })} />
            <button className="action discret" onClick={() => setF((x) => ({
              ...x, champs_libres: (x.champs_libres ?? []).filter((_, j) => j !== i),
            }))}>×</button>
            {c.type === 'liste' && (
              <div style={{ gridColumn: 'span 4' }}>
                <input value={(c.options ?? []).join(', ')} placeholder="Choix séparés par des virgules"
                       onChange={(e) => majChamp(i, {
                         options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean),
                       })} />
              </div>
            )}
          </div>
        ))}
        <button className="action discret" onClick={() => setF((x) => ({
          ...x, champs_libres: [...(x.champs_libres ?? []), { cle: '', libelle: '', type: 'texte' }],
        }))}>
          Ajouter un champ
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="action" onClick={() => {
          if (!f.nom?.trim()) return onErreur('Le nom du format est obligatoire.');
          void enregistrerFormat(f).then(onEnregistre)
            .catch((e) => onErreur((e as Error).message));
        }}>Enregistrer</button>
      </div>
    </div>
  );
}


// --- Déclinaisons -----------------------------------------------------------

/**
 * Une même référence existe souvent en plusieurs finitions, tailles ou niveaux
 * de difficulté, chacune avec son prix. Sans déclinaisons, il faudrait créer
 * une référence par variante et le catalogue deviendrait illisible.
 */
function GestionVariantes({ produit, variantes, onErreur, onChange }: {
  produit: Produit;
  variantes: Variante[];
  onErreur: (m: string) => void;
  onChange: () => void;
}) {
  const [v, setV] = useState<Partial<Variante>>({});

  async function ajouter() {
    if (!v.nom?.trim()) return onErreur('Donnez un nom à la déclinaison.');
    if (v.prix_vente_ht == null) return onErreur('Le prix de vente est obligatoire.');
    try {
      await enregistrerVariante({ ...v, produit_id: produit.id, position: variantes.length });
      setV({});
      onChange();
    } catch (e) { onErreur((e as Error).message); }
  }

  async function patcher(id: string, patch: Partial<Variante>) {
    try { await enregistrerVariante({ id, ...patch }); onChange(); }
    catch (e) { onErreur((e as Error).message); }
  }

  return (
    <>
      <p className="statut" style={{ marginBottom: 12 }}>
        Dans un devis, une référence à déclinaisons ne s’ajoute pas directement :
        elle se déplie pour que le choix soit explicite. La désignation imprimée
        portera la déclinaison retenue.
      </p>

      {variantes.length === 0 ? (
        <div className="vide">Aucune déclinaison. La référence s’ajoute telle quelle.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 150 }}>Référence</th>
              <th style={{ width: 190 }}>Nom</th>
              <th>Description</th>
              <th className="num" style={{ width: 110 }}>Achat HT</th>
              <th className="num" style={{ width: 110 }}>Vente HT</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {variantes.map((x) => (
              <tr key={x.id}>
                <td>
                  <input defaultValue={x.reference ?? ''} placeholder="SKIV-07-BL"
                         onBlur={(e) => void patcher(x.id, { reference: e.target.value || null })}
                         style={{ border: 0, background: 'transparent', padding: 0, fontSize: 12 }} />
                </td>
                <td>
                  <input defaultValue={x.nom}
                         onBlur={(e) => void patcher(x.id, { nom: e.target.value })}
                         style={{ border: 0, background: 'transparent', padding: 0 }} />
                </td>
                <td>
                  <input defaultValue={x.description ?? ''}
                         onBlur={(e) => void patcher(x.id, { description: e.target.value || null })}
                         style={{ border: 0, background: 'transparent', padding: 0, fontSize: 12 }} />
                </td>
                <td>
                  <input type="number" step="0.01" className="num" defaultValue={x.prix_achat_ht ?? ''}
                         onBlur={(e) => void patcher(x.id, {
                           prix_achat_ht: e.target.value ? Number(e.target.value) : null })}
                         style={{ border: 0, background: 'transparent', padding: 0 }} />
                </td>
                <td>
                  <input type="number" step="0.01" className="num" defaultValue={x.prix_vente_ht}
                         onBlur={(e) => void patcher(x.id, { prix_vente_ht: Number(e.target.value) })}
                         style={{ border: 0, background: 'transparent', padding: 0 }} />
                </td>
                <td>
                  <button className="action discret" style={{ padding: '2px 8px' }}
                          title="Retirer cette déclinaison"
                          onClick={() => void supprimerVariante(x.id).then(onChange)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'grid', gap: 10, marginTop: 14, alignItems: 'end',
                    gridTemplateColumns: '150px 190px 1fr 110px 110px auto' }}>
        <div>
          <label>Référence</label>
          <input value={v.reference ?? ''} placeholder="SKIV-07-BL"
                 onChange={(e) => setV((p) => ({ ...p, reference: e.target.value }))} />
        </div>
        <div>
          <label>Nom</label>
          <input value={v.nom ?? ''} placeholder="Gris anthracite"
                 onChange={(e) => setV((p) => ({ ...p, nom: e.target.value }))} />
        </div>
        <div>
          <label>Description</label>
          <input value={v.description ?? ''} placeholder="Finition sur commande, trois semaines"
                 onChange={(e) => setV((p) => ({ ...p, description: e.target.value }))} />
        </div>
        <div>
          <label>Achat HT</label>
          <input type="number" step="0.01" className="num" value={v.prix_achat_ht ?? ''}
                 onChange={(e) => setV((p) => ({
                   ...p, prix_achat_ht: e.target.value ? Number(e.target.value) : null }))} />
        </div>
        <div>
          <label>Vente HT</label>
          <input type="number" step="0.01" className="num" value={v.prix_vente_ht ?? ''}
                 onChange={(e) => setV((p) => ({
                   ...p, prix_vente_ht: e.target.value ? Number(e.target.value) : undefined }))} />
        </div>
        <button className="action" onClick={() => void ajouter()}>Ajouter</button>
      </div>
    </>
  );
}


// --- Relecture des brouillons -----------------------------------------------

/**
 * Le sas entre un import et le catalogue.
 *
 * Une lecture automatique se trompe : désignation tronquée, prix d'achat
 * absent, unité fantaisiste. Publier sans relire abîmerait le catalogue, qui
 * sert ensuite à chiffrer — et un mauvais prix d'achat ne se voit pas, il se
 * découvre à la facture. Tout se corrige donc ici, en place, avant publication.
 */
function Relecture({ brouillons, onErreur, onChange, onRetour, onOuvrir }: {
  brouillons: Produit[];
  onErreur: (m: string) => void;
  onChange: () => void;
  onRetour: () => void;
  onOuvrir: (p: Produit) => void;
}) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [travail, setTravail] = useState(false);

  const basculer = (id: string) => setSelection((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const tout = () => setSelection((s) =>
    s.size === brouillons.length ? new Set() : new Set(brouillons.map((b) => b.id)));

  async function patcher(id: string, patch: Partial<Produit>) {
    try { await enregistrerProduit({ id, ...patch }); onChange(); }
    catch (e) { onErreur((e as Error).message); }
  }

  const retenus = brouillons.filter((b) => selection.has(b.id));
  const sansAchat = retenus.filter((b) => b.prix_achat_ht == null).length;
  const sansPrix  = retenus.filter((b) => !Number(b.prix_vente_ht)).length;

  async function publier() {
    if (sansPrix > 0 && !window.confirm(
      `${sansPrix} référence(s) sont à 0 € de vente. Les publier quand même ?`)) return;
    setTravail(true);
    try {
      await publierProduits([...selection]);
      setSelection(new Set());
      onChange();
    } catch (e) { onErreur((e as Error).message); }
    setTravail(false);
  }

  async function jeter() {
    if (!window.confirm(
      `Supprimer définitivement ${selection.size} brouillon(s) ? Ils n’ont jamais servi à chiffrer.`)) return;
    setTravail(true);
    try {
      await supprimerBrouillons([...selection]);
      setSelection(new Set());
      onChange();
    } catch (e) { onErreur((e as Error).message); }
    setTravail(false);
  }

  return (
    <>
      <div className="entete">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="action discret" onClick={onRetour}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 18l-6-6 6-6" />
            </svg>
            Catalogue
          </button>
          <h1>Brouillons à relire</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="action discret" onClick={() => aller('/catalogue/remplir')}>
            Importer encore
          </button>
          <button className="action discret" disabled={travail || selection.size === 0}
                  onClick={() => void jeter()}>
            Supprimer ({selection.size})
          </button>
          <button className="action" disabled={travail || selection.size === 0}
                  onClick={() => void publier()}>
            Publier ({selection.size})
          </button>
        </div>
      </div>

      {brouillons.length === 0 ? (
        <div className="vide">
          Aucun brouillon en attente. Les références importées arrivent ici avant
          d’entrer au catalogue.
        </div>
      ) : (
        <>
          <p className="statut" style={{ marginBottom: 10 }}>
            Corrigez en place, cochez ce qui tient, publiez. Une référence sans prix
            d’achat entrera au catalogue sans marge calculable : elle apparaîtra à
            zéro en Rentabilité, ce qui est pire qu’une absence.
            {sansAchat > 0 && ` ${sansAchat} des références cochées sont dans ce cas.`}
          </p>

          <div className="tableau-defilant">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input type="checkbox" style={{ width: 'auto' }}
                           aria-label="Tout sélectionner"
                           checked={selection.size === brouillons.length && brouillons.length > 0}
                           onChange={tout} />
                  </th>
                  <th style={{ width: 140 }}>Référence</th>
                  <th>Désignation</th>
                  <th style={{ width: 120 }}>Famille</th>
                  <th style={{ width: 60 }}>Unité</th>
                  <th className="num" style={{ width: 105 }}>Achat HT</th>
                  <th className="num" style={{ width: 105 }}>Vente HT</th>
                  <th className="num" style={{ width: 80 }}>Marge</th>
                  <th style={{ width: 110 }}>Origine</th>
                  <th style={{ width: 90 }} className="sans-impression" />
                </tr>
              </thead>
              <tbody>
                {brouillons.map((b) => {
                  const achat = b.prix_achat_ht != null ? Number(b.prix_achat_ht) : null;
                  const vente = Number(b.prix_vente_ht);
                  const pct = achat != null && vente > 0 ? ((vente - achat) / vente) * 100 : null;
                  return (
                    <tr key={b.id} className="brouillon">
                      <td>
                        <input type="checkbox" style={{ width: 'auto' }}
                               aria-label={`Retenir ${b.reference}`}
                               checked={selection.has(b.id)} onChange={() => basculer(b.id)} />
                      </td>
                      <td>
                        <input defaultValue={b.reference} className="ref"
                               onBlur={(e) => e.target.value !== b.reference
                                 && void patcher(b.id, { reference: e.target.value })}
                               style={{ padding: '3px 5px', fontSize: 12 }} />
                      </td>
                      <td>
                        <input defaultValue={b.designation}
                               onBlur={(e) => e.target.value !== b.designation
                                 && void patcher(b.id, { designation: e.target.value })}
                               style={{ padding: '3px 5px' }} />
                        {b.description && <div className="fiche">{b.description}</div>}
                      </td>
                      <td>
                        <select defaultValue={b.famille} style={{ padding: '3px 5px', fontSize: 12 }}
                                onChange={(e) => void patcher(b.id,
                                  { famille: e.target.value as Famille })}>
                          {FAMILLES.map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </td>
                      <td>
                        <input defaultValue={b.unite}
                               onBlur={(e) => e.target.value !== b.unite
                                 && void patcher(b.id, { unite: e.target.value })}
                               style={{ padding: '3px 5px', fontSize: 12 }} />
                      </td>
                      <td>
                        <input type="number" step="0.01" className="num"
                               defaultValue={b.prix_achat_ht ?? ''}
                               onBlur={(e) => void patcher(b.id, {
                                 prix_achat_ht: e.target.value ? Number(e.target.value) : null })}
                               style={{ padding: '3px 5px' }} />
                      </td>
                      <td>
                        <input type="number" step="0.01" className="num"
                               defaultValue={b.prix_vente_ht}
                               onBlur={(e) => void patcher(b.id,
                                 { prix_vente_ht: Number(e.target.value) })}
                               style={{ padding: '3px 5px' }} />
                      </td>
                      <td className="num statut">
                        {pct != null ? `${pct.toFixed(0)} %` : '—'}
                        {achat != null && <div>{eur(vente - achat)}</div>}
                      </td>
                      <td className="ref">
                        {b.origine ?? '—'}
                        {b.importe_le && (
                          <div>{new Date(b.importe_le).toLocaleDateString('fr-FR')}</div>
                        )}
                      </td>
                      <td className="sans-impression">
                        <button className="action discret" style={{ padding: '2px 8px' }}
                                onClick={() => onOuvrir(b)}>
                          Fiche
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="statut" style={{ marginTop: 10 }}>
            Publier ne recopie rien : le brouillon devient la référence, avec son
            identifiant. Un devis établi plus tard pointera dessus sans rupture.
          </p>
        </>
      )}
    </>
  );
}
