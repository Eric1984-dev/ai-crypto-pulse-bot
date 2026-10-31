BEGIN;

INSERT INTO public."AI_Crypto_Bot_Watched_Markets" (symbol, enabled, priority)
VALUES
  ('BTC-EUR', true, 1),
  ('ETH-EUR', true, 2),
  ('SOL-EUR', true, 3),
  ('XRP-EUR', true, 4),
  ('ADA-EUR', true, 5)
ON CONFLICT (symbol) DO NOTHING;

INSERT INTO public."AI_Crypto_Bot_Status" (
  id,
  singleton,
  is_active,
  is_analyzing,
  status
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  true,
  false,
  false,
  'IDLE'
)
ON CONFLICT (singleton) DO NOTHING;

INSERT INTO public."AI_Crypto_Bot_Emergency_State" (id, status, reason)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'NORMAL',
  'Initial system state'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
