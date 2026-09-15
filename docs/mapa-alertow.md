# Mapa Ostrzeżeń Kryzysowych (`/map`)

Dokumentacja techniczna funkcjonalności dodanej w ramach zadania Trello
**"Integracja Mapy"** (kolumna *In progress*, gałąź `alerts-map`, bazowana na
`dev`). Opisuje co dokładnie powstało, dlaczego w taki sposób, oraz jakie
problemy napotkano i naprawiono po drodze.

> Historia zmian: pierwsza wersja (`bd564de`) obejmowała samą mapę + CRUD
> alertów. Kolejne commity (`92a336f`, `5c84c24`, `be6cc04`) dodały kategorie,
> rozróżnienie Alert/Zdarzenie, geokodowanie adresów i edycję istniejących
> wpisów — opisane w sekcjach poniżej.

## 1. Co zostało zrealizowane

Zakres z opisu karty Trello:
- ✅ Integracja mapy, pusta mapa wycentrowana na gminie Nowa Dęba
- ✅ Struktura Alertów (rozszerzenie modelu o współrzędne)
- ✅ CRUD operations (create/update-status/edit/delete przez API)
- ✅ Formularz stworzenia alertu (z geokodowaniem adresu i ręcznym wpisem lat/lng)
- ✅ Edycja istniejącego alertu/zdarzenia (`AlertEditModal`)
- ✅ Lista alertów pod mapą (sekcje Aktywne/Archiwum, osobne filtry)
- ✅ Filtracja i sortowanie alertów (po statusie, ważności, kategorii, organizacji, dacie)
- ✅ Kategorie zdarzeń (`Alert.category`) — zrealizowane w `92a336f`/`5c84c24`,
  wcześniej planowane jako osobna karta (patrz sekcja 9, zaktualizowana)
- ✅ Rozróżnienie **Alert** (kryzysowy) vs **Zdarzenie** (`Alert.kind`,
  codzienne wydarzenia społeczności) na tej samej mapie, z osobnymi zakładkami
- ✅ Geokodowanie adresów (wyszukiwanie po adresie + odwrotne geokodowanie po
  kliknięciu na mapie), oparte o OpenStreetMap Nominatim

Świadomie **poza zakresem** tego zadania (patrz sekcja 9, zaktualizowana):
model `Organizacja`, integracja z UNHCR Matrix.

## 2. Nowe pliki

```
prisma/
  migrations/20260906164413_add_alert_coordinates/         ← współrzędne
  migrations/20260907083807_add_alert_category/             ← pole category
  migrations/20260909080142_add_alert_kind_and_event_categories/ ← kind + kategorie zdarzeń
src/
  app/(protected)/map/
    page.tsx                ← Server Component: dane + autoryzacja
    AlertsMapView.tsx        ← Client: zakładki Alert/Zdarzenie, filtry mapy i list, legenda
    AlertMap.tsx              ← Client: sama mapa Leaflet (dynamic import, ssr:false)
    AlertForm.tsx              ← Client: formularz tworzenia alertu/zdarzenia
    AlertEditModal.tsx          ← Client: modal edycji istniejącego wpisu (nowy)
    AlertActions.tsx              ← Client: przyciski zmiany statusu (Rozwiąż/Odwołaj/Wznów/Usuń)
    LocationPicker.tsx              ← Client: mini-mapa do wskazania/poprawienia współrzędnych
    pinIcon.ts                        ← ikony pinezek (kształt/kolor wg kind i category/severity)
    leaflet-dark.css                    ← ciemny motyw dla UI Leafleta
  app/api/alerts/
    route.ts                              ← POST (tworzenie alertu/zdarzenia)
    [id]/route.ts                           ← PATCH (edycja/status), DELETE (tylko ADMIN)
  app/api/geocode/
    search/route.ts                           ← GET: wyszukiwanie adresu → współrzędne (nowy)
    reverse/route.ts                            ← GET: współrzędne → adres (nowy)
  lib/
    alertLabels.ts                                ← etykiety/kolory dla severity, category, kind
    geocode.ts                                      ← wspólna logika zapytań do Nominatim (nowy)
    roleLabels.ts                                     ← etykiety ról (wydzielone z dashboardu, nowy)
docs/
  mapa-alertow.md                                       ← ten dokument
```

Zmodyfikowane pliki: `prisma/schema.prisma`, `prisma/seed.ts`,
`src/app/(protected)/page.tsx`, `src/app/layout.tsx`, `src/middleware.ts`,
`src/lib/dashboard.ts`, `package.json`.

**Usunięte bez zamiennika:** `src/components/layout/Navbar.tsx`,
`AuthStatus.tsx`, `NavLinks.tsx` — w `5c84c24` cały pasek nawigacji/informacji
o sesji zniknął z `layout.tsx` (root layout renderuje teraz tylko
`SessionProvider` wokół dzieci) i nic go nie zastąpiło. Aplikacja obecnie nie
ma żadnej nawigacji globalnej ani widocznego stanu zalogowania poza samą
stroną `/map`. Nie jest jasne, czy to świadome tymczasowe usunięcie (np. pod
przyszły redesign), czy niezamierzona regresja — **wymaga potwierdzenia**
zanim uzna się to za "zrobione zgodnie z planem".

## 3. Model danych

### Migracja `add_alert_coordinates`

Model `Alert` w `schema.prisma` rozszerzono o dwa opcjonalne pola:

```prisma
model Alert {
  // ...istniejące pola...
  location    String?
  latitude    Float?
  longitude   Float?
  // ...
}
```

**Dlaczego opcjonalne (`Float?`), nie wymagane:** zachowuje kompatybilność
wsteczną ze starymi rekordami `Alert` sprzed tej funkcjonalności (które nie
mają współrzędnych) — taki alert po prostu nie dostaje pinezki na mapie
(`AlertMap.tsx` filtruje po `latitude != null && longitude != null`), ale
nadal wyświetla się na liście pod mapą.

Migracja została wygenerowana i zastosowana przez:
```bash
npx prisma migrate dev --name add_alert_coordinates
```

### Migracje `add_alert_category` i `add_alert_kind_and_event_categories`

Dwie kolejne migracje rozszerzyły model `Alert` o rozróżnienie typu wpisu i
jego kategorii:

```prisma
enum AlertKind {
  ALERT   // ostrzeżenie kryzysowe
  EVENT   // codzienne wydarzenie społeczności
}

enum AlertCategory {
  // kategorie dla ALERT
  HYDROLOGICAL
  ROAD
  HUMANITARIAN
  FIRE
  INFRASTRUCTURE
  GENERAL
  // kategorie dla EVENT
  FESTIVAL
  CONCERT
  SPORT
  COMMUNITY
  FAIR
  CULTURE
  OTHER_EVENT
}

model Alert {
  // ...istniejące pola...
  kind      AlertKind     @default(ALERT)
  category  AlertCategory @default(GENERAL)
  // ...
}
```

Jedna tabela `Alert` przechowuje więc dwa koncepcyjnie różne typy wpisów —
kryzysowe alerty i codzienne wydarzenia — rozróżniane polem `kind`, dzielące
jedną kolumnę `category`, której poprawny zbiór wartości zależy od `kind`
(`ALERT_CATEGORIES` / `EVENT_CATEGORIES` w `src/lib/alertLabels.ts`, funkcja
`isCategoryValidForKind()` waliduje to zarówno w API, jak i w UI). Pole
`severity` ma sens tylko dla `kind = ALERT` — dla `EVENT` jest pomijane w
formularzu i modalu edycji.

**Dlaczego jedna tabela, nie osobny model `Event`:** `Alert` i `Zdarzenie`
dzielą niemal cały szkielet (tytuł, opis, lokalizacja, współrzędne, gmina,
autor, status, historia zmian) — dodanie `kind` + rozszerzenie enuma
`category` było najmniejszą zmianą pozwalającą pokazać oba typy na tej samej
mapie z tym samym filtrowaniem/sortowaniem/CRUD-em, bez duplikowania całej
warstwy API i UI dla drugiego modelu.

### Dlaczego `Alert`, a nie nowy model `Zdarzenie` (aktualizacja)

Pierwotna wersja tej sekcji odkładała pełny model `Zdarzenie` (zatwierdzanie,
koordynator zdarzenia, wątki komunikacji) do osobnej, przyszłej karty —
argumentując, że `Alert` już pokrywał zakres pierwszej wersji tego zadania.
W `5c84c24` część tego zakresu została jednak zrealizowana wcześniej niż
zakładano, przez rozszerzenie `Alert` o `kind = EVENT`, zamiast czekać na
osobny model. To rozwiązuje potrzebę "codziennych wydarzeń na tej samej
mapie" bez migracji do nowej tabeli, ale **nie** obejmuje elementów
specyficznych dla pełnego modelu `Zdarzenie` z notatek klienta (zatwierdzanie
zgłoszeń, dedykowany koordynator zdarzenia, wątki komunikacji) — te wciąż
pozostają przyszłym zadaniem, jeśli okażą się potrzebne.

## 4. Bezpieczeństwo i uprawnienia

Strona `/map` leży pod route group `(protected)`, więc **automatycznie**
dziedziczy dwuwarstwową ochronę już istniejącą w projekcie:
1. `src/middleware.ts` — szybki, "coarse" gate na podstawie zawartości ciasteczka JWT
2. `src/app/(protected)/layout.tsx` — autorytatywne sprawdzenie sesji względem bazy (żywe, per-request)

Żadnego nowego kodu autoryzacji na poziomie strony nie trzeba było pisać —
to jedna z zalet istniejącej architektury auth w projekcie.

### Macierz uprawnień

| Akcja | VOLUNTEER | COORDINATOR | ADMIN |
|---|---|---|---|
| Widok mapy/listy (tylko własna gmina dla nie-ADMIN) | ✅ | ✅ | ✅ (wszystkie gminy) |
| Tworzenie alertu (`POST /api/alerts`) | ❌ `403` | ✅ (tylko własna gmina) | ✅ (dowolna gmina) |
| Zmiana statusu / edycja pól (`PATCH /api/alerts/:id`, `AlertEditModal`) | ❌ `403` | ✅ (tylko własna gmina) | ✅ |
| Trwałe usunięcie (`DELETE /api/alerts/:id`) | ❌ `403` | ❌ `403` | ✅ |
| Geokodowanie adresu (`GET /api/geocode/search`, `/reverse`) | ❌ `403` | ✅ | ✅ |

`kind` (ALERT/EVENT) nie jest edytowalny po utworzeniu — brak takiego pola w
schemacie walidacji `PATCH`, zarówno w UI (`AlertEditModal`), jak i w API.

Wymuszone **wyłącznie po stronie API** (`requireAdminOrCoordinator()` z
`src/lib/authz.ts` + ręczne porównanie `gminaId`), nie tylko przez ukrywanie
przycisków w UI — zweryfikowano to bezpośrednio przez `curl` z pominięciem
interfejsu (VOLUNTEER dostaje `403` nawet przy bezpośrednim wywołaniu API).

### Rate limiting — świadomie NIE dodano

Pierwsza wersja zawierała dedykowany `alertCreateLimiter` (wzorowany na
`inviteCreateLimiter`), ale został usunięty po analizie: jedyni użytkownicy
mogący w ogóle trafić do tego endpointu to już uwierzytelnieni
ADMIN/COORDINATOR (nie anonimowy ruch, jak przy loginie czy resecie hasła).
W realnym scenariuszu kryzysowym administrator może potrzebować utworzyć
kilkanaście alertów w ciągu godziny — sztywny limit ryzykowałby zablokowanie
prawdziwego zgłoszenia w najgorszym możliwym momencie. Ochrona przed
przypadkowym podwójnym submitem realizowana jest po stronie klienta
(`disabled` na przycisku podczas `loading`), co jest wystarczające dla tego
zagrożenia.

## 5. API

### `POST /api/alerts`

```ts
{
  title: string,          // 1-200 znaków
  description: string,     // 1-2000 znaków
  kind?: 'ALERT'|'EVENT',   // domyślnie ALERT
  category?: AlertCategory,  // domyślnie GENERAL; musi pasować do kind
  severity: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL',
  location?: string,          // max 200 znaków
  latitude: number,             // -90..90
  longitude: number,             // -180..180
  gminaId: string,
  expiresAt?: string               // ISO date
}
```
Walidacja przez `zod`, dodatkowo `isCategoryValidForKind(category, kind)` —
np. próba utworzenia alertu (`kind = ALERT`) z kategorią `FESTIVAL`
(kategoria zdarzeń) zwraca `400`. Odpowiedź: `{ message, alert }`
(201-ekwiwalent, status `200`) albo `{ error }` (`400`/`403`).

### `PATCH /api/alerts/:id`

Częściowa aktualizacja dowolnego podzbioru pól (w tym `status`, `title`,
`description`, `category`, `severity`, `location`, `latitude`/`longitude`) —
**bez** `kind`, które jest niezmienne po utworzeniu. `category`, jeśli
podane, jest walidowane względem *istniejącego* `kind` wpisu. Używane przez
`AlertEditModal.tsx` (edycja treści/kategorii/lokalizacji) oraz
`AlertActions.tsx` (zmiana statusu: Rozwiąż/Odwołaj/Wznów/Przywróć).

### `GET /api/geocode/search?q=`

Wyszukiwanie po adresie → lista/pierwsze trafienie ze współrzędnymi i
sformatowanym adresem. Wywołuje Nominatim (OpenStreetMap) w 3 krokach: (1)
zapytanie strukturalne ograniczone do gminy Nowa Dęba/powiatu/województwa,
(2) to samo zapytanie jako wolny tekst nadal ograniczone do gminy, (3)
zapytanie ogólnopolskie z miękkim odchyleniem w stronę regionu pilotażu —
zatrzymuje się na pierwszym trafieniu. Minimalna długość zapytania: 3 znaki.
Wymaga `requireAdminOrCoordinator()`.

### `GET /api/geocode/reverse?lat=&lon=`

Odwrotne geokodowanie — współrzędne → adres (ulica+numer, miejscowość,
powiat, województwo + gotowa etykieta do wyświetlenia). Używane po kliknięciu
na mapie w `LocationPicker`. Wymaga `requireAdminOrCoordinator()`.

Oba endpointy geokodowania są objęte osobnym limiterem Redis
(`geocodeLimiter`, 1 żądanie/s na użytkownika, blokada na 3s po przekroczeniu)
— zabezpiecza to serwerowe IP przed zablokowaniem przez darmowy limit
Nominatim (~1 req/s), niezależnie od limitu po stronie klienta (debounce
800ms w formularzu, patrz sekcja 6).

### `DELETE /api/alerts/:id`

Twarde usunięcie z bazy — tylko ADMIN. Zgodnie z zasadą z notatek klienta
("zamknięte zadania mają pozostać jako baza historyczna"), normalny obieg
pracy to zmiana statusu (`PATCH`), nie usuwanie — `DELETE` to "awaryjne
wyjście" do korekty pomyłek/spamu, nie codzienne narzędzie.

Wszystkie endpointy: `runtime = 'nodejs'` (wymagane przez Prisma), ten sam
wzorzec warstw co istniejące `/api/admin/*`: auth (`403`) → lookup (`404`) →
uprawnienia (`403`) → walidacja (`400`) → mutacja → `{message}`.

## 6. Frontend — podział odpowiedzialności

- **`page.tsx`** (Server Component) — pobiera sesję, liczy `gminaFilter`
  dokładnie tym samym wzorcem co `src/lib/dashboard.ts`
  (`isGminaScoped = role !== 'ADMIN'`), pobiera alerty i listę gmin
  bezpośrednio przez Prisma (bez pośredniego wywołania własnego API — ten
  sam wzorzec co `admin/invites/page.tsx`).
- **`AlertsMapView.tsx`** (Client) — centralny hub widoku, znacznie
  rozbudowany:
  - **Zakładki Alert/Zdarzenie** ("Alerty" vs "Zdarzenia codzienne") z
    licznikami; przełączenie zakładki resetuje filtry kategorii/organizacji
    (bo oba `kind` mają rozłączne zbiory kategorii).
  - **Przełącznik trybu mapy** (`mapMode`: kolorowanie pinezek po kategorii
    lub po ważności) — dostępny tylko dla zakładki Alert; Zdarzenia są zawsze
    kolorowane po kategorii (ważność ich nie dotyczy).
  - **Panel filtrów mapy** (niezależny od filtrów list poniżej): tekst
    wyszukiwania, filtr statusu (aktywne/archiwalne/wszystkie), zakres czasu,
    wielokrotny wybór ważności (Alert) lub kategorii (Zdarzenie), reset
    filtrów.
  - **Dwie osobne sekcje list** ("Aktywne"/"Archiwum"), każda z własnym,
    niezależnym zestawem filtrów: wyszukiwanie, zakres czasu (w tym
    niestandardowy przedział dat), kategoria, organizacja, sortowanie.
  - **Przycisk edycji** (ikona ołówka) na karcie aktywnego alertu, widoczny
    tylko gdy `canManageAlert(alert)` zwraca `true` (ADMIN — dowolny wpis;
    COORDINATOR — tylko własna gmina), otwiera `AlertEditModal`.
  - Przycisk "Pokaż na mapie" (`focusedAlertId`) do wycentrowania mapy na
    wybranej karcie.
  - Filtrowanie/sortowanie list odbywa się **w pamięci przeglądarki**
    (`useMemo`), bez dodatkowych zapytań sieciowych — uzasadnione skalą
    pilotażu (dziesiątki, nie tysiące wpisów).

  Uwaga: nie zaimplementowano trybu "Podzielony/Mapa/Karty" z mockupu
  (wspomnianego w poprzedniej wersji tego dokumentu jako sugerowany kolejny
  krok) — zamiast tego jest przycisk pokazania/ukrycia mapy plus zakładki
  Alert/Zdarzenie; mapa i obie sekcje list są zawsze ułożone pionowo, nie ma
  przełącznika układu w tym sensie.
- **`AlertMap.tsx`** (Client, `dynamic(..., {ssr:false})`) — jedyny plik
  dotykający bezpośrednio Leaflet. Leaflet odwołuje się do `window` przy
  imporcie modułu, więc **musi** być wyłączony z renderowania po stronie
  serwera — to konkretna przyczyna użycia `next/dynamic` zamiast zwykłego
  importu.
- **`LocationPicker.tsx`** — osadzalna mini-mapa Leaflet (260px, jasny
  motyw), używana zarówno w `AlertForm`, jak i w `AlertEditModal`: pokazuje
  marker w aktualnej wartości, nasłuchuje kliknięć i zgłasza `onPick(lat,
  lng)`, automatycznie "dolatuje" (`FlyToValue`) do nowej wartości ustawionej
  programowo (np. przy wczytaniu istniejącego wpisu do edycji). Renderuje
  pinezkę w wariancie "alert" lub "zdarzenie" (`icon` prop), zgodnie ze
  stylem markerów na głównej mapie.
- **`AlertForm.tsx`** — formularz tworzenia; współrzędne ustawia się
  kliknięciem w `LocationPicker` **lub** ręcznym wpisaniem lat/lng (dwa pola
  liczbowe dodane w `be6cc04`, synchronizowane z kliknięciem na mapie).
  Kliknięcie na mapę wywołuje odwrotne geokodowanie i wypełnia pole adresu;
  wpisywanie adresu wywołuje wyszukiwanie po debounce 800ms
  (`scheduleGeocode`) ze statusem/błędem w UI. **Uwaga:** wcześniej
  kliknięcie bezpośrednio na głównej mapie przeglądowej (`AlertsMapView`)
  otwierało ten formularz z gotowymi współrzędnymi — to zachowanie zostało
  usunięte w `be6cc04` jako poprawka błędu (patrz sekcja 8, pozycja 9);
  wybór lokalizacji odbywa się teraz wyłącznie przez wbudowany
  `LocationPicker` formularza.
- **`AlertEditModal.tsx`** (nowy) — modal edycji istniejącego wpisu: tytuł,
  opis, kategoria (opcje ograniczone do `kind` danego wpisu), ważność (tylko
  dla `kind = ALERT`, ukryta dla zdarzeń), lokalizacja tekstowa i
  przesunięcie pinezki przez `LocationPicker`. `kind` nie jest edytowalny.
  Wysyła `PATCH /api/alerts/:id`. Renderowany tylko gdy `canManageAlert()`
  zwraca `true` (te same reguły co przycisk edycji wyżej).
- **`AlertActions.tsx`** — rozbudowany z prostego "Rozwiąż"/"Usuń" do pełnego
  zestawu przejść statusu: Rozwiąż, Odwołaj, Wznów/Przywróć (z osobnym
  tekstem dla Zdarzeń: "Zakończ"/"Przywróć wydarzenie" zamiast
  "Rozwiąż"/"Wznów komunikat"), każdy z własnym stanem `loading`. Ten sam
  wzorzec co `RevokeInviteButton.tsx`/`ToggleUserActiveButton.tsx`: `fetch`
  bez zbędnych bibliotek, `router.refresh()` po sukcesie.
- **`pinIcon.ts`** — dwa warianty ikon: `createPinIcon()` (okrągła plakietka
  z pulsującą obwódką sygnalizującą pilność + ikona trójkąta ostrzegawczego,
  dla `kind = ALERT`) i `createEventPinIcon()` (zaokrąglony kwadrat z ikoną
  kalendarza, bez pulsowania — zdarzenia nie są pilne, dla `kind = EVENT`).
  Kolor pinezki zależy od trybu mapy: kategoria (`CATEGORY_MARKER_COLORS`)
  lub ważność.

## 7. Wybory technologiczne

**Leaflet + react-leaflet + kafelki admin@qfundation.local** (nie Mapbox/Google Maps):
- brak wymaganego klucza API i kosztów — spójne z ograniczeniami budżetu
  hostingu wskazanymi przez klienta (notatki kickoff: $10-65/mies.)
- `leaflet` (JS) + `react-leaflet` (wrapper) + `@types/leaflet` (typy)

**Ciemny motyw** (`leaflet-dark.css`) — Leaflet nie ma trybu ciemnego z
pudełka; domyślny biały popup/kontrolki wyglądałyby jak "dziura" w ciemnym
interfejsie reszty aplikacji. Osobny plik CSS nadpisuje kolory
`.leaflet-popup-*`, `.leaflet-control-zoom`, `.leaflet-control-attribution`.

**Filtrowanie po `severity`/`status`/kategorii** — po dodaniu pola
`category` (sekcja 3) filtry UI zostały rozszerzone zgodnie z dostarczonym
mockupem. Filtrowanie po organizacji korzysta z istniejącego
`User.organization` (string), **nie** z osobnego modelu `Organizacja`
(wciąż świadomie odłożony, patrz sekcja 9) — więc to raczej filtrowanie po
tekstowej nazwie organizacji autora, nie po relacyjnej strukturze.

**OpenStreetMap Nominatim** do geokodowania (nie Google Places/Mapbox
Geocoding): spójne z wcześniejszym wyborem Leaflet+OSM (brak klucza API i
kosztów, patrz wyżej). Wymaga własnego, opisowego `User-Agent` zgodnie z
polityką użytkowania Nominatim oraz limitu ~1 req/s po stronie serwera
(`geocodeLimiter`), inaczej ryzyko zablokowania adresu IP hostingu.

## 8. Problemy napotkane i naprawione po drodze

To była duża część rzeczywistej pracy — warto je znać, bo część to
powtarzalne pułapki przy podobnych zmianach w przyszłości.

| # | Problem | Przyczyna | Naprawa |
|---|---|---|---|
| 1 | `500 Internal Server Error` na `/map` zaraz po dodaniu strony | Nieaktualny cache `.next` z wcześniejszych sesji dev-servera | `rm -rf .next` + restart |
| 2 | Mapa renderuje się, ale tło jest całkowicie czarne, tylko pinezki widoczne | Content-Security-Policy w `src/middleware.ts` (`img-src 'self' data:`) po cichu blokowała obrazki kafelków z `tile.openstreetmap.org` — **nie** brak klucza API | Dodano `https://*.tile.openstreetmap.org` do `img-src` w `buildCsp()` |
| 3 | `prisma.gmina.upsert({ update: {} })` — nowe współrzędne gmin nie zapisywały się przy ponownym `seed` na już istniejących rekordach | Pusty obiekt `update` = upsert nic nie aktualizuje przy konflikcie, tylko tworzy przy braku rekordu | Zmieniono na `update: g` (te same dane co `create`) |
| 4 | Ta sama pułapka w `seedTestUsers()` — reassignment testowych kont do nowej gminy nie działał | Identyczny pusty `update: {}` | Wypełniono `update` tymi samymi polami co `create` |
| 5 | Osierocone dane po konsolidacji do jednej gminy (Wieliczka/Sanok/Kłodzko nadal w bazie mimo zniknięcia z `seed.ts`) | Skrypt seed nigdy nie *usuwa* tego, czego już nie tworzy | Nowa funkcja `cleanupObsoleteGminy()` — kasuje kaskadowo (Alert→Resource→InviteToken→User→Gmina) wszystko poza aktualną listą gmin |
| 6 | Linki "Strona główna"/"Mapa" widoczne w nawigacji na `/login` | `Navbar` renderowany w **root** `layout.tsx`, więc obejmuje też strony publiczne | Wydzielono `NavLinks.tsx` (client, `useSession()`) analogicznie do istniejącego `AuthStatus.tsx` — linki znikają gdy brak sesji |
| 7 | 3-5 sekundowe opóźnienie po zalogowaniu, zanim pojawi się panel | Zmierzono bezpośrednio (tymczasowe `console.time` w `authorize()`/`jwt()`/`getDashboardData()`): realna praca backendu to ~830ms; pełny pierwszy `GET /` trwał 5.3s, **drugi** identyczny request — 0.39s | Nie kod aplikacji — to jednorazowa kompilacja trasy przez `next dev` w trybie deweloperskim (nie występuje w `next build`) |
| 8 | Trzy porty (3000/3001/3002) "zajęte", choć użytkownik nie widział żadnego okna z serwerem | Osierocone procesy `node.exe` z wcześniej zatrzymanych zadań w tle (zatrzymanie taska harnessa nie zawsze zabija cały drzewo procesów na Windows) | Zidentyfikowano przez `netstat -ano` + `tasklist`, zakończono `taskkill //F` |
| 9 | Kliknięcie na głównej mapie przeglądowej mogło przypadkowo otwierać formularz tworzenia alertu z niezamierzonymi współrzędnymi (konflikt z wyborem pinezki/filtrami/fokusem) | `AlertsMapView` przekazywała `onMapClick`/`pendingCoords` do `AlertMap`, więc każde kliknięcie na mapie mogło wywołać tworzenie wpisu | Usunięto obsługę kliknięcia na mapie przeglądowej (`be6cc04`); wybór lokalizacji przeniesiono wyłącznie do `LocationPicker` wewnątrz formularza |
| 10 | `Navbar.tsx`/`AuthStatus.tsx`/`NavLinks.tsx` usunięte w `5c84c24` bez zamiennika — brak nawigacji/informacji o sesji w całej aplikacji | Nieustalone — nie znaleziono uzasadnienia w commicie ani zamiennika w drzewie kodu | **Do wyjaśnienia z autorem zmiany**: czy to celowe (np. pod redesign nawigacji), czy przeoczenie przy dużym refaktorze; patrz też sekcja 2 |

## 9. Świadomie poza zakresem

Nie zrobiono (i nie powinno być robione w ramach tej karty):

- **Kategorie zdarzeń** — ✅ **zrealizowane** w `92a336f`/`5c84c24` (pole
  `Alert.category`, rozróżnienie ALERT/EVENT), patrz sekcje 1 i 3. Pierwotnie
  odłożone jako osobna karta zależna od decyzji Marcina (Fundacja) — decyzja
  ostatecznie zapadła i funkcja została zrealizowana wcześniej niż
  zakładano.
- **Model `Organizacja`** jako osobna encja (dziś `User.organization` to
  zwykły string) — wymagane dla pełnego 3-poziomowego modelu ról z notatek
  spotkań (administrator główny / lider lokalny / organizacja), ale to
  osobna, duża karta ("Projekt schematu bazy danych"). Nadal aktualne —
  nowy filtr "organizacja" w `AlertsMapView` filtruje po tym samym stringu,
  nie po relacji.
- **Integracja z UNHCR Matrix** — klient jednoznacznie zdecydował: własna
  baza, zero integracji zewnętrznych (patrz wcześniejsze ustalenia w tej
  rozmowie)
- **Boczny panel nawigacyjny** z dostarczonego mockupu wizualnego —
  wyraźnie wyłączony z zakresu na prośbę: *"за бокову панель поки не
  берись, головне щоб мапа була доступна по лінку"*. Nadal nie
  zaimplementowany — a od `5c84c24` zniknęła też dotychczasowa nawigacja
  górna (patrz problem #10 wyżej), więc obecnie nie ma **żadnej** nawigacji
  globalnej w aplikacji.
- **Pełny model `Zdarzenie`** (zatwierdzanie zgłoszeń, dedykowany koordynator
  zdarzenia, wątki komunikacji) — częściowo zaadresowane przez `kind =
  EVENT` na istniejącym `Alert` (sekcja 3), ale te elementy nadal nie
  istnieją.

## 10. Jak zweryfikować

```bash
docker compose up -d               # Postgres + Redis
npx prisma migrate dev             # upewnij się, że migracja jest zastosowana
npm run prisma:seed                 # dane testowe (1 gmina: Nowa Dęba)
npm run dev
```

Konta testowe (hasło: `Test1234!` dla wszystkich poniżej):
- `koordynator@example.com` — COORDINATOR, może zarządzać alertami Nowa Dęba
- `wolontariusz@example.com` / `wolontariusz2@example.com` — VOLUNTEER, tylko podgląd

Automatyczne testy: `npm run test` (190 testów w całym projekcie, żaden nie
dotyczy jeszcze bezpośrednio `/map` — logika CRUD alertów była
zweryfikowana ręcznie przez `curl`, nie ma jeszcze pokrycia w `vitest`,
patrz sekcja 11).

## 11. Sugerowane następne kroki

- **Wyjaśnić usunięcie nawigacji** (`Navbar`/`AuthStatus`/`NavLinks`,
  problem #10) — przywrócić w jakiejś formie albo potwierdzić, że to
  świadome i zaplanować zamiennik
- Dopisać testy jednostkowe dla `src/app/api/alerts/route.ts` i
  `[id]/route.ts` (wzorem istniejących `route.test.ts` przy
  `/api/admin/invites`), w tym walidację `kind`/`category`
  (`isCategoryValidForKind`) — obecnie zweryfikowane tylko ręcznie
  (`geocode.ts` ma już pokrycie w `geocode.test.ts`, ale endpointy
  `/api/geocode/*` i `/api/alerts/*` — nie)
- Rozważyć elementy pełnego modelu `Zdarzenie` z notatek klienta
  (zatwierdzanie zgłoszeń, dedykowany koordynator zdarzenia, wątki
  komunikacji), jeśli okażą się potrzebne ponad obecne `kind = EVENT`
- Rozważyć widoki "tylko mapa" / "tylko karty" (przełącznik `Podzielony /
  Mapa / Karty` widoczny na dostarczonym mockupie) — obecnie jest tylko
  pokazanie/ukrycie mapy plus zakładki Alert/Zdarzenie, mapa i listy są
  zawsze ułożone pionowo
- Monitorować limit Nominatim (~1 req/s) przy większej skali pilotażu —
  obecny `geocodeLimiter` zakłada niewielką liczbę jednoczesnych
  ADMIN/COORDINATOR
