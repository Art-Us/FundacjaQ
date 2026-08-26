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

Dopóki nie skonfigurujesz prawdziwego dostawcy email (`src/lib/email.ts`), linki zaproszeń
i resetu hasła są tylko logowane do konsoli serwera deweloperskiego.
