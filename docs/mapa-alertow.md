# Mapa Ostrzeżeń Kryzysowych (`/map`)

Dokumentacja techniczna funkcjonalności dodanej w ramach zadania Trello
**"Integracja Mapy"** (kolumna *In progress*, gałąź `alerts-map`, bazowana na
`dev`). Opisuje co dokładnie powstało, dlaczego w taki sposób, oraz jakie
problemy napotkano i naprawiono po drodze.

## 1. Co zostało zrealizowane

Zakres z opisu karty Trello:
- ✅ Integracja mapy, pusta mapa wycentrowana na gminie Nowa Dęba
- ✅ Struktura Alertów (rozszerzenie modelu o współrzędne)
- ✅ CRUD operations (create/update-status/delete przez API)
- ✅ Formularz stworzenia alertu
- ✅ Lista alertów pod mapą
- ✅ Filtracja i sortowanie alertów

Świadomie **poza zakresem** tego zadania (patrz sekcja 9):
kategorie zdarzeń, model `Organizacja`, integracja z UNHCR Matrix — te
elementy zależą od osobnych, jeszcze niezrealizowanych kart.

## 2. Nowe pliki

```
prisma/
  migrations/20260906164413_add_alert_coordinates/   ← nowa migracja
src/
  app/(protected)/map/
    page.tsx              ← Server Component: dane + autoryzacja
    AlertsMapView.tsx      ← Client: filtry, sortowanie, legenda, lista kart
    AlertMap.tsx            ← Client: sama mapa Leaflet (dynamic import, ssr:false)
    AlertForm.tsx            ← Client: formularz tworzenia alertu
    AlertActions.tsx          ← Client: przyciski "Rozwiąż"/"Usuń"
    leaflet-dark.css           ← ciemny motyw dla UI Leafleta
  app/api/alerts/
    route.ts                    ← POST (tworzenie alertu)
    [id]/route.ts                 ← PATCH (edycja/status), DELETE (tylko ADMIN)
  lib/
    alertLabels.ts                 ← wspólne polskie etykiety + kolory (nowy plik)
  components/layout/
    NavLinks.tsx                     ← nowy: linki nawigacji zależne od sesji
docs/
  mapa-alertow.md                     ← ten dokument
```

Zmodyfikowane pliki: `prisma/schema.prisma`, `prisma/seed.ts`,
`src/app/(protected)/page.tsx`, `src/components/layout/Navbar.tsx`,
`src/middleware.ts`, `package.json`.

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

### Dlaczego `Alert`, a nie nowy model `Zdarzenie`

Analiza notatek ze spotkań z klientem wskazywała na docelowy model
`Zdarzenie` (zatwierdzanie, kategorie, koordynator zdarzenia, wątki
komunikacji). Istniejący `Alert` już jednak pokrywał dokładnie to, czego
potrzebowała ta konkretna karta (tytuł, opis, `severity`, `status`,
lokalizacja, gmina, autor) — rozszerzenie go o współrzędne było najmniejszą
zmianą realizującą zakres karty, bez przedwczesnego projektowania pełnego
modelu `Zdarzenie`, którego kształt nie jest jeszcze potwierdzony (osobna
karta w Backlogu). Migracja do pełnego modelu `Zdarzenie` pozostaje przyszłym
zadaniem — `Alert` prawdopodobnie stanie się wtedy jednym z jego pól/relacji.

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
| Zmiana statusu / edycja (`PATCH /api/alerts/:id`) | ❌ `403` | ✅ (tylko własna gmina) | ✅ |
| Trwałe usunięcie (`DELETE /api/alerts/:id`) | ❌ `403` | ❌ `403` | ✅ |

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
  severity: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL',
  location?: string,        // max 200 znaków 
  latitude: number,          // -90..90
  longitude: number,          // -180..180
  gminaId: string,
  expiresAt?: string          // ISO date
}
```
Walidacja przez `zod`. Odpowiedź: `{ message, alert }` (201-ekwiwalent, status `200`) albo `{ error }` (`400`/`403`).

### `PATCH /api/alerts/:id`

Częściowa aktualizacja dowolnego podzbioru pól (w tym `status`). Używane
głównie przez `AlertActions.tsx` do zmiany statusu na `RESOLVED`.

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
- **`AlertsMapView.tsx`** (Client) — cały stan interaktywny: filtry
  (`Set<string>` dla severity/status), sortowanie, `focusedAlertId`
  (obsługa przycisku "Pokaż na mapie"), przełącznik formularza tworzenia.
  Filtrowanie/sortowanie odbywa się **w pamięci przeglądarki**
  (`useMemo`), bez dodatkowych zapytań sieciowych — uzasadnione skalą
  pilotażu (dziesiątki, nie tysiące alertów).
- **`AlertMap.tsx`** (Client, `dynamic(..., {ssr:false})`) — jedyny plik
  dotykający bezpośrednio Leaflet. Leaflet odwołuje się do `window` przy
  imporcie modułu, więc **musi** być wyłączony z renderowania po stronie
  serwera — to konkretna przyczyna użycia `next/dynamic` zamiast zwykłego
  importu.
- **`AlertForm.tsx`** — współrzędne ustawiane kliknięciem na mapie
  (`onMapClick` przekazywany z rodzica), nie ręcznym wpisywaniem liczb.
- **`AlertActions.tsx`** — dokładnie ten sam wzorzec co
  `RevokeInviteButton.tsx`/`ToggleUserActiveButton.tsx`: `loading`+`error`
  state, `fetch` bez zbędnych bibliotek, `router.refresh()` po sukcesie.

## 7. Wybory technologiczne

**Leaflet + react-leaflet + kafelki admin@qfundation.local** (nie Mapbox/Google Maps):
- brak wymaganego klucza API i kosztów — spójne z ograniczeniami budżetu
  hostingu wskazanymi przez klienta (notatki kickoff: $10-65/mies.)
- `leaflet` (JS) + `react-leaflet` (wrapper) + `@types/leaflet` (typy)

**Ciemny motyw** (`leaflet-dark.css`) — Leaflet nie ma trybu ciemnego z
pudełka; domyślny biały popup/kontrolki wyglądałyby jak "dziura" w ciemnym
interfejsie reszty aplikacji. Osobny plik CSS nadpisuje kolory
`.leaflet-popup-*`, `.leaflet-control-zoom`, `.leaflet-control-attribution`.

**Filtrowanie tylko po `severity`/`status`** (nie po kategorii/organizacji,
mimo że dostarczony mockup wizualny je pokazywał) — model `Alert` nie ma
pola `category` ani relacji do `Organizacja` (świadomie odłożone, patrz
sekcja 9), więc UI filtruje tylko po tym, co realnie istnieje w bazie.

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

## 9. Świadomie poza zakresem

Nie zrobiono (i nie powinno być robione w ramach tej karty):

- **Kategorie zdarzeń** (pożar/powódź/...) — osobna karta Trello "Model
  kategorii zdarzeń", zależna od decyzji Marcina (Fundacja) wciąż
  oczekującej na potwierdzenie
- **Model `Organizacja`** jako osobna encja (dziś `User.organization` to
  zwykły string) — wymagane dla pełnego 3-poziomowego modelu ról z notatek
  spotkań (administrator główny / lider lokalny / organizacja), ale to
  osobna, duża karta ("Projekt schematu bazy danych")
- **Integracja z UNHCR Matrix** — klient jednoznacznie zdecydował: własna
  baza, zero integracji zewnętrznych (patrz wcześniejsze ustalenia w tej
  rozmowie)
- **Boczny panel nawigacyjny** z dostarczonego mockupu wizualnego —
  wyraźnie wyłączony z zakresu na prośbę: *"за бокову панель поки не
  берись, головне щоб мапа була доступна по лінку"*

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

- Dopisać testy jednostkowe dla `src/app/api/alerts/route.ts` i
  `[id]/route.ts` (wzorem istniejących `route.test.ts` przy
  `/api/admin/invites`) — obecnie zweryfikowane tylko ręcznie
- Po powstaniu modelu `Zdarzenie`: zdecydować, czy `Alert` staje się jego
  polem/relacją, czy zostaje osobnym bytem (np. jako "Zarządzenie Sztabu"
  w przyszłej dwuwarstwowej komunikacji)
- Rozważyć widoki "tylko mapa" / "tylko karty" (przełącznik `Podzielony /
  Mapa / Karty` widoczny na dostarczonym mockupie) — obecnie zaimplementowany
  jest tylko widok połączony (mapa + lista)
