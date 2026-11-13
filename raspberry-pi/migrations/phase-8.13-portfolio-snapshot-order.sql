BEGIN;

ALTER TABLE public."AI_Crypto_Bot_Portfolio_Snapshots"
  ADD COLUMN snapshot_order bigint GENERATED ALWAYS AS IDENTITY;

CREATE UNIQUE INDEX "AI_Crypto_Bot_Portfolio_Snapshots_order_key"
  ON public."AI_Crypto_Bot_Portfolio_Snapshots" (snapshot_order);

CREATE INDEX "AI_Crypto_Bot_Portfolio_Snapshots_chronology_idx"
  ON public."AI_Crypto_Bot_Portfolio_Snapshots"
    (portfolio_id, captured_at, snapshot_order);

COMMIT;
