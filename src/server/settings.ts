/**
 * Business settings that the cooperative hasn't confirmed yet. Read from the
 * environment for now; these move to an admin-editable settings table later.
 */
export const settings = {
  /** Flag an import amount that differs from the member's usual by more than this fraction. */
  importAnomalyThreshold: Number(process.env.IMPORT_ANOMALY_THRESHOLD ?? 0.5),
  /** [CONFIRM] Should deductions for suspended members be held back ("block") or posted ("allow")? */
  importSuspendedPolicy: (process.env.IMPORT_SUSPENDED_POLICY === "allow" ? "allow" : "block") as "block" | "allow",
  /**
   * Compare the bank's YTD column with Colowo's records. Off until we see a few
   * real months — in the sample file YTD is 12× the monthly amount in May.
   */
  importYtdCheck: process.env.IMPORT_YTD_CHECK === "on",
  /** Largest bank file accepted. */
  importMaxBytes: 5 * 1024 * 1024,
};
