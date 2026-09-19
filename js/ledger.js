import { pushItem, PATH } from "./database.js";

/**
 * Append an immutable ledger entry.
 * Only admin-side code calls this. Users never write to transactions.
 */
export async function writeLedgerEntry({
  uid, cycleId="", type, amount, wallet,
  previousBalance=0, newBalance=0,
  referenceId="", note="", actor, currency="UGX"
}){
  return pushItem(PATH.transactions, {
    uid, cycleId, type, amount, wallet,
    previousBalance, newBalance,
    referenceId, note, actor, currency,
    status: "COMPLETED",
    timestamp: Date.now()
  });
}