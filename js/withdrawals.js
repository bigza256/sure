// ============================================
// SURE — withdrawal + cycle settlement workflows
// ============================================
import { db, ref, get, update, push } from "./firebase.js";
import { PATH, getOnce, notifyUser, logActivity, listAll } from "./database.js";
import { calculateCycleSettlement } from "./calc.js";

const ZERO_WALLETS = {
  activeAllocation: 0, protectedReserve: 0, availableEarnings: 0,
  totalContribution: 0, totalWithdrawn: 0,
  totalEarningsGenerated: 0, companyShareContributed: 0
};

/**
 * User initiates a withdrawal. Debits nothing — only creates a request.
 * The available earnings balance is only debited when the admin marks COMPLETED.
 */
export async function createWithdrawalRequest({
  uid, userName, userEmail, amount, method, accountNumber, accountName, note = ""
}){
  // 1. Read user + wallets
  const user = await getOnce(`${PATH.users}/${uid}`);
  if(!user) throw new Error("User not found.");
  if(user.status === "suspended") throw new Error("Account is suspended.");

  const wallets = { ...ZERO_WALLETS, ...(user.wallets || {}) };
  if(wallets.availableEarnings < amount){
    throw new Error("Amount exceeds available earnings.");
  }

  // 2. Reject if an active withdrawal is already pending
  const mine = await listAll(PATH.withdrawals);
  const active = mine.find(w =>
    w.uid === uid &&
    ["REQUESTED","PENDING","APPROVED","PROCESSING"].includes(w.status)
  );
  if(active) throw new Error("You already have a withdrawal in progress.");

  const wid = push(ref(db, PATH.withdrawals)).key;
  const now = Date.now();
  await update(ref(db, `${PATH.withdrawals}/${wid}`), {
    wid, uid, userName, userEmail,
    amount, method, accountNumber, accountName, note,
    status: "REQUESTED",
    requestedAt: now,
    fee: 0,
    netAmount: amount,
    processedBy: null,
    processedAt: null,
    rejectionReason: "",
    history: {
      [now]: { at: now, by: uid, from: null, to: "REQUESTED" }
    }
  });

  await notifyUser(uid, {
    type: "WITHDRAWAL_REQUESTED",
    title: "Withdrawal requested",
    body: `Your request for UGX ${amount.toLocaleString()} has been submitted.`
  });

  return wid;
}

/**
 * Admin transitions a withdrawal through the state machine.
 * Only "COMPLETED" debits the available earnings wallet.
 */
export async function transitionWithdrawal({ wid, adminUid, to, reason = "" }){
  const w = await getOnce(`${PATH.withdrawals}/${wid}`);
  if(!w) throw new Error("Withdrawal not found.");

  const valid = {
    REQUESTED:  ["PENDING","APPROVED","REJECTED","CANCELLED"],
    PENDING:    ["APPROVED","REJECTED","CANCELLED"],
    APPROVED:   ["PROCESSING","REJECTED","CANCELLED"],
    PROCESSING: ["COMPLETED","REJECTED"],
    COMPLETED:  [],
    REJECTED:   [],
    CANCELLED:  []
  };
  if(!valid[w.status]?.includes(to)){
    throw new Error(`Cannot move from ${w.status} to ${to}.`);
  }

  const now = Date.now();
  const logId = push(ref(db, PATH.auditLogs)).key;
  const u = {};

  u[`${PATH.withdrawals}/${wid}/status`] = to;
  u[`${PATH.withdrawals}/${wid}/processedBy`] = adminUid;
  u[`${PATH.withdrawals}/${wid}/processedAt`] = now;
  u[`${PATH.withdrawals}/${wid}/history/${now}`] = {
    at: now, by: adminUid, from: w.status, to, reason
  };
  if(to === "REJECTED") u[`${PATH.withdrawals}/${wid}/rejectionReason`] = reason;

  let ledgerTx = null;
  if(to === "COMPLETED"){
    const user = await getOnce(`${PATH.users}/${w.uid}`);
    if(!user) throw new Error("User not found.");
    const wallets = { ...ZERO_WALLETS, ...(user.wallets || {}) };
    if(wallets.availableEarnings < w.amount){
      throw new Error("Insufficient available earnings at completion time.");
    }
    const newWallets = {
      ...wallets,
      availableEarnings: wallets.availableEarnings - w.amount,
      totalWithdrawn:    wallets.totalWithdrawn    + w.amount
    };
    u[`${PATH.users}/${w.uid}/wallets`] = newWallets;

    ledgerTx = push(ref(db, PATH.transactions)).key;
    u[`${PATH.transactions}/${ledgerTx}`] = {
      txId: ledgerTx, uid: w.uid, cycleId: user.currentCycleId || "",
      type: "WITHDRAWAL", amount: -w.amount, currency: "UGX",
      wallet: "availableEarnings",
      previousBalance: wallets.availableEarnings,
      newBalance: newWallets.availableEarnings,
      referenceId: wid, status: "COMPLETED",
      timestamp: now, actor: adminUid, note: "Withdrawal completed"
    };
  }

  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: `WITHDRAWAL_${to}`, target: wid,
    previousValue: w.status, newValue: to,
    note: reason || `UGX ${w.amount}`, timestamp: now
  };

  await update(ref(db), u);

  if(to === "COMPLETED"){
    await notifyUser(w.uid, {
      type: "WITHDRAWAL_COMPLETED",
      title: "Withdrawal completed",
      body: `UGX ${w.amount.toLocaleString()} has been processed.`
    });
  } else if(to === "REJECTED"){
    await notifyUser(w.uid, {
      type: "WITHDRAWAL_REJECTED",
      title: "Withdrawal rejected",
      body: reason || "Please contact support for details."
    });
  }
}

/**
 * Admin settles a cycle. Computes final position, closes the cycle,
 * optionally rolls remaining earnings into the user's available earnings.
 */
export async function settleCycle({ cycleId, adminUid }){
  const cycle = await getOnce(`${PATH.cycles}/${cycleId}`);
  if(!cycle) throw new Error("Cycle not found.");
  if(cycle.status !== "ACTIVE") throw new Error("Cycle is not active.");

  const user = await getOnce(`${PATH.users}/${cycle.uid}`);
  if(!user) throw new Error("User not found.");
  const wallets = { ...ZERO_WALLETS, ...(user.wallets || {}) };

  const settlement = calculateCycleSettlement(cycle, {});
  const now = Date.now();
  const logId = push(ref(db, PATH.auditLogs)).key;

  const u = {};
  u[`${PATH.cycles}/${cycleId}/status`] = "COMPLETED";
  u[`${PATH.cycles}/${cycleId}/settledAt`] = now;
  u[`${PATH.cycles}/${cycleId}/finalSettlement`] = settlement;
  u[`${PATH.users}/${cycle.uid}/currentCycleId`] = "";

  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: "CYCLE_SETTLED", target: cycleId,
    previousValue: "ACTIVE", newValue: "COMPLETED",
    note: `Final settlement UGX ${settlement.finalSettlement}`,
    timestamp: now
  };

  await update(ref(db), u);

  await notifyUser(cycle.uid, {
    type: "CYCLE_COMPLETED",
    title: "Cycle completed",
    body: `Your cycle closed. Reserve: UGX ${settlement.finalReserve.toLocaleString()}.`,
    meta: { cycleId, settlement }
  });

  return settlement;
}