import L from 'leaflet';

// Klasyczny kształt "kropli" (jak w Google Maps), czubek w (12, 24) — dzięki
// temu iconAnchor może wskazywać dokładnie czubek pinezki jako realny punkt
// współrzędnych, nie środek ikony.
const PIN_GLYPH_PATH =
  'M12 0C7.31 0 3.5 3.81 3.5 8.5 3.5 15 12 24 12 24s8.5-9 8.5-15.5C20.5 3.81 16.69 0 12 0z';

// L.divIcon renderuje czysty HTML/CSS+SVG zamiast obrazka — style i animacja
// "radaru" siedzą w leaflet-dark.css (.alert-pin*). className: '' usuwa
// domyślne białe tło/cień, jakie Leaflet nakłada na divIcon. Kolor jest
// parametrem, żeby ta sama ikona mogła być kolorowana wg kategorii (podgląd
// w formularzu) albo wg krytyczności (mapa przeglądowa).
export function createPinIcon(color: string, size = 34): L.DivIcon {
  const html = `
    <span class="alert-pin" style="--pin-color: ${color}">
      <span class="alert-pin__radar"></span>
      <svg class="alert-pin__glyph" viewBox="0 0 24 24" width="${size}" height="${size}">
        <path d="${PIN_GLYPH_PATH}" fill="${color}" stroke="#0f172a" stroke-width="1" />
        <circle cx="12" cy="8.6" r="3.4" fill="#ffffff" />
      </svg>
    </span>
  `;

  return L.divIcon({
    className: '',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}
