import type { BankDetails } from "./config";

/**
 * The company's bank account, the one parents pay their fees into by bank transfer (docs/TUITION_BILLING.md, "Paying by bank transfer").
 *
 * This is the site's own copy: it is what a parent sees unless the four BANK_ environment variables are set, which replace it (all four together;
 * lib/bank/config.ts). If the account ever changes, change it here (or set the variables) and deploy.
 *
 * It is server-only. Only lib/bank/config.ts imports it, the Fees page and the endpoint show it to a signed-in parent or an administrator, and
 * `npm run check:bundle` searches everything a browser can receive for these values and fails if one is there. They appear nowhere else in
 * the repository (tests/bankTransfer.test.mjs checks that too): tests use obviously fake values passed in explicitly.
 */
export const SITE_BANK_DETAILS: BankDetails = {
  payeeName: "LearnThrive Tuition",
  accountNumber: "30119601",
  sortCode: "204276",
  bankName: "BARCLAYS BANK UK PLC",
};
