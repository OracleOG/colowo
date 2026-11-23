-- The savings ledger is append-only: corrections are reversal/adjustment rows.
CREATE TRIGGER savings_transactions_append_only
  BEFORE UPDATE OR DELETE ON savings_transactions
  FOR EACH ROW EXECUTE FUNCTION colowo_forbid_modify();
--> statement-breakpoint
CREATE TRIGGER savings_transactions_no_truncate
  BEFORE TRUNCATE ON savings_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION colowo_forbid_modify();
--> statement-breakpoint

-- A reversal must exactly cancel the transaction it reverses, for the same member and period,
-- and a reversal can never itself be reversed.
CREATE OR REPLACE FUNCTION colowo_check_savings_reversal() RETURNS trigger AS $$
DECLARE orig savings_transactions%ROWTYPE;
BEGIN
  IF NEW.reverses_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO orig FROM savings_transactions WHERE id = NEW.reverses_id;
  IF orig.type = 'reversal' THEN
    RAISE EXCEPTION 'a reversal cannot be reversed' USING ERRCODE = 'check_violation';
  END IF;
  IF orig.member_id <> NEW.member_id OR orig.period <> NEW.period OR orig.amount_kobo <> -NEW.amount_kobo THEN
    RAISE EXCEPTION 'reversal must cancel transaction % exactly', orig.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER savings_reversal_check
  BEFORE INSERT ON savings_transactions
  FOR EACH ROW EXECUTE FUNCTION colowo_check_savings_reversal();
--> statement-breakpoint

-- Uploaded files are evidence: never changed once stored.
CREATE TRIGGER stored_files_append_only
  BEFORE UPDATE OR DELETE ON stored_files
  FOR EACH ROW EXECUTE FUNCTION colowo_forbid_modify();
--> statement-breakpoint

-- Earnings rates found in the cooperative's personal account sheets (0.42%/month to 2021, 0.5% from 2022).
INSERT INTO earning_rates (effective_from, monthly_rate, note) VALUES
  ('2019-01', 0.004200, 'From personal deduction sheets (2019-2021)'),
  ('2022-01', 0.005000, 'From personal deduction sheets (2022 onward)')
ON CONFLICT DO NOTHING;
