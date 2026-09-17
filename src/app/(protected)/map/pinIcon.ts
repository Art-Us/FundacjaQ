import L from 'leaflet';

// Ikona ostrzegawcza (trójkąt z wykrzyknikiem) — ten sam glif co w prototypie
// New_design, żeby pinezki na mapie od razu czytały się jako "alert kryzysowy",
// a nie zwykły znacznik lokalizacji.
const ALERT_TRIANGLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>' +
  '<line x1="12" y1="9" x2="12" y2="13"/>' +
  '<line x1="12" y1="17" x2="12.01" y2="17"/>' +
  '</svg>';

// L.divIcon renderuje czysty HTML/CSS zamiast obrazka — okrągła plakietka z
// pulsującym pierścieniem (Tailwind `animate-ping`) w tym samym kolorze,
// dokładnie w punkcie współrzędnych (ikona jest zakotwiczona na środku, nie na
// czubku, bo to koło, nie kropla). Kolor jest parametrem, żeby ta sama ikona
// mogła być kolorowana wg kategorii albo wg krytyczności.
export function createPinIcon(color: string, size = 30): L.DivIcon {
  const outer = size + 8;
  const html = `
    <div class="relative flex items-center justify-center" style="width: ${outer}px; height: ${outer}px;">
      <span class="animate-ping absolute inline-flex rounded-full" style="width: ${size}px; height: ${size}px; background-color: ${color}; opacity: 0.45;"></span>
      <div class="relative flex items-center justify-center rounded-full text-white" style="width: ${size}px; height: ${size}px; background-color: ${color}; border: 2.5px solid #0f172a; box-shadow: 0 0 12px ${color}, 0 2px 6px rgba(0,0,0,0.5);">
        ${ALERT_TRIANGLE_SVG}
      </div>
    </div>
  `;

  return L.divIcon({
    className: '',
    html,
    iconSize: [outer, outer],
    iconAnchor: [outer / 2, outer / 2],
    popupAnchor: [0, -outer / 2],
  });
}

// Glif kalendarza dla zdarzeń codziennych — celowo inny niż trójkąt
// ostrzegawczy, żeby festyn nie czytał się jak zagrożenie.
const EVENT_CALENDAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="5" width="18" height="16" rx="2"/>' +
  '<line x1="8" y1="3" x2="8" y2="7"/>' +
  '<line x1="16" y1="3" x2="16" y2="7"/>' +
  '<line x1="3" y1="11" x2="21" y2="11"/>' +
  '</svg>';

// Pinezka zdarzenia codziennego: zaokrąglony kwadrat (a nie koło) z glifem
// kalendarza i bez pulsującego pierścienia — pulsowanie sygnalizuje pilność,
// której wydarzenia nie mają. Kolor przychodzi z CATEGORY_MARKER_COLORS, więc
// każdy typ wydarzenia ma własną barwę.
export function createEventPinIcon(color: string, size = 28): L.DivIcon {
  const html = `
    <div class="relative flex items-center justify-center" style="width: ${size}px; height: ${size}px;">
      <div class="relative flex items-center justify-center text-white" style="width: ${size}px; height: ${size}px; background-color: ${color}; border: 2.5px solid #0f172a; border-radius: 9px; box-shadow: 0 2px 8px rgba(0,0,0,0.55);">
        ${EVENT_CALENDAR_SVG}
      </div>
    </div>
  `;

  return L.divIcon({
    className: '',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

// Klasyczna kropla lokalizacji (bez pulsowania i bez glifu kategorii) — do
// zwykłego wskazywania punktu na mapie (np. siedziba gminy), gdzie pinezka nie
// ma reprezentować ani alertu, ani zdarzenia.
const LOCATION_PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="4"/>' +
  '</svg>';

export function createLocationPinIcon(color: string, size = 30): L.DivIcon {
  const html = `
    <div class="relative flex items-center justify-center text-white" style="width: ${size}px; height: ${size}px; background-color: ${color}; border: 2.5px solid #0f172a; border-radius: 9999px; box-shadow: 0 2px 8px rgba(0,0,0,0.55);">
      ${LOCATION_PIN_SVG}
    </div>
  `;

  return L.divIcon({
    className: '',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}
