BEGIN;

GRANT SELECT ON TABLE
  public."AI_Crypto_Bot_Profiles",
  public."AI_Crypto_Bot_Portfolios",
  public."AI_Crypto_Bot_Positions",
  public."AI_Crypto_Bot_Trades",
  public."AI_Crypto_Bot_Portfolio_Snapshots",
  public."AI_Crypto_Bot_Emergency_State"
TO ai_crypto_bot_runtime_reader;

COMMIT;
