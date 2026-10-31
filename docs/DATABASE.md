# Database Design

## Phase 02 status

This document records the intended future application database design. Phase 02 uses only Supabase's managed Auth service; it creates no application tables, schema, migrations, or policies.

CryptoPulse AI Agent gebruikt Supabase PostgreSQL.

De applicatie wordt toegevoegd aan een bestaande database.

Om conflicten met bestaande tabellen te vermijden moeten alle CryptoPulse-tabellen verplicht beginnen met de prefix:

AI_Crypto_Bot_

Geen enkele tabel mag zonder deze prefix worden aangemaakt.

Hetzelfde principe geldt voor:

- tabellen
- views
- functies
- stored procedures
- indexes
- policies

waar dit praktisch mogelijk is.

---

# Naming Convention

Verplicht:

AI_Crypto_Bot_

Voorbeelden:

AI_Crypto_Bot_Profiles

AI_Crypto_Bot_Portfolios

AI_Crypto_Bot_Positions

AI_Crypto_Bot_Trades

AI_Crypto_Bot_AI_Decisions

AI_Crypto_Bot_Status

---

# AI_Crypto_Bot_Profiles

Beschrijving:

Profielinformatie van gebruikers.

Kolommen:

id UUID PRIMARY KEY

email TEXT UNIQUE NOT NULL

created_at TIMESTAMP

updated_at TIMESTAMP

Relationship:

id references auth.users.id

One Profile exists for each authenticated Supabase user.
---

# AI_Crypto_Bot_Portfolios

Beschrijving:

Portfolio van gebruiker.

Kolommen:

id UUID PRIMARY KEY

user_id UUID

starting_balance NUMERIC

available_balance NUMERIC

portfolio_value NUMERIC

created_at TIMESTAMP

updated_at TIMESTAMP

Foreign Keys:

user_id -> AI_Crypto_Bot_Profiles.id
---

# AI_Crypto_Bot_Positions

Beschrijving:

Open paper trading posities.

Kolommen:

id UUID PRIMARY KEY

portfolio_id UUID

symbol TEXT

amount NUMERIC

entry_price NUMERIC

current_price NUMERIC

unrealized_pnl NUMERIC

status TEXT

created_at TIMESTAMP

updated_at TIMESTAMP

Ondersteunde statussen:

OPEN

CLOSED

Foreign Keys:

portfolio_id -> AI_Crypto_Bot_Portfolios.id

---

# AI_Crypto_Bot_Trades

Beschrijving:

Historiek van paper trades.

Kolommen:

id UUID PRIMARY KEY

portfolio_id UUID

symbol TEXT

side TEXT

price NUMERIC

quantity NUMERIC

fees NUMERIC

slippage NUMERIC

realized_pnl NUMERIC

created_at TIMESTAMP

Ondersteunde waarden:

BUY

SELL

Foreign Keys:

portfolio_id -> AI_Crypto_Bot_Portfolios.id
---

# AI_Crypto_Bot_AI_Decisions

Beschrijving:

Opslag van alle AI beslissingen.

Kolommen:

id UUID PRIMARY KEY

symbol TEXT

decision TEXT

confidence NUMERIC

reason TEXT

strategy_name TEXT

strategy_version TEXT

created_at TIMESTAMP

Ondersteunde waarden:

BUY

SELL

HOLD

WAIT

Classification:

Server Managed

Access:

Read:
Authenticated Users

Write:
Server Only

---

# AI_Crypto_Bot_Status

Beschrijving:

Actuele toestand van de agent.

Kolommen:

id UUID PRIMARY KEY

is_active BOOLEAN

is_analyzing BOOLEAN

status TEXT

last_run TIMESTAMP

error_message TEXT

updated_at TIMESTAMP

Ondersteunde statussen:

ACTIVE

ANALYZING

IDLE

STOPPED

ERROR


---

# AI_Crypto_Bot_Watched_Markets

Beschrijving:

Beheert alle markten die door de agent gevolgd worden.

Kolommen:

id UUID PRIMARY KEY

symbol TEXT UNIQUE

enabled BOOLEAN DEFAULT TRUE

priority INTEGER DEFAULT 1

created_at TIMESTAMP

updated_at TIMESTAMP

---

# AI_Crypto_Bot_Market_Data

Beschrijving:

Laatste opgehaalde marktgegevens.

Kolommen:

id UUID PRIMARY KEY

symbol TEXT

price NUMERIC

volume NUMERIC

daily_change NUMERIC

high_24h NUMERIC

low_24h NUMERIC

captured_at TIMESTAMP

---

# AI_Crypto_Bot_Candles

Beschrijving:

Historische OHLCV data voor analyses en backtesting.

Kolommen:

id UUID PRIMARY KEY

symbol TEXT

interval TEXT

open NUMERIC

high NUMERIC

low NUMERIC

close NUMERIC

volume NUMERIC

timestamp TIMESTAMP

Ondersteunde intervallen:

1m

5m

15m

1h

4h

1d

---

# AI_Crypto_Bot_Strategies

Beschrijving:

Beschikbare tradingstrategieën.

Kolommen:

id UUID PRIMARY KEY

name TEXT

version TEXT

enabled BOOLEAN

score NUMERIC

description TEXT

created_at TIMESTAMP

updated_at TIMESTAMP

---

# AI_Crypto_Bot_Strategy_Changes

Beschrijving:

Historiek van strategie-aanpassingen.

Kolommen:

id UUID PRIMARY KEY

strategy_id UUID

change_type TEXT

old_value TEXT

new_value TEXT

reason TEXT

created_at TIMESTAMP

Foreign Keys:

strategy_id -> AI_Crypto_Bot_Strategies.id
---

# AI_Crypto_Bot_Strategy_Performance

Beschrijving:

Prestatiegegevens van strategieën.

Kolommen:

id UUID PRIMARY KEY

strategy_id UUID

win_rate NUMERIC

profit_factor NUMERIC

average_profit NUMERIC

average_loss NUMERIC

drawdown NUMERIC

score NUMERIC

created_at TIMESTAMP

Foreign Keys:

strategy_id -> AI_Crypto_Bot_Strategies.id
---

# AI_Crypto_Bot_Backtests

Beschrijving:

Historische backtestresultaten.

Kolommen:

id UUID PRIMARY KEY

strategy_id UUID

profit_loss NUMERIC

win_rate NUMERIC

profit_factor NUMERIC

drawdown NUMERIC

created_at TIMESTAMP

Foreign Keys:

strategy_id -> AI_Crypto_Bot_Strategies.id

---

# AI_Crypto_Bot_Portfolio_Snapshots

Beschrijving:

Historische portfolio snapshots.

Kolommen:

id UUID PRIMARY KEY

portfolio_id UUID

portfolio_value NUMERIC

available_balance NUMERIC

open_positions INTEGER

captured_at TIMESTAMP

Foreign Keys:

portfolio_id -> AI_Crypto_Bot_Portfolios.id
---

# AI_Crypto_Bot_Scanner_Events

Beschrijving:

Gevonden market scanner opportunities.

Kolommen:

id UUID PRIMARY KEY

symbol TEXT

event_type TEXT

reason TEXT

confidence NUMERIC

created_at TIMESTAMP

Classification:

Server Managed

Access:

Read:
Authenticated Users

Write:
Server Only
---

# AI_Crypto_Bot_Emergency_State

Beschrijving:

Emergency-control logging.

Kolommen:

id UUID PRIMARY KEY

status TEXT

reason TEXT

created_at TIMESTAMP

Ondersteunde statussen:

NORMAL

PAUSED

EMERGENCY_STOP

---

# Relationships

AI_Crypto_Bot_Profiles
↓
AI_Crypto_Bot_Portfolios

AI_Crypto_Bot_Portfolios
↓
AI_Crypto_Bot_Positions

AI_Crypto_Bot_Portfolios
↓
AI_Crypto_Bot_Trades

AI_Crypto_Bot_Strategies
↓
AI_Crypto_Bot_Strategy_Performance

AI_Crypto_Bot_Strategies
↓
AI_Crypto_Bot_Strategy_Changes

AI_Crypto_Bot_Strategies
↓
AI_Crypto_Bot_Backtests

---

# Row Level Security

All tables must support Row Level Security.

User Owned Tables

- AI_Crypto_Bot_Profiles
- AI_Crypto_Bot_Portfolios
- AI_Crypto_Bot_Positions
- AI_Crypto_Bot_Trades
- AI_Crypto_Bot_Portfolio_Snapshots
- AI_Crypto_Bot_AI_Decisions
- AI_Crypto_Bot_Scanner_Events

DeOwnership Policies are defined per table.

AI_Crypto_Bot_Profiles

auth.uid() = id

AI_Crypto_Bot_Portfolios

auth.uid() = user_id

AI_Crypto_Bot_Positions

Ownership is inherited through portfolio_id.

AI_Crypto_Bot_Trades

Ownership is inherited through portfolio_id.

AI_Crypto_Bot_Portfolio_Snapshots

Ownership is inherited through portfolio_id.

Global Read Tables

- AI_Crypto_Bot_Watched_Markets
- AI_Crypto_Bot_Market_Data
- AI_Crypto_Bot_Candles

Server Managed Tables

- AI_Crypto_Bot_Status
- AI_Crypto_Bot_Emergency_State
- AI_Crypto_Bot_Strategies
- AI_Crypto_Bot_Strategy_Changes
- AI_Crypto_Bot_Strategy_Performance
- AI_Crypto_Bot_Backtests
- AI_Crypto_Bot_AI_Decisions
- AI_Crypto_Bot_Scanner_Events

Administrative functionality must remain separated from user functionality.

---

# Migration Rules

Elke schemawijziging vereist:

- Migration File
- Documentatie Update
- Validatie
- Testing

Nooit rechtstreeks productie-tabellen wijzigen zonder migratie.

---

# Migration Procedure

All database changes must be implemented through Supabase migrations.

Migration Order:

1. Create Tables
2. Create Constraints
3. Create Indexes
4. Create RLS Policies
5. Seed Required Data
6. Validate Schema

Migration files must be stored in:

supabase/migrations/

No direct schema modifications are allowed.

---

# Seed Data

Initial seed data includes:

AI_Crypto_Bot_Watched_Markets

Source:

config/markets.js

Required default markets are seeded during initial deployment.

No user data may be seeded.

---

# Future Extensions

De database moet voorbereid zijn op:

- Multi Strategy Support
- Multi Exchange Support
- Backtesting
- Strategy Optimization
- Autonomous Agent Learning
- Live Trading Support

zonder bestaande data te breken.

# PostgreSQL Naming

Documentation uses:

AI_Crypto_Bot_Profiles

for readability.

Actual PostgreSQL table names should use lowercase identifiers:

ai_crypto_bot_profiles

ai_crypto_bot_portfolios

ai_crypto_bot_positions

ai_crypto_bot_trades

Applications should use lowercase PostgreSQL identifiers.

Documentation may continue to use the readable project format.