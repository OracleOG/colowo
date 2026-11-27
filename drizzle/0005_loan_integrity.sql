-- Offers and the loan timeline are records of what was agreed: offers may only have
-- their response filled in (once); events are append-only.
CREATE OR REPLACE FUNCTION colowo_offer_response_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'loan offers cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.response IS NOT NULL THEN
    RAISE EXCEPTION 'offer % already has a response', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.application_id, NEW.version, NEW.amount_kobo, NEW.rate_percent, NEW.interest_kobo, NEW.total_kobo,
      NEW.tenure_months, NEW.instalment_kobo, NEW.first_repayment_period, NEW.conditions, NEW.valid_until, NEW.offered_by)
     IS DISTINCT FROM
     (OLD.application_id, OLD.version, OLD.amount_kobo, OLD.rate_percent, OLD.interest_kobo, OLD.total_kobo,
      OLD.tenure_months, OLD.instalment_kobo, OLD.first_repayment_period, OLD.conditions, OLD.valid_until, OLD.offered_by) THEN
    RAISE EXCEPTION 'offer terms cannot be changed; make a new offer' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER loan_offers_response_only
  BEFORE UPDATE OR DELETE ON loan_offers
  FOR EACH ROW EXECUTE FUNCTION colowo_offer_response_only();
--> statement-breakpoint
CREATE TRIGGER loan_events_append_only
  BEFORE UPDATE OR DELETE ON loan_events
  FOR EACH ROW EXECUTE FUNCTION colowo_forbid_modify();
