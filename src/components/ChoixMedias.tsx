import { TAILLE_MAXIMALE } from '../lib/db';

/**
 * Photos et vidéos, prises sur le moment ou choisies dans le téléphone.
 *
 * Trois boutons et non un seul champ « fichier » : sur un téléphone, « Photo »
 * et « Filmer » ouvrent directement l'appareil photo (`capture`), sans passer
 * par un menu. Le terrain doit pouvoir le faire d'une main.
 *
 * Un fichier trop lourd est signalé tout de suite, à la sélection : l'apprendre
 * après une minute d'envoi sur la 4G d'un sous-sol, c'est l'apprendre trop tard.
 */
export default function ChoixMedias({ fichiers, onChange }: {
  fichiers: File[]; onChange: (f: File[]) => void;
}) {
  const ajouter = (liste: FileList | null) => {
    if (liste?.length) onChange([...fichiers, ...Array.from(liste)]);
  };
  const limite = Math.round(TAILLE_MAXIMALE / 1048576);

  return (
    <div className="choix-medias">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="depot">
          Photo
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                 onChange={(e) => { ajouter(e.target.files); e.target.value = ''; }} />
        </label>
        <label className="depot">
          Filmer
          <input type="file" accept="video/*" capture="environment" style={{ display: 'none' }}
                 onChange={(e) => { ajouter(e.target.files); e.target.value = ''; }} />
        </label>
        <label className="depot">
          Depuis le téléphone
          <input type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
                 onChange={(e) => { ajouter(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      {fichiers.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
          {fichiers.map((f, i) => {
            const mo = f.size / 1048576;
            const trop = f.size > TAILLE_MAXIMALE;
            return (
              <li key={`${f.name}-${f.lastModified}-${i}`}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                               whiteSpace: 'nowrap', color: trop ? 'var(--alerte)' : undefined }}>
                  {f.type.startsWith('video/') ? 'Vidéo' : 'Photo'} · {f.name}
                </span>
                <span className="statut" style={trop ? { color: 'var(--alerte)' } : undefined}>
                  {mo < 1 ? `${Math.max(1, Math.round(f.size / 1024))} ko`
                    : `${mo.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`}
                  {trop && ` — au-delà de ${limite} Mo`}
                </span>
                <button className="lien-discret" aria-label={`Retirer ${f.name}`}
                        onClick={() => onChange(fichiers.filter((_, j) => j !== i))}>×</button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="statut" style={{ marginTop: 6 }}>
        {limite} Mo au plus par fichier : quelques minutes de vidéo, moins en 4K.
      </p>
    </div>
  );
}
