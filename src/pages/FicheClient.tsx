import { useCallback, useEffect, useState } from 'react';
import { aller } from '../lib/router';
import { eur } from '../lib/calcul';
import { voitLesPrix } from '../lib/session';
import {
  ajouterFil, chargerTiers, enregistrerSite, enregistrerTiers, listerChantiers, listerDevis,
  listerFil, listerSites, traiterFil,
} from '../lib/db';
import type { Chantier, Devis, Fil, Site, Tiers, TypeFil } from '../lib/types';
import FilAriane from '../components/FilAriane';
import ChampAdresse from '../components/ChampAdresse';

const LIBELLE_FIL: Record<TypeFil, string> = {
  appel_entrant: 'Appel reçu', appel_manque: 'Appel manqué', appel_sortant: 'Appel passé',
  email_recu: 'E-mail reçu', email_envoye: 'E-mail envoyé', sms: 'SMS', note: 'Note',
  visite: 'Visite', devis_envoye: 'Devis envoyé', devis_signe: 'Devis signé',
  relance: 'Relance', systeme: 'Événement',
};

/** La fiche client : tout ce qui s'est dit et fait, au même endroit. */
export default function PageFicheClient({ tiersId }: { tiersId: string }) {
  const [tiers, setTiers] = useState<Tiers | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [fil, setFil] = useState<Fil[]>([]);
  const [devis, setDevis] = useState<Devis[]>([]);
  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const recharger = useCallback(async () => {
    try {
      const [t, s, f, d, c] = await Promise.all([
        chargerTiers(tiersId), listerSites(tiersId), listerFil({ tiersId }),
        voitLesPrix() ? listerDevis() : Promise.resolve([]), listerChantiers(),
      ]);
      setTiers(t); setSites(s); setFil(f);
      setDevis(d.filter((x) => x.tiers_id === tiersId));
      setChantiers(c.filter((x) => x.tiers_id === tiersId));
    } catch (e) { setErreur((e as Error).message); }
  }, [tiersId]);

  useEffect(() => { void recharger(); }, [recharger]);

  async function ajouterNote() {
    if (!note.trim()) return;
    try {
      await ajouterFil({ tiers_id: tiersId, type: 'note', contenu: note.trim() });
      setNote('');
      void recharger();
    } catch (e) { setErreur((e as Error).message); }
  }

  if (!tiers) return erreur ? <div className="erreur">{erreur}</div> : null;

  return (
    <>
      <FilAriane etapes={[
        { libelle: 'Aujourd’hui', vers: '/bord' },
        { libelle: 'Clients', vers: '/clients' },
        { libelle: tiers.nom },
      ]} />

      <div className="entete">
        <div>
          <h1>{tiers.nom}</h1>
          <div className="statut">
            {tiers.categorie} · {tiers.type}
            {tiers.telephone ? ` · ${tiers.telephone}` : ''}
            {tiers.email ? ` · ${tiers.email}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tiers.categorie === 'prospect' && (
            <button className="action discret"
                    onClick={() => void enregistrerTiers({ id: tiers.id, categorie: 'client' }).then(recharger)}>
              Convertir en client
            </button>
          )}
          <button className="action discret" onClick={() => aller('/clients')}>Retour</button>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 20 }}>
        <div>
          <h2 style={{ marginBottom: 8 }}>Historique</h2>
          <div className="panneau" style={{ gridTemplateColumns: '1fr auto', marginBottom: 14 }}>
            <input placeholder="Ajouter une note : ce qui a été dit, promis, décidé…"
                   value={note} onChange={(e) => setNote(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && void ajouterNote()} />
            <button className="action" onClick={() => void ajouterNote()}>Noter</button>
          </div>

          {fil.length === 0 ? (
            <div className="vide">Aucun échange enregistré.</div>
          ) : (
            <div>
              {fil.map((f) => (
                <div key={f.id} style={{
                  borderLeft: `3px solid ${f.a_traiter ? 'var(--alerte)' : 'var(--filet)'}`,
                  background: 'var(--surface)', padding: '10px 14px', marginBottom: 6,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <strong style={{ fontSize: 13 }}>{LIBELLE_FIL[f.type]}</strong>
                    <span className="statut">
                      {new Date(f.occurred_at).toLocaleString('fr-FR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {f.sujet && <div>{f.sujet}</div>}
                  {f.contenu && <div className="fiche">{f.contenu}</div>}
                  {f.a_traiter && (
                    <button className="action discret" style={{ marginTop: 6, padding: '2px 8px' }}
                            onClick={() => void traiterFil(f.id).then(recharger)}>
                      Marquer traité
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <aside>
          <h2 style={{ marginBottom: 8 }}>Sites</h2>
          <Sites tiersId={tiersId} sites={sites} onErreur={setErreur} onEnregistre={recharger} />

          {voitLesPrix() && (
            <>
              <h2 style={{ margin: '18px 0 8px' }}>Devis</h2>
              {devis.length === 0 ? <p className="statut">Aucun devis.</p> : (
                <div className="panneau" style={{ display: 'block' }}>
                  {devis.map((d) => (
                    <div key={d.id} style={{ marginBottom: 6 }}>
                      <a href={`#/devis/${d.id}`}>{d.numero}</a>{' '}
                      <span className="statut">{d.statut}</span>
                      {d.remise_montant > 0 && <span className="statut"> · remise {eur(d.remise_montant)}</span>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <h2 style={{ margin: '18px 0 8px' }}>Chantiers</h2>
          {chantiers.length === 0 ? <p className="statut">Aucun chantier.</p> : (
            <div className="panneau" style={{ display: 'block' }}>
              {chantiers.map((c) => (
                <div key={c.id} style={{ marginBottom: 6 }}>
                  <a href={`#/chantiers/${c.id}`}>{c.numero}</a>{' '}
                  <span className="statut">{c.libelle} · {c.statut}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function Sites({ tiersId, sites, onErreur, onEnregistre }:
  { tiersId: string; sites: Site[]; onErreur: (m: string) => void; onEnregistre: () => void }) {
  const [s, setS] = useState<Partial<Site>>({ usage_local: 'habitation' });
  const [ouvert, setOuvert] = useState(false);

  async function ajouter() {
    if (!s.adresse) return onErreur('L’adresse du site est obligatoire.');
    try {
      await enregistrerSite({ ...s, tiers_id: tiersId });
      setS({ usage_local: 'habitation' }); setOuvert(false); onEnregistre();
    } catch (e) { onErreur((e as Error).message); }
  }

  return (
    <div className="panneau" style={{ display: 'block' }}>
      {sites.map((site) => (
        <div key={site.id} style={{ marginBottom: 8 }}>
          <strong>{site.adresse}</strong>{site.ville ? `, ${site.ville}` : ''}
          <div className="statut">
            {site.usage_local}
            {site.annee_achevement
              ? `, achevé en ${site.annee_achevement}`
              : ', année inconnue → TVA à 20 %'}
            {site.en_copropriete ? ', copropriété' : ''}
          </div>
        </div>
      ))}
      {sites.length === 0 && <p className="statut">Aucun site.</p>}

      {ouvert ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <div><label>Adresse</label>
            <ChampAdresse valeur={s.adresse ?? ''}
              onChange={(v) => setS((p) => ({ ...p, adresse: v }))}
              onChoisir={(sug) => setS((p) => ({
                ...p, adresse: sug.voie || sug.texte,
                code_postal: sug.codePostal || p.code_postal,
                ville: sug.ville || p.ville,
              }))} /></div>
          <div><label>Ville</label>
            <input value={s.ville ?? ''} onChange={(e) => setS((p) => ({ ...p, ville: e.target.value }))} /></div>
          <div><label>Usage</label>
            <select value={s.usage_local}
                    onChange={(e) => setS((p) => ({ ...p, usage_local: e.target.value as Site['usage_local'] }))}>
              <option value="habitation">Habitation</option>
              <option value="mixte">Mixte</option>
              <option value="professionnel">Professionnel</option>
            </select></div>
          <div><label>Année d’achèvement</label>
            <input type="number" className="num" placeholder="1998" value={s.annee_achevement ?? ''}
                   onChange={(e) => setS((p) => ({ ...p, annee_achevement: e.target.value ? Number(e.target.value) : null }))} /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="action" onClick={() => void ajouter()}>Ajouter</button>
            <button className="action discret" onClick={() => setOuvert(false)}>Annuler</button>
          </div>
        </div>
      ) : (
        <button className="action discret" style={{ marginTop: 8 }} onClick={() => setOuvert(true)}>
          Ajouter un site
        </button>
      )}
    </div>
  );
}
