# Architecture Decisions

Dit document bevat belangrijke architecturale beslissingen.

---

## 2026-10-31

### Phase 02 Authentication

Besluit:

Gebruik Supabase Auth JS session persistence voor accountstromen en een server-geverifieerde HttpOnly cookie met Vercel rewrites voor beschermde HTML-pagina's.

Reden:

- Browser sessies blijven bestaan tussen pagina's en refreshes
- Vercel levert beschermde pagina-inhoud niet aan zonder geldige Supabase sessie
- De public anon key is de enige Supabase sleutel die naar de browser wordt gestuurd

Status:

Accepted

---

## 2026-10-31

### Phase 01 Project Setup

Besluit:

Gebruik statische HTML, CSS en JavaScript met Node.js' ingebouwde `node:test` en projectvalidatie; voeg geen frontendframework of runtime dependency toe.

Reden:

- Past bij de afgesproken technologie-stack
- Houdt de Vercel-deployment zonder frontend-buildtool eenvoudig
- Maakt projectchecks uitvoerbaar zonder package-installatie

Status:

Accepted

---

## 2026-10-31

### Frontend

Besluit:

Gebruik HTML, CSS en JavaScript.

Reden:

- Eenvoudige Vercel deployment
- Geen buildproces
- Minder complexiteit

Status:

Accepted

---

## 2026-10-31

### Backend

Besluit:

Gebruik Supabase.

Reden:

- Authentication
- PostgreSQL
- Realtime
- Eenvoudige beheerbaarheid

Status:

Accepted

---

## 2026-10-31

### Trading Mode

Besluit:

Start als Paper Trading platform.

Reden:

- Veiligheid
- Testbaarheid
- Strategievalidatie

Status:

Accepted

---

## 2026-10-31

### Agent Brain

Besluit:

Gebruik Three.js.

Reden:

- Visuele feedback
- Duidelijke agent status
- Premium dashboard uitstraling

Status:

Accepted