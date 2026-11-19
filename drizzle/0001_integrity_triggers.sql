-- Database-level integrity rules that must hold no matter which code path writes.

-- Reusable guard for append-only tables (audit log now; ledgers later).
CREATE OR REPLACE FUNCTION colowo_forbid_modify() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION colowo_forbid_modify();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION colowo_forbid_modify();
--> statement-breakpoint

-- member_no is the canonical ID: it can never change once issued.
CREATE OR REPLACE FUNCTION colowo_member_no_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.member_no IS DISTINCT FROM OLD.member_no THEN
    RAISE EXCEPTION 'member_no is immutable (% -> %)', OLD.member_no, NEW.member_no
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER members_member_no_immutable
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION colowo_member_no_immutable();
--> statement-breakpoint

-- Members are never deleted; they are exited. History must survive.
CREATE TRIGGER members_no_delete
  BEFORE DELETE ON members
  FOR EACH ROW EXECUTE FUNCTION colowo_forbid_modify();
