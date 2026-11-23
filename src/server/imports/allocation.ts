/**
 * How one member's single payroll deduction is split across ledgers.
 *
 * The Kaduna payroll file gives ONE amount per member. Until loans are built
 * (and the cooperative confirms its rule — see DATA_DESIGN.md §6 Q2), the whole
 * amount is a savings contribution. Planned default once loans exist:
 * loan instalments due first (regular, then commodity), remainder to savings.
 * Keep every allocation rule in this module.
 */
export type Allocation = { ledger: "savings"; type: "contribution"; amountKobo: number };

export function allocateDeduction(amountKobo: number): Allocation[] {
  return [{ ledger: "savings", type: "contribution", amountKobo }];
}
