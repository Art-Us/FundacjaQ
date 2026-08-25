# QFundation

Projekt aplikacji webowej opartej o Next.js (App Router), TypeScript, Tailwind CSS oraz Prisma ORM (PostgreSQL).

## Wymagania wstępne
- [Node.js](https://nodejs.org/) (wersja >= 18)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (dla bazy PostgreSQL)

## Uruchomienie lokalne

1. **Sklonuj repozytorium i zainstaluj zależności:**
   ```bash
   npm install
   ```

2. **Skonfiguruj zmienne środowiskowe:**
   Skopiuj `.env.example` do pliku `.env`:
   ```bash
   cp .env.example .env
   ```

3. **Uruchom bazę danych (Docker):**
   ```bash
   docker compose up -d
   ```

4. **Wykonaj migracje bazy danych:**
   ```bash
   npx prisma migrate dev --name init
   ```

5. **Uruchom serwer deweloperski:**
   ```bash
   npm run dev
   ```

Aplikacja będzie dostępna pod adresem [http://localhost:3000](http://localhost:3000).
