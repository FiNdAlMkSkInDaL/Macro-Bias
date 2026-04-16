-- Add missing set_updated_at trigger on crypto_daily_briefings
-- (crypto_bias_scores already has this trigger; briefings table was missed)
CREATE TRIGGER set_crypto_daily_briefings_updated_at
  BEFORE UPDATE ON crypto_daily_briefings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
