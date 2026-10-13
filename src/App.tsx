import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { aller, useRoute } from './lib/router';
import {
  basculerVue, chargerMembre, enDemonstration, memoriserJetonGoogle, oublierMembre,
  roleReel, voitLesPrix,
} from './lib/session';
import { listerChantiers, listerDemandes, listerDevis } from './lib/db';
import type { Membre, Role } from './lib/types';
import Connexion, { NouveauMotDePasse } from './components/Connexion';
import Bienvenue from './pages/Bienvenue';
import Cloche from './components/Cloche';
import Assistant from './components/Assistant';
import FilAriane from './components/FilAriane';
import Icone, { Chevron } from './components/Icone';
import Garde from './components/Garde';
import PageTableauDeBord from './pages/TableauDeBord';
import PageDemandes from './pages/Demandes';
import PageTaches from './pages/Taches';
import PageCalendrier from './pages/Calendrier';
import PageBoite from './pages/Boite';
import PageDevis from './pages/Devis';
import PageFactures from './pages/Factures';
import PageFacture from './pages/Facture';
import PageEditeur from './pages/Editeur';
import PageImpression from './pages/Impression';
import PageClients from './pages/Clients';
import PageFicheClient from './pages/FicheClient';
import PageChantiers from './pages/Chantiers';
import PageFicheChantier from './pages/FicheChantier';
import PageFichePose from './pages/FichePose';
import PagePointage from './pages/Pointage';
import PageMaJournee from './pages/MaJournee';
import PageJournal from './pages/Journal';
import PageCatalogue from './pages/Catalogue';
import PageRemplirCatalogue from './pages/RemplirCatalogue';
import PageImport from './pages/Import';
import PageDepenses from './pages/Depenses';
import PageAchats from './pages/Achats';
import PagePvReception from './pages/PvReception';
import PageEquipe from './pages/Equipe';
import PageFicheMembre from './pages/FicheMembre';
import PageFicheSousTraitant from './pages/FicheSousTraitant';
import PageAnalytique from './pages/Analytique';
import PageConnexions from './pages/Connexions';
import PageParametres from './pages/Parametres';
import PageDonnees from './pages/Donnees';
import PageFicheFluide from './pages/FicheFluide';

interface Entree {
  cle: string;
  libelle: string;
  prix?: boolean;
  groupe: string;
  /** Les entrées dépliables affichent leurs éléments récents. */
  depliable?: boolean;
}

const MENU: Entree[] = [
  { cle: 'bord',       libelle: 'Aujourd’hui', groupe: 'Pilotage' },
  { cle: 'taches',     libelle: 'Tâches',      groupe: 'Pilotage' },
  { cle: 'calendrier', libelle: 'Calendrier',  groupe: 'Pilotage' },
  { cle: 'analytique', libelle: 'Rentabilité', groupe: 'Pilotage', prix: true },
  { cle: 'depenses',   libelle: 'Dépenses',    groupe: 'Pilotage', prix: true },
  { cle: 'achats',     libelle: 'Achats',      groupe: 'Pilotage', prix: true },

  { cle: 'demandes',   libelle: 'Demandes',    groupe: 'Commerce' },
  // Juste sous Demandes : une demande devient un client, c'est le même geste
  // et ça se lit dans cet ordre.
  { cle: 'clients',    libelle: 'Clients',     groupe: 'Commerce' },
  { cle: 'boite',      libelle: 'Boîte mail',  groupe: 'Commerce' },
  { cle: 'devis',      libelle: 'Devis',       groupe: 'Commerce', prix: true, depliable: true },
  { cle: 'factures',   libelle: 'Factures',    groupe: 'Commerce', prix: true },
  { cle: 'import',     libelle: 'Import de devis', groupe: 'Commerce', prix: true },

  { cle: 'chantiers',  libelle: 'Chantiers',   groupe: 'Terrain', depliable: true },
  { cle: 'heures',     libelle: 'Heures',      groupe: 'Terrain' },
  { cle: 'journal',    libelle: 'Journal',     groupe: 'Terrain' },
  { cle: 'equipe',     libelle: 'Équipe',      groupe: 'Terrain' },

  { cle: 'catalogue',  libelle: 'Catalogue',   groupe: 'Réglages', prix: true },
  { cle: 'connexions', libelle: 'Connexions',  groupe: 'Réglages', prix: true },
  { cle: 'reglages',   libelle: 'Entreprise',  groupe: 'Réglages', prix: true },
  { cle: 'donnees',    libelle: 'Données',     groupe: 'Réglages', prix: true },
];

const CLE_REPLI = 'batinium.menu.replie';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [membre, setMembre] = useState<Membre | null>(null);
  const [pret, setPret] = useState(false);
  // Suivre le lien de réinitialisation ouvre déjà une session : sans cet
  // écran, on arriverait directement dans Batinium, connecté, sans jamais
  // avoir choisi le mot de passe qu'on venait justement changer.
  const [recuperation, setRecuperation] = useState(false);

  const initialiser = useCallback(async (s: Session | null) => {
    setSession(s);
    memoriserJetonGoogle(s?.provider_token);
    if (!s) { oublierMembre(); setMembre(null); setPret(true); return; }
    try { setMembre(await chargerMembre(s.user.id)); } catch { setMembre(null); }
    setPret(true);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => void initialiser(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === 'PASSWORD_RECOVERY') setRecuperation(true);
      void initialiser(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [initialiser]);

  if (!pret) return null;
  if (recuperation && session) {
    return <NouveauMotDePasse onTermine={() => setRecuperation(false)} />;
  }
  if (!session) return <Connexion />;
  if (!membre) {
    return <Bienvenue email={session.user.email ?? ''} onRattache={() => void initialiser(session)} />;
  }
  return <Atelier membre={membre} />;
}

interface Raccourci { id: string; libelle: string; detail?: string }

const LIBELLE_ROLE: Record<Role, string> = {
  direction: 'direction', chef_chantier: 'chef de chantier',
  technicien: 'technicien', sous_traitant: 'sous-traitant',
};

function Atelier({ membre }: { membre: Membre }) {
  const route = useRoute();
  const [replie, setReplie] = useState(
    () => window.localStorage.getItem(CLE_REPLI) === 'oui',
  );
  const [deplies, setDeplies] = useState<Set<string>>(new Set());
  const [aTraiter, setATraiter] = useState(0);
  // Sur petit écran, le rail sort du flux et devient un tiroir. Il se referme
  // à chaque navigation : un menu qui reste ouvert par-dessus la page qu'on
  // vient d'ouvrir est un menu qu'on referme à la main à chaque fois.
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [raccourcis, setRaccourcis] = useState<Record<string, Raccourci[]>>({});
  const [erreurVue, setErreurVue] = useState<string | null>(null);

  function vue(role: Role) {
    setErreurVue(null);
    basculerVue(role).catch((e) => setErreurVue((e as Error).message));
  }

  useEffect(() => {
    window.localStorage.setItem(CLE_REPLI, replie ? 'oui' : 'non');
  }, [replie]);

  useEffect(() => { setMenuOuvert(false); }, [route.section, route.id]);

  useEffect(() => {
    listerDemandes()
      .then((d) => setATraiter(
        d.filter((x) => !x.repondu && !['perdue', 'spam'].includes(x.statut)).length))
      .catch(() => setATraiter(0));
  }, [route.section]);

  // Les éléments récents des entrées dépliables, chargés à la demande
  const charger = useCallback(async (cle: string) => {
    if (raccourcis[cle]) return;
    try {
      if (cle === 'chantiers') {
        const c = await listerChantiers();
        setRaccourcis((r) => ({ ...r, chantiers: c.slice(0, 8).map((x) => ({
          id: x.id, libelle: x.numero, detail: x.libelle,
        })) }));
      } else if (cle === 'devis') {
        const d = await listerDevis();
        setRaccourcis((r) => ({ ...r, devis: d.slice(0, 8).map((x) => ({
          id: x.id, libelle: x.numero, detail: x.tiers?.nom ?? x.titre ?? '',
        })) }));
      }
    } catch { /* le menu ne doit jamais casser l'application */ }
  }, [raccourcis]);

  function basculer(cle: string) {
    setDeplies((p) => {
      const n = new Set(p);
      if (n.has(cle)) n.delete(cle);
      else { n.add(cle); void charger(cle); }
      return n;
    });
  }

  // Le devis imprimable occupe toute la page, sans navigation.
  if (route.section === 'imprimer' && route.id) return <PageImpression devisId={route.id} />;
  if (route.section === 'pv' && route.id) return <PagePvReception chantierId={route.id} />;

  const entrees = MENU.filter((e) => !e.prix || voitLesPrix());
  const groupes = [...new Set(entrees.map((e) => e.groupe))];

  return (
    <div className="app" data-replie={replie ? 'oui' : 'non'}
         data-menu={menuOuvert ? 'ouvert' : 'ferme'}>
      {menuOuvert && (
        <button className="voile-menu sans-impression" aria-label="Fermer le menu"
                onClick={() => setMenuOuvert(false)} />
      )}
      <nav className="rail sans-impression" aria-label="Navigation">
        <div className="rail-tete">
          {!replie && <div className="marque">Bat<em>inium</em></div>}
          <button className="rail-bascule" onClick={() => setReplie(!replie)}
                  title={replie ? 'Déplier le menu' : 'Replier le menu'}
                  aria-label={replie ? 'Déplier le menu' : 'Replier le menu'}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 5h18M3 12h18M3 19h18" />
            </svg>
          </button>
        </div>

        <div className="rail-corps">
          {groupes.map((g) => (
            <div key={g}>
              {!replie && <div className="rail-groupe">{g}</div>}
              {replie && <div className="rail-trait" />}
              {entrees.filter((e) => e.groupe === g).map((e) => {
                const actif = route.section === e.cle;
                const ouvert = deplies.has(e.cle);
                return (
                  <div key={e.cle}>
                    <div className="rail-ligne" data-actif={actif ? 'oui' : 'non'}>
                      <button className="rail-lien" onClick={() => aller(`/${e.cle}`)}
                              title={replie ? e.libelle : undefined}>
                        <Icone nom={e.cle} />
                        {!replie && <span className="rail-texte">{e.libelle}</span>}
                        {e.cle === 'demandes' && aTraiter > 0 && (
                          <span className="pastille">{aTraiter}</span>
                        )}
                      </button>
                      {e.depliable && !replie && (
                        <button className="rail-chevron" onClick={() => basculer(e.cle)}
                                aria-label={`Voir les ${e.libelle.toLowerCase()}`}
                                aria-expanded={ouvert}>
                          <Chevron ouvert={ouvert} />
                        </button>
                      )}
                    </div>
                    {e.depliable && ouvert && !replie && (
                      <div className="rail-enfants">
                        {(raccourcis[e.cle] ?? []).length === 0 ? (
                          <div className="rail-vide">Rien pour l’instant</div>
                        ) : (
                          raccourcis[e.cle].map((r) => (
                            <button key={r.id} onClick={() => aller(`/${e.cle}/${r.id}`)}
                                    data-actif={route.id === r.id ? 'oui' : 'non'}
                                    title={r.detail}>
                              <span className="rail-num">{r.libelle}</span>
                              {r.detail && <span className="rail-detail">{r.detail}</span>}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="rail-pied">
          {!replie && (
            <div className="statut">
              {membre.nom}<br />{LIBELLE_ROLE[membre.role]}{enDemonstration() ? ' (démonstration)' : ''}
            </div>
          )}
          {/* Se déconnecter vit ici, sous le nom de la personne connectée. Sur
              téléphone et tablette, c'est le seul endroit : la barre du haut,
              toujours à l'écran, garde sa place pour ce qui sert à chaque page. */}
          <button className="rail-lien rail-sortie" onClick={() => void supabase.auth.signOut()}
                  title={replie ? 'Se déconnecter' : undefined}
                  aria-label={replie ? 'Se déconnecter' : undefined}>
            <Icone nom="deconnexion" />
            {!replie && <span className="rail-texte">Se déconnecter</span>}
          </button>
        </div>
      </nav>

      <div className="colonne">
        <header className="barre sans-impression">
          {/* Visible seulement sous 900 px : au-dessus, le rail porte son
              propre bouton et celui-ci ferait double emploi. */}
          <button className="menu-poignee" aria-label="Ouvrir le menu"
                  aria-expanded={menuOuvert}
                  onClick={() => setMenuOuvert(!menuOuvert)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              <path d="M3 5h18M3 12h18M3 19h18" />
            </svg>
          </button>
          {replie && <div className="marque">Bat<em>inium</em></div>}
          <div className="pousse" />
          {/* Le mode démonstration (SQL 38), pour la direction seulement.
              Temporaire : il partira avec le SQL 38. */}
          {roleReel() === 'direction' && (
            <select className="choix-vue" value={membre.role} aria-label="Voir Batinium comme"
                    onChange={(e) => vue(e.target.value as Role)}>
              <option value="direction">Vue direction</option>
              <option value="chef_chantier">Vue chef de chantier</option>
              <option value="technicien">Vue technicien</option>
              <option value="sous_traitant">Vue sous-traitant</option>
            </select>
          )}
          <Cloche />
          <button className="action discret barre-quitter" onClick={() => void supabase.auth.signOut()}>
            Quitter
          </button>
        </header>
        <main>
          {erreurVue && <div className="erreur">{erreurVue}</div>}
          {enDemonstration() && (
            <div className="bandeau-demo sans-impression">
              <span>
                <strong>Démonstration.</strong> Vous voyez Batinium avec les droits
                d’un {LIBELLE_ROLE[membre.role]} : ses menus, ses données, ses refus. Ce que
                vous faites ici est réellement enregistré, à votre nom.
              </span>
              <button className="action" onClick={() => vue('direction')}>
                Revenir à ma vue
              </button>
            </div>
          )}
          {/* Un seul fil d'Ariane, déduit du menu, plutôt que vingt-cinq
              recopiés à la main : ils auraient fini par diverger, et une page
              oubliée serait restée sans repère. Les fiches de détail — un
              client, un chantier, une facture — posent le leur, plus riche,
              parce qu'elles seules connaissent le nom de ce qu'elles montrent. */}
          {!route.id && <FilAriane etapes={ariane(route.section)} />}
          <Garde section={route.section}>
            <Contenu section={route.section} id={route.id} />
          </Garde>
        </main>
      </div>

      {/* Au-dessus de tout : on interroge l'assistant sans quitter la page
          où l'on est. C'est justement là qu'on a des questions. */}
      <Assistant />
    </div>
  );
}

/**
 * Le chemin d'une page, tiré du menu. Batinium a deux niveaux : un groupe et
 * une entrée. La racine renvoie à l'accueil, ce qui donne toujours une sortie.
 */
function ariane(section: string) {
  const entree = MENU.find((e) => e.cle === section);
  if (!entree) return [{ libelle: 'Batinium' }];
  if (entree.cle === 'bord') return [{ libelle: 'Aujourd’hui' }];
  return [
    { libelle: 'Aujourd’hui', vers: '/bord' },
    { libelle: entree.groupe },
    { libelle: entree.libelle },
  ];
}

function Contenu({ section, id }: { section: string; id: string | null }) {
  switch (section) {
    // « Aujourd'hui » n'est pas le même écran selon qui ouvre l'application.
    // Un poseur n'a que faire des devis à relancer et des impayés ; le gérant
    // n'a que faire du bouton « je commence ». Une entrée de menu, deux
    // contenus, plutôt que deux entrées dont l'une serait vide pour chacun.
    // `#/bord/journee` force la vue terrain : c'est ainsi que la direction
    // peut la vérifier sans créer de compte technicien.
    case 'bord':
      return id === 'journee' || !voitLesPrix()
        ? <PageMaJournee apercu={voitLesPrix()} />
        : <PageTableauDeBord />;
    case 'taches':     return <PageTaches />;
    case 'calendrier': return <PageCalendrier />;
    case 'analytique': return <PageAnalytique />;
    case 'depenses':   return <PageDepenses />;
    case 'achats':     return <PageAchats />;
    case 'demandes':   return <PageDemandes />;
    case 'boite':      return <PageBoite />;
    case 'devis':      return id ? <PageEditeur devisId={id} /> : <PageDevis />;
    case 'factures':   return id ? <PageFacture factureId={id} /> : <PageFactures />;
    case 'clients':    return id ? <PageFicheClient tiersId={id} /> : <PageClients />;
    case 'chantiers':  return id ? <PageFicheChantier chantierId={id} /> : <PageChantiers />;
    // La fiche fluides d'une machine (Cerfa 15497*04). Ouverte depuis la
    // fiche chantier ou depuis Ma journée ; sans identifiant, rien à montrer.
    case 'fluide':     return id ? <PageFicheFluide ficheId={id} /> : <PageChantiers />;
    // Le devis sans les prix, pour le terrain. Accessible à tous les rôles,
    // c'est le premier écran de Batinium écrit pour le poseur et non le bureau.
    case 'pose':       return id ? <PageFichePose chantierId={id} /> : <PageChantiers />;
    // Sans drapeau `prix` : c'est l'écran d'un poseur autant que du gérant.
    case 'heures':     return <PagePointage />;
    case 'journal':    return <PageJournal />;
    case 'equipe':     return id ? <PageFicheMembre membreId={id} /> : <PageEquipe />;
    // Un sous-traitant est un `tiers`, pas un membre : il lui faut sa propre
    // route. On y arrive depuis Équipe et depuis les alertes d'échéance.
    case 'soustraitant': return id ? <PageFicheSousTraitant tiersId={id} /> : <PageEquipe />;
    case 'import':     return <PageImport />;
    // #/catalogue/remplir : l'import de masse, sans entrée de menu à lui.
    // On y arrive depuis le catalogue, on y retourne : ce n'est pas un endroit
    // où l'on passe, c'est une opération qu'on mène et qu'on termine.
    case 'catalogue':  return id === 'remplir' ? <PageRemplirCatalogue /> : <PageCatalogue />;
    case 'connexions': return <PageConnexions />;
    case 'reglages':   return <PageParametres />;
    case 'donnees':    return <PageDonnees />;
    default:           return <PageTableauDeBord />;
  }
}
