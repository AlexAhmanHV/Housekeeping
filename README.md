# Hushåll PWA

Hushåll PWA är en enkel liten app (PWA) för att sköta vardagen i ett hushåll. Tanken är att samla allt som annars blir “vi kom på en rätt men glömde skriva ner”, “vad behöver vi handla?”, “vem betalade vad?” och “vad får vi inte missa?” – i en och samma app som funkar både på mobil och dator. Projektet är byggt med Vite + React + TypeScript och använder Supabase som backend (Auth + Postgres + Realtime + RLS). Fokus är att hålla det lätt, snabbt och praktiskt – utan onödigt krångel.

## Funktioner

Appen innehåller:
- Inloggning/konto via Supabase Auth (email + lösenord)
- Hushåll: skapa hushåll och gå med via join-kod så att flera kan dela samma data
- Mat (allt på samma sida):
  - “Finns hemma”
  - “Behöver köpas”
  - “Maträttsbank”
  - Realtime-uppdatering mellan hushållsmedlemmar
- Att göra (tilldelning till medlem)
- Viktigt/evenemang
- Ekonomi:
  - varje medlem kan lägga in sina egna utgifter
  - summering av totalsumma och “vem är skyldig vem?”

## Tech stack

Frontend:
- Vite + React + TypeScript
- React Router

Backend (Supabase):
- Auth (email/lösenord)
- Postgres
- Row Level Security (RLS)
- Realtime (postgres_changes)
- RPC/SQL-funktioner

## Kom igång lokalt

1) Installera beroenden:
```bash
npm install

## Skapa miljövariabler:
Skapa en fil .env.local i projektroten (den ska inte committas). Du kan kopiera .env.example och fylla i dina värden:

VITE_SUPABASE_URL="https://YOURPROJECT.supabase.co"
VITE_SUPABASE_ANON_KEY="YOUR_ANON_KEY"
VITE_VAPID_PUBLIC_KEY="YOUR_VAPID_PUBLIC_KEY"
Notera: VITE_SUPABASE_ANON_KEY är en publishable/anon key och är tänkt att kunna användas i frontend. Säkerheten ska ligga i Supabase RLS policies, inte i att gömma anon-keyn.

## Starta utvecklingsserver:
npm run dev

## Bygg och testa build lokalt (bra att göra innan deploy):
npm run build
npm run preview

## Supabase setup (översikt)
I Supabase behöver du:

Skapa ett projekt
Aktivera Auth med email
Skapa tabeller/policies/funktioner för hushållsdata (RLS + realtime)
När du deployar: sätt rätt URL-konfiguration i Supabase Auth
Tips: Om realtime inte funkar för en tabell, kontrollera att Realtime är aktiverat för tabellen i Supabase, och att RLS policies tillåter SELECT för hushållsmedlemmar.

## Vanliga problem:
Realtime funkar inte:
Kontrollera att tabellen har Realtime aktiverat i Supabase
Kontrollera att dina RLS policies tillåter att medlemmar i hushållet får läsa raderna

Login/reset strular efter deploy:
Supabase → Authentication → URL Configuration
Site URL: https://din-domän
Redirect URLs: https://din-domän/* (och ev. specifika routes för reset)

## Deploy (snabbt):
Appen kan deployas på en statisk host (ex. Vercel eller Netlify). Vid deploy behöver du lägga in samma env-variabler i hostens UI:
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_VAPID_PUBLIC_KEY (valfri om push inte används)
