/**
 * Y aller : Google Maps ou Waze, au choix de chacun.
 *
 * Deux liens plutôt qu'un : sur les chantiers, une bonne moitié des poseurs
 * roule avec Waze. Les coordonnées, quand on les a, évitent qu'une adresse
 * mal orthographiée envoie le fourgon dans la commune voisine.
 */
export default function Itineraire({ adresse, latitude, longitude }: {
  adresse: string; latitude?: number | null; longitude?: number | null;
}) {
  const point = latitude != null && longitude != null ? `${latitude},${longitude}` : null;
  const google = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(point ?? adresse)}`;
  const waze = point
    ? `https://waze.com/ul?ll=${point}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(adresse)}&navigate=yes`;
  return (
    <span style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap' }}>
      <a href={google} target="_blank" rel="noopener">Itinéraire Google Maps</a>
      <a href={waze} target="_blank" rel="noopener">Itinéraire Waze</a>
    </span>
  );
}
