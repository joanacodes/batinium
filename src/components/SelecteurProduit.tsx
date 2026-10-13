import { useEffect, useMemo, useRef, useState } from 'react';
import { eur } from '../lib/calcul';
import { resoudrePhotos } from '../lib/db';
import type { Nature, Produit, Variante } from '../lib/types';

type Onglet = 'tout' | 'produit' | 'service';

/**
 * Ajout d'une ligne au devis. C'est le geste le plus répété de l'application :
 * une recherche, des filtres, des photos, et la variante choisie d'un clic.
 */
export default function SelecteurProduit({
  produits, variantes, onChoisir, onFermer,
}: {
  produits: Produit[];
  variantes: Variante[];
  onChoisir: (p: Produit, quantite: number, variante?: Variante) => void;
  onFermer: () => void;
}) {
  const [q, setQ] = useState('');
  const [onglet, setOnglet] = useState<Onglet>('tout');
  const [famille, setFamille] = useState('');
  const [index, setIndex] = useState(0);
  const [quantite, setQuantite] = useState(1);
  const [deplie, setDeplie] = useState<string | null>(null);
  // Ce qui a été ajouté depuis l'ouverture, pour que l'ajout se voie.
  const [ajoutes, setAjoutes] = useState<Record<string, number>>({});
  const [dernier, setDernier] = useState<string | null>(null);
  const champ = useRef<HTMLInputElement>(null);
  // Seau privé : les vignettes réclament des liens signés, demandés en un lot.
  const [photos, setPhotos] = useState<Record<string, string>>({});

  useEffect(() => {
    let vivant = true;
    resoudrePhotos(produits)
      .then((m) => vivant && setPhotos(m))
      .catch(() => { /* une vignette absente ne bloque pas l'ajout d'une ligne */ });
    return () => { vivant = false; };
  }, [produits]);

  /** Compte l'ajout, fait clignoter la ligne, puis passe la main au parent. */
  function retenir(p: Produit, q: number, v?: Variante) {
    const cle = v ? `${p.id}:${v.id}` : p.id;
    setAjoutes((a) => ({ ...a, [cle]: (a[cle] ?? 0) + 1 }));
    setDernier(cle);
    window.setTimeout(() => setDernier((d) => (d === cle ? null : d)), 900);
    onChoisir(p, q, v);
  }

  useEffect(() => champ.current?.focus(), []);
  useEffect(() => setIndex(0), [q, onglet, famille]);

  useEffect(() => {
    const echap = (e: KeyboardEvent) => e.key === 'Escape' && onFermer();
    document.addEventListener('keydown', echap);
    return () => document.removeEventListener('keydown', echap);
  }, [onFermer]);

  const estService = (n: Nature) => n !== 'fourniture';

  const familles = useMemo(
    () => [...new Set(produits.map((p) => p.famille))].sort(),
    [produits],
  );

  const resultats = useMemo(() => {
    const terme = q.trim().toLowerCase();
    return produits
      .filter((p) => onglet === 'tout'
        || (onglet === 'service' ? estService(p.nature) : !estService(p.nature)))
      .filter((p) => !famille || p.famille === famille)
      .filter((p) => !terme ||
        `${p.reference} ${p.designation} ${p.famille} ${p.description ?? ''}`
          .toLowerCase().includes(terme))
      .slice(0, 60);
  }, [q, onglet, famille, produits]);

  const variantesDe = (id: string) =>
    variantes.filter((v) => v.produit_id === id && v.actif)
      .sort((a, b) => a.position - b.position);

  function clavier(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, resultats.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const p = resultats[index];
      if (p) {
        const v = variantesDe(p.id);
        // Avec des variantes, on déplie plutôt que de choisir à la place de l'utilisateur.
        if (v.length > 0) setDeplie(p.id);
        else retenir(p, quantite);
      }
    }
  }

  const compte = (o: Onglet) => produits.filter((p) => o === 'tout'
    || (o === 'service' ? estService(p.nature) : !estService(p.nature))).length;

  return (
    <div className="voile" onClick={onFermer} style={{ paddingTop: '6vh' }}>
      <div className="modale" style={{ width: 'min(900px, 95vw)', display: 'flex',
                                       flexDirection: 'column', maxHeight: '82vh' }}
           onClick={(e) => e.stopPropagation()} role="dialog"
           aria-label="Ajouter un produit ou un service">

        <div className="modale-entete">
          <h2>Ajouter un produit ou un service</h2>
          <button className="action discret" onClick={onFermer}>Fermer</button>
        </div>

        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--filet)',
                      display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input ref={champ} placeholder="Référence, désignation, description…"
                   value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={clavier} />
            <div style={{ width: 110 }}>
              <input type="number" step="0.01" min="0" className="num" title="Quantité"
                     value={quantite} onChange={(e) => setQuantite(Number(e.target.value))}
                     onKeyDown={clavier} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {(['tout', 'produit', 'service'] as Onglet[]).map((o) => (
              <button key={o} onClick={() => setOnglet(o)}
                style={{
                  font: 'inherit', fontSize: 13, cursor: 'pointer', padding: '4px 12px',
                  border: `1px solid ${onglet === o ? 'var(--bleu)' : 'var(--filet)'}`,
                  background: onglet === o ? 'var(--bleu-pale)' : 'var(--surface)',
                  color: onglet === o ? 'var(--encre)' : 'var(--encre-pale)',
                  borderRadius: 3,
                }}>
                {o === 'tout' ? 'Tout' : o === 'produit' ? 'Produits' : 'Services et pose'}
                <span className="num" style={{ opacity: .6, marginLeft: 6 }}>{compte(o)}</span>
              </button>
            ))}
            <select value={famille} onChange={(e) => setFamille(e.target.value)}
                    style={{ width: 190, marginLeft: 'auto' }}>
              <option value="">Toutes les familles</option>
              {familles.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {resultats.length === 0 ? (
            <div className="vide" style={{ border: 0 }}>
              Aucune référence ne correspond. Ajoutez-la depuis le catalogue.
            </div>
          ) : (
            <table>
              <tbody>
                {resultats.map((p, i) => {
                  const v = variantesDe(p.id);
                  const ouvert = deplie === p.id;
                  return (
                    <>
                      <tr key={p.id} className="cliquable"
                          style={
                            dernier === p.id ? { background: '#eaf6ee' }
                              : i === index ? { background: 'var(--bleu-pale)' } : undefined
                          }
                          onMouseEnter={() => setIndex(i)}
                          onClick={() => v.length > 0
                            ? setDeplie(ouvert ? null : p.id)
                            : retenir(p, quantite)}>
                        <td style={{ width: 62 }}>
                          {photos[p.id]
                            ? <img src={photos[p.id]} alt="" className="vignette" />
                            : <span className="vignette" style={{
                                display: 'grid', placeItems: 'center',
                                color: 'var(--encre-pale)', fontSize: 11,
                              }}>{p.nature === 'fourniture' ? '—' : 'h'}</span>}
                        </td>
                        <td className="ref" style={{ width: 140 }}>{p.reference}</td>
                        <td>
                          {p.designation}
                          <div className="statut">
                            {p.famille} · {p.nature === 'fourniture' ? 'produit' : 'service'}
                            {p.reversible ? ` · ${p.puissance_kw} kW ${p.classe_froid ?? ''}` : ''}
                            {v.length > 0 && ` · ${v.length} variantes`}
                          </div>
                        </td>
                        <td className="num" style={{ width: 120 }}>
                          {v.length > 0
                            ? <span className="statut">à partir de<br />{eur(Math.min(...v.map((x) => Number(x.prix_vente_ht))))}</span>
                            : eur(Number(p.prix_vente_ht))}
                        </td>
                        <td style={{ width: 88 }}>
                          {ajoutes[p.id] ? (
                            <span className="jeton" data-r="recu">
                              ajouté{ajoutes[p.id] > 1 ? ` ×${ajoutes[p.id]}` : ''}
                            </span>
                          ) : null}
                        </td>
                      </tr>

                      {ouvert && v.map((x) => (
                        <tr key={x.id} className="cliquable"
                            style={{ background: dernier === `${p.id}:${x.id}`
                              ? '#eaf6ee' : 'var(--papier)' }}
                            onClick={() => retenir(p, quantite, x)}>
                          <td />
                          <td className="ref">{x.reference ?? ''}</td>
                          <td style={{ paddingLeft: 22 }}>
                            <strong>{x.nom}</strong>
                            {x.description && <div className="statut">{x.description}</div>}
                          </td>
                          <td className="num">{eur(Number(x.prix_vente_ht))}</td>
                          <td>
                            {ajoutes[`${p.id}:${x.id}`] ? (
                              <span className="jeton" data-r="recu">
                                ajouté{ajoutes[`${p.id}:${x.id}`] > 1
                                  ? ` ×${ajoutes[`${p.id}:${x.id}`]}` : ''}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: 10, borderTop: '1px solid var(--filet)',
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="statut">
            Flèches pour naviguer, Entrée pour ajouter, Échap pour fermer.
            Une référence à déclinaisons se déplie au lieu de s’ajouter directement.
          </span>
          {Object.keys(ajoutes).length > 0 && (
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="jeton" data-r="recu">
                {Object.values(ajoutes).reduce((a, b) => a + b, 0)} ligne
                {Object.values(ajoutes).reduce((a, b) => a + b, 0) > 1 ? 's' : ''} ajoutée
                {Object.values(ajoutes).reduce((a, b) => a + b, 0) > 1 ? 's' : ''}
              </span>
              <button className="action" onClick={onFermer}>Terminé</button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
