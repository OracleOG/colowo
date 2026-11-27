# Loans — process design

Loans and savings are separate ledgers and are **never netted** for members: a member
always sees "what I have saved" and, next to it, "what I owe on each loan".
Net position (savings − loans) exists only in admin reports.

The process separates four things that happen at different times, by different people:

```
 1. OFFER          2. APPLY & AGREE                3. PAY OUT                 4. REPAY
 Admin opens   →   Member applies → Approver   →   Officer exports the    →   Payroll file / repayment
 a loan scheme     makes an offer → member          payout list, pays,         upload / manual entry
                   accepts / declines /             uploads it back             → balance falls → completed
                   asks for adjustment              → loan becomes active
```

---

## 1. Loan schemes (what the cooperative advertises)

An admin creates a **scheme** whenever there is money to lend:

| Field | Example |
|---|---|
| Name, description | "December special loan", "Regular loan", "Commodity loan — rice & oil" |
| Type | regular · commodity · special (bulk) |
| Money available (optional) | ₦20,000,000 — the app shows how much is already offered/committed |
| Maximum per member (optional) | ₦300,000 |
| Default interest rate & method | 10%, flat, added at payout `[CONFIRM]` |
| Default repayment period | 10 months |
| Application window | open 1 Dec – close 15 Dec (or "always open" for the general loan) |
| Notes / conditions | free text shown to members |

Members see open schemes on their phone with an **Apply** button. A permanent
"General loan" scheme covers ordinary requests.

## 2. Application, offer and agreement

```
submitted ──► offered ──► accepted ──► (payout)
   │  ▲          │  │
   │  └─adjust───┘  └─► declined (by member)
   ├─► rejected (by approver, with reason)
   └─► cancelled (by member, any time before payout)
```

**Application** (member on their phone, or an officer on their behalf):
scheme, amount requested, purpose/description, preferred repayment period.

**Offer** (approver, permission `loan.approve`): the approver sees an eligibility panel
(savings balance, current loans and what's left on them, whether previous loans are
completed, months of membership, missed repayments) and makes an offer:

- amount approved (can be less than requested — e.g. asked ₦200,000, offered ₦100,000)
- interest rate → interest amount and total repayable
- repayment period (months), monthly instalment, first repayment month
- conditions / note to the member
- offer valid until (e.g. 14 days) `[CONFIRM]`

**Member responds** on their phone:
- **Accept** → agreed. This version is final.
- **Decline** → closed.
- **Request adjustment** — says what they want ("₦150,000 over 12 months") → back to the
  approver, who sends a revised offer. Every offer version is kept, so the negotiation
  is on record.
- **Cancel** — any time until the money is paid out.

Rules: nobody approves their own application; an exited or suspended member can't apply;
eligibility rules (e.g. "previous loan of the same type must be completed",
"maximum = 2× savings") start as **warnings**, and become blocking once the cooperative confirms them.

## 3. Paying out (disbursement) — a separate step

Approval is not payment. The loan officer:

1. Opens **Payouts**, filters accepted loans (e.g. by scheme), and creates a **payout list**.
2. Downloads it as **Excel** (and printable): member no., name, employment no., bank details,
   approved amount, interest, total repayable, monthly instalment, first repayment month,
   plus empty columns **Amount paid · Date paid · Payment reference**.
3. Pays the members (bank transfer, cheque, cash), fills in the empty columns, and
   **uploads the sheet back**.
4. Colowo checks each row (right loan, amount = approved, not paid before), the officer
   reviews and commits — the same review-then-commit pattern as the bank deduction import.
5. On commit each loan becomes **active**: the loan ledger gets the disbursement and
   interest, and the repayment schedule starts.

Single loans can also be marked paid individually. **Scheme view** shows everyone who got
that loan, how much, and how much is still outstanding.

## 4. Repayments

Three ways in, all landing in the loan ledger:

| Channel | How |
|---|---|
| **Payroll deduction** | The monthly bank file. Each member's single amount is split by the allocation rule — default: loan instalments due first, remainder to savings `[CONFIRM]`. |
| **Repayment upload** | An Excel template (employment/member no., loan ref, amount, date, reference) for repayments outside payroll, or a separate loan file from the bank — same review/commit screen. |
| **Manual entry** | Cash or transfer for one member. |

- A member can **stop or reduce savings to pay a loan faster**: that's a change to their
  payroll deduction; Colowo simply allocates whatever comes in.
- **Paying a loan from savings** (if the cooperative allows) is two linked entries — a savings
  withdrawal and a loan repayment — admin only. Never silent netting.
- **Overpayment** is flagged and held, not swallowed.
- Balance reaches zero → loan **completed** automatically; it appears in history and the
  member can take the next loan of that type.
- **Arrears**: each month the expected instalment is compared with what was paid.

## 5. What members see (phone first)

- **Savings**: balance today, earnings this year, savings by year, and a **statement for any
  period** (from–to month): opening balance, contributions, withdrawals, closing — download
  as PDF.
- **Loans** (separate card): open schemes to apply for; my applications and offers
  (accept / decline / request adjustment); each active loan — amount received, interest,
  total repayable, paid so far, **balance**, months left, next instalment; completed loans.

## 6. Data model

```
loan_schemes        id, name, type, description, pool_kobo?, max_per_member_kobo?, rate, interest_method,
                    default_tenure_months, opens_on, closes_on?, status open|closed, created_by
loan_applications   id, member_id, scheme_id, requested_kobo, purpose, preferred_tenure_months,
                    status submitted|offered|accepted|declined|rejected|cancelled|disbursed,
                    created_by (member or officer), timestamps
loan_offers         id, application_id, version, amount_kobo, rate, interest_kobo, total_kobo,
                    tenure_months, instalment_kobo, first_repayment_period, conditions, valid_until,
                    offered_by, response accepted|declined|adjustment_requested|null, response_note, responded_at
loan_messages       application_id, author, text            (adjustment requests, replies)
payout_batches      id, scheme_id?, status draft|exported|committed|cancelled, created_by, file refs
payout_rows         batch_id, application_id, amount_paid_kobo, paid_on, reference, status, error_code
loan_accounts       id, member_id, application_id, accepted_offer_id, principal_kobo, interest_kobo,
                    instalment_kobo, first_repayment_period, tenure_months, status active|completed|written_off,
                    disbursed_at, completed_at
loan_transactions   id, loan_id, period, txn_date, type disbursement|interest|repayment|adjustment|reversal,
                    amount_kobo, source import|payout|manual|migration, batch refs, reverses_id   (append-only)
members             + bank_name, account_number, account_name   (for payout lists) [CONFIRM]
```

## 7. Build order

1. Schemes, applications, offers, member accept/decline/adjust — on phone and desktop.
2. Payout list export → upload → commit; loan accounts and ledger.
3. Repayments: manual, repayment upload, payroll allocation; completion and arrears.
4. Member loan view, scheme/loan reports; savings statement for any period (PDF).

## 8. Decisions needed from the cooperative

1. Interest: flat and **added** at payout (as the personal sheet shows), or **deducted** from the
   amount paid out? Rates for regular and commodity loans?
2. Approval: one approver, or two levels (e.g. loan committee, then president)?
3. Payout: to the member's bank account? If so, Colowo needs each member's bank details.
4. Eligibility: may a member hold two loans of the same type? Maximum as a multiple of savings?
   Minimum months of membership?
5. Repayment: does loan repayment come inside the same payroll amount (split by rule) or as a
   separate bank file?
6. How long is an offer valid before it lapses?
