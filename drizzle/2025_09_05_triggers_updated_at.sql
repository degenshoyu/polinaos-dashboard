CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_kol_tweets') THEN
    CREATE TRIGGER set_updated_at_kol_tweets
    BEFORE UPDATE ON "kol_tweets"
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;
END $$;
