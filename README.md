# Hushåll PWA

En enkel PWA för att sköta vardagen i ett hushåll. Målet är att samla sånt som annars blir "vi kom på en rätt men glömde skriva ner", "vad behöver vi handla?", "vem betalade vad?" och "vad får vi inte missa?" – i en och samma app som funkar på mobil och dator.

Byggd med **Vite + React + TypeScript** och **Supabase** som backend (Auth + Postgres + Realtime + RLS).

Fokus: lätt, snabbt och praktiskt – utan onödigt krångel.

## Innehåll

- [Funktioner](#funktioner)
- [Tech stack](#tech-stack)
- [Kom igång lokalt](#kom-igång-lokalt)
- [Supabase setup (översikt)](#supabase-setup-översikt)
- [Vanliga problem](#vanliga-problem)
- [Deploy](#deploy)

## Funktioner

- **Inloggning/konto** via Supabase Auth (email + lösenord)
- **Hushåll**
  - Skapa hushåll
  - Gå med via **join-kod** så att flera delar samma data
- **Mat** (allt på samma sida)
  - "Finns hemma"
  - "Behöver köpas"
  - "Maträttsbank"
  - **Realtime**-uppdatering mellan hushållsmedlemmar
- **Att göra**
  - Uppgifter kan tilldelas till medlem
- **Viktigt/evenemang**
- **Ekonomi**
  - Varje medlem kan lägga in sina egna utgifter
  - Summering av totalsumma och "vem är skyldig vem?"

## Tech stack

### Frontend

- Vite + React + TypeScript
- React Router

### Backend (Supabase)

- Auth (email/lösenord)
- Postgres
- Row Level Security (RLS)
- Realtime (`postgres_changes`)
- RPC/SQL-funktioner

## Kom igång lokalt

### 1) Installera beroenden
```bash
npm install
```

### 2) Skapa miljövariabler

Skapa en fil `.env.local` i projektroten (committas inte).
Du kan kopiera `.env.example` och fylla i egna värden.
```env
VITE_SUPABASE_URL="https://YOURPROJECT.supabase.co"
VITE_SUPABASE_ANON_KEY="YOUR_ANON_KEY"
VITE_VAPID_PUBLIC_KEY="YOUR_VAPID_PUBLIC_KEY"
```

**Notera:** `VITE_SUPABASE_ANON_KEY` är en publishable/anon key och är tänkt att kunna ligga i frontend. Säkerheten ska ligga i Supabase RLS policies, inte i att "gömma" anon-keyn.

### 3) Starta utvecklingsserver
```bash
npm run dev
```

### 4) Bygg och testa lokalt (rekommenderas innan deploy)
```bash
npm run build
npm run preview
```

## Supabase setup (översikt)

I Supabase behöver du:

1. Skapa ett projekt
2. Aktivera Auth med email
3. Skapa tabeller/policies/funktioner för hushållsdata (RLS + Realtime)
4. Vid deploy: sätt rätt URL-konfiguration i Supabase Auth

**Tips:** Om Realtime inte funkar för en tabell, kontrollera att:
- Realtime är aktiverat för tabellen i Supabase
- Dina RLS policies tillåter SELECT för hushållsmedlemmar

## Vanliga problem

### Realtime funkar inte

- Kontrollera att tabellen har Realtime aktiverat i Supabase
- Kontrollera att dina RLS policies tillåter att medlemmar i hushållet får läsa raderna

### Login/reset strular efter deploy

Gå till: **Supabase → Authentication → URL Configuration**

Exempel:
- Site URL: `https://din-domän`
- Redirect URLs: `https://din-domän/*` (och ev. specifika routes för reset)

## Deploy

Appen kan deployas på en statisk host (t.ex. Vercel eller Netlify).

Vid deploy behöver du lägga in samma env-variabler i hostens UI:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY` (valfri om push inte används)
