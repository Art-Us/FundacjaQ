# QFundation

Projekt aplikacji webowej opartej o Next.js (App Router), TypeScript, Tailwind CSS oraz Prisma ORM (PostgreSQL).

## Wymagania wstępne
- [Node.js](https://nodejs.org/) (wersja >= 18)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (dla PostgreSQL i Redis)

## Uruchomienie lokalne

1. **Sklonuj repozytorium i zainstaluj zależności:**
   ```bash
   npm install
   ```

2. **Skonfiguruj zmienne środowiskowe:**
   Skopiuj `.env.example` do pliku `.env` i wygeneruj `NEXTAUTH_SECRET`:
   ```bash
   cp .env.example .env
   openssl rand -base64 32   # wklej wynik jako NEXTAUTH_SECRET
   ```

3. **Uruchom bazy danych (Docker — PostgreSQL + Redis):**
   ```bash
   docker compose up -d
   ```

4. **Wykonaj migracje bazy danych:**
   ```bash
   npx prisma migrate dev
   ```

5. **Uruchom serwer deweloperski:**
   ```bash
   npm run dev
   ```

Aplikacja będzie dostępna pod adresem [http://localhost:3000](http://localhost:3000).

## Logowanie i konta

System jest zamknięty — nie ma publicznej rejestracji. Konta tworzy się przez zaproszenia
wysyłane z panelu `/admin/invites` (dostępnego dla ról `ADMIN`/`COORDINATOR`).

Aby utworzyć pierwsze konto administratora lokalnie, ustaw `ADMIN_EMAIL` i `ADMIN_PASSWORD`
i uruchom seed:
```bash
ADMIN_EMAIL="admin@example.com" ADMIN_PASSWORD="ZmienTeHaslo123456" npm run prisma:seed
```

Dopóki nie skonfigurujesz SMTP (patrz niżej), linki zaproszeń i resetu hasła są tylko
logowane do konsoli serwera deweloperskiego.

## E-mail (SMTP)

Zaproszenia i linki resetu hasła wysyłane są przez SMTP (`nodemailer`). Bez skonfigurowanego
`SMTP_HOST` e-maile są tylko logowane do konsoli — wygodne lokalnie, nic do ustawienia.

Aby wysyłać prawdziwe e-maile, ustaw w `.env` dane swojego serwera SMTP (dowolny dostawca —
istniejąca skrzynka organizacji, Gmail/Workspace, hosting, itp.):
```
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="twoj-login@example.com"
SMTP_PASSWORD="..."
SMTP_FROM="QFundation <no-reply@example.com>"
```
`SMTP_SECURE="true"` przy porcie 465 (SSL/TLS od początku połączenia); przy porcie 587
zostaw `"false"` (STARTTLS negocjowane automatycznie). Błąd wysyłki nie przerywa żądania —
jest tylko logowany do konsoli serwera, żeby np. utworzenie zaproszenia nie kończyło się
błędem 500 z powodu chwilowej awarii serwera pocztowego.

## Captcha (reCAPTCHA v2)

Logowanie, reset hasła i akceptacja zaproszenia dodatkowo wymagają rozwiązania captchy,
gdy z jednego konta/tokenu albo z jednego adresu IP przyjdzie zbyt wiele prób w krótkim czasie
(niezależnie od twardych limitów opisanych w `src/lib/rateLimit.ts`).

Bez skonfigurowanych kluczy captcha jest pomijana (fail-open po stronie klucza, żeby środowisko
deweloperskie działało od razu). Aby ją włączyć, utwórz klucze na
[https://www.google.com/recaptcha/admin/create](https://www.google.com/recaptcha/admin/create)
(typ reCAPTCHA v2 „Checkbox") i ustaw w `.env`:
```
RECAPTCHA_SECRET_KEY="..."
NEXT_PUBLIC_RECAPTCHA_SITE_KEY="..."
```
