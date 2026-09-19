// ============================================
// SURE — data access + atomic financial workflows
// ============================================
import {
  db, ref, get, set, update, push, query,
  orderByChild, equalTo, onValue
} from "./firebase.js";
import {
  calculateActiveAllocation,
  calculateProtectedReserve,
  calculateProfitDistribution,
  calculateReservePercent,
  calculateRiskLevel
} from "./calc.js";

export const PATH = {
  users:               "users",
  depositSubmissions:  "deposit_submissions",
  contributions:       "contributions",
  transactions:        "transactions",
  cycles:              "cycles",
  allocations:         "allocations",
  betRecords:          "bet_records",
  withdrawals:         "withdrawals",
  notifications:       "notifications",
  auditLogs:           "audit_logs",
  systemConfig:        "system_config",
  systemConfigHistory: "system_config_history",
  admins:              "admins",
  comments:            "comments"
};

const ZERO_WALLETS = {
  activeAllocation: 0,
  protectedReserve: 0,
  availableEarnings: 0,
  totalContribution: 0,
  totalWithdrawn: 0,
  totalEarningsGenerated: 0,
  companyShareContributed: 0
};

// ----------------------------------------------------------------
// READ HELPERS
// ----------------------------------------------------------------
export async function getOnce(path){
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
}
export function watch(path, cb){
  return onValue(ref(db, path), snap => cb(snap.exists() ? snap.val() : null));
}
export async function listAll(path){
  const data = await getOnce(path);
  if(!data) return [];
  return Object.entries(data).map(([id, v]) => ({ id, ...v }));
}
export async function listBy(path, field, value){
  const q = query(ref(db, path), orderByChild(field), equalTo(value));
  const snap = await get(q);
  if(!snap.exists()) return [];
  return Object.entries(snap.val()).map(([id, v]) => ({ id, ...v }));
}

// ----------------------------------------------------------------
// WRITE HELPERS
// ----------------------------------------------------------------
export async function pushItem(path, data){
  const r = push(ref(db, path));
  await set(r, { id: r.key, ...data });
  return r.key;
}
export async function updateItem(path, id, data){
  await update(ref(db, `${path}/${id}`), data);
}

/** Append to the immutable audit log. */
export async function logActivity({ adminId, action, target=null, prev=null, next=null, note="" }){
  return pushItem(PATH.auditLogs, {
    actor: adminId, actorRole: "admin", action, target,
    previousValue: prev, newValue: next, note,
    timestamp: Date.now()
  });
}

/** Fire-and-forget user notification. */
export async function notifyUser(uid, { type, title, body="", meta={} }){
  return pushItem(`${PATH.notifications}/${uid}`, {
    type, title, body, meta, read: false, createdAt: Date.now()
  });
}

/**
 * Compute the current risk state for a user's wallets.
 * Pure — no DB write. Used by the dashboard and after every settlement.
 */
export function deriveRiskState(wallets, config){
  const reservePct = calculateReservePercent(
    wallets.protectedReserve,
    wallets.activeAllocation
  );
  const level = calculateRiskLevel(reservePct, config);
  return {
    level,
    reservePercent: Math.round(reservePct * 10) / 10,
    lastEvaluatedAt: Date.now()
  };
}

// ================================================================
// ATOMIC WORKFLOW: APPROVE DEPOSIT
// Called by an admin from admin/deposits.html.
// Writes wallets, contribution, cycle, ledger, deposit status,
// and audit log — all in one atomic multi-path update.
// ================================================================
export async function approveDeposit({ deposit, adminUid, config }){
  // 1. Guard: only pending deposits
  const fresh = await getOnce(`${PATH.depositSubmissions}/${deposit.depositId}`);
  if(!fresh) throw new Error("Deposit not found.");
  if(fresh.status !== "PENDING") throw new Error("Deposit has already been reviewed.");

  // 2. Read the current user record
  const user = await getOnce(`${PATH.users}/${deposit.uid}`);
  if(!user) throw new Error("User record not found.");
  if(user.status === "suspended") throw new Error("User account is suspended.");

  const wallets = { ...ZERO_WALLETS, ...(user.wallets || {}) };

  // 3. Compute the split
  const allocation = calculateActiveAllocation(deposit.amount, config);
  const reserve    = calculateProtectedReserve(deposit.amount, config);

  const newWallets = {
    ...wallets,
    activeAllocation:   wallets.activeAllocation   + allocation,
    protectedReserve:   wallets.protectedReserve   + reserve,
    totalContribution:  wallets.totalContribution  + deposit.amount
  };

  const riskState = deriveRiskState(newWallets, config);

  // 4. Build IDs
  const now = Date.now();
  const contributionId = push(ref(db, PATH.contributions)).key;
  const cycleId        = push(ref(db, PATH.cycles)).key;
  const txContrib      = push(ref(db, PATH.transactions)).key;
  const txAllocation   = push(ref(db, PATH.transactions)).key;
  const txReserve      = push(ref(db, PATH.transactions)).key;
  const logId          = push(ref(db, PATH.auditLogs)).key;

  // 5. Compose one atomic update
  const u = {};
  u[`${PATH.users}/${deposit.uid}/wallets`] = newWallets;
  u[`${PATH.users}/${deposit.uid}/riskState`] = riskState;
  u[`${PATH.users}/${deposit.uid}/currentCycleId`] = cycleId;

  u[`${PATH.contributions}/${contributionId}`] = {
    contributionId,
    uid: deposit.uid,
    cycleId,
    amount: deposit.amount,
    depositId: deposit.depositId,
    activeAllocation: allocation,
    protectedReserve: reserve,
    configVersion: config.version,
    status: "ACTIVE",
    createdAt: now,
    approvedBy: adminUid,
    approvedAt: now
  };

  u[`${PATH.cycles}/${cycleId}`] = {
    cycleId,
    uid: deposit.uid,
    configVersion: config.version,
    startingContribution: deposit.amount,
    startingReserve: newWallets.protectedReserve,
    startDate: now,
    endDate: now + config.cycleDays * 86400000,
    currentReserve: newWallets.protectedReserve,
    availableEarnings: newWallets.availableEarnings,
    totalActiveAllocations: 0,
    totalWins: 0,
    totalLosses: 0,
    totalCompanyShare: 0,
    totalWithdrawals: 0,
    maxDrawdown: 0,
    winsCount: 0,
    lossesCount: 0,
    status: "ACTIVE",
    settledAt: null
  };

  const base = { uid: deposit.uid, cycleId, currency: "UGX",
                 status: "COMPLETED", timestamp: now, actor: adminUid };

  u[`${PATH.transactions}/${txContrib}`] = {
    ...base, txId: txContrib, type: "CONTRIBUTION",
    amount: deposit.amount, wallet: "totalContribution",
    previousBalance: wallets.totalContribution,
    newBalance: newWallets.totalContribution,
    referenceId: deposit.depositId,
    note: "Contribution approved"
  };
  u[`${PATH.transactions}/${txAllocation}`] = {
    ...base, txId: txAllocation, type: "ACTIVE_ALLOCATION",
    amount: allocation, wallet: "activeAllocation",
    previousBalance: wallets.activeAllocation,
    newBalance: newWallets.activeAllocation,
    referenceId: contributionId,
    note: "Active allocation credit"
  };
  u[`${PATH.transactions}/${txReserve}`] = {
    ...base, txId: txReserve, type: "RESERVE_ADDITION",
    amount: reserve, wallet: "protectedReserve",
    previousBalance: wallets.protectedReserve,
    newBalance: newWallets.protectedReserve,
    referenceId: contributionId,
    note: "Protected reserve credit"
  };

  u[`${PATH.depositSubmissions}/${deposit.depositId}/status`] = "APPROVED";
  u[`${PATH.depositSubmissions}/${deposit.depositId}/reviewedAt`] = now;
  u[`${PATH.depositSubmissions}/${deposit.depositId}/reviewedBy`] = adminUid;
  u[`${PATH.depositSubmissions}/${deposit.depositId}/relatedContributionId`] = contributionId;
  u[`${PATH.depositSubmissions}/${deposit.depositId}/relatedTransactionIds`] =
    [txContrib, txAllocation, txReserve];

  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: "APPROVE_DEPOSIT",
    target: deposit.depositId,
    previousValue: "PENDING", newValue: "APPROVED",
    note: `UGX ${deposit.amount} for ${deposit.userEmail || deposit.uid}`,
    timestamp: now
  };

  await update(ref(db), u);

  await notifyUser(deposit.uid, {
    type: "DEPOSIT_APPROVED",
    title: "Contribution received",
    body: `Your contribution of UGX ${deposit.amount.toLocaleString()} has been approved.`,
    meta: { contributionId, cycleId }
  });

  return { contributionId, cycleId, txIds: [txContrib, txAllocation, txReserve] };
}

// ================================================================
// ATOMIC WORKFLOW: REJECT DEPOSIT
// ================================================================
export async function rejectDeposit({ deposit, adminUid, reason }){
  const fresh = await getOnce(`${PATH.depositSubmissions}/${deposit.depositId}`);
  if(!fresh || fresh.status !== "PENDING") throw new Error("Already reviewed.");
  const now = Date.now();
  const logId = push(ref(db, PATH.auditLogs)).key;
  const u = {};
  u[`${PATH.depositSubmissions}/${deposit.depositId}/status`] = "REJECTED";
  u[`${PATH.depositSubmissions}/${deposit.depositId}/reviewedAt`] = now;
  u[`${PATH.depositSubmissions}/${deposit.depositId}/reviewedBy`] = adminUid;
  u[`${PATH.depositSubmissions}/${deposit.depositId}/rejectionReason`] = reason || "";
  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: "REJECT_DEPOSIT", target: deposit.depositId,
    previousValue: "PENDING", newValue: "REJECTED",
    note: reason || "", timestamp: now
  };
  await update(ref(db), u);
  await notifyUser(deposit.uid, {
    type: "DEPOSIT_REJECTED",
    title: "Contribution rejected",
    body: reason ? `Reason: ${reason}` : "Your deposit could not be verified."
  });
}

// ================================================================
// ATOMIC WORKFLOW: COMPLETE WITHDRAWAL
// Debits availableEarnings only when admin marks COMPLETED.
// ================================================================
export async function completeWithdrawal({ withdrawal, adminUid, config }){
  const fresh = await getOnce(`${PATH.withdrawals}/${withdrawal.wid}`);
  if(!fresh) throw new Error("Withdrawal not found.");
  if(fresh.status === "COMPLETED") throw new Error("Already completed.");
  if(fresh.status === "REJECTED")  throw new Error("Cannot complete a rejected withdrawal.");

  const user = await getOnce(`${PATH.users}/${withdrawal.uid}`);
  if(!user) throw new Error("User record not found.");

  const wallets = { ...ZERO_WALLETS, ...(user.wallets || {}) };
  if(wallets.availableEarnings < withdrawal.amount){
    throw new Error("Insufficient available earnings.");
  }

  const newWallets = {
    ...wallets,
    availableEarnings: wallets.availableEarnings - withdrawal.amount,
    totalWithdrawn:    wallets.totalWithdrawn    + withdrawal.amount
  };

  const now = Date.now();
  const txId  = push(ref(db, PATH.transactions)).key;
  const logId = push(ref(db, PATH.auditLogs)).key;

  const u = {};
  u[`${PATH.users}/${withdrawal.uid}/wallets`] = newWallets;
  u[`${PATH.withdrawals}/${withdrawal.wid}/status`] = "COMPLETED";
  u[`${PATH.withdrawals}/${withdrawal.wid}/processedBy`] = adminUid;
  u[`${PATH.withdrawals}/${withdrawal.wid}/processedAt`] = now;
  u[`${PATH.transactions}/${txId}`] = {
    txId, uid: withdrawal.uid, cycleId: user.currentCycleId || "",
    type: "WITHDRAWAL", amount: -withdrawal.amount, currency: "UGX",
    wallet: "availableEarnings",
    previousBalance: wallets.availableEarnings,
    newBalance: newWallets.availableEarnings,
    referenceId: withdrawal.wid, status: "COMPLETED",
    timestamp: now, actor: adminUid, note: "Withdrawal completed"
  };
  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: "WITHDRAWAL_COMPLETED", target: withdrawal.wid,
    previousValue: fresh.status, newValue: "COMPLETED",
    note: `UGX ${withdrawal.amount}`, timestamp: now
  };
  await update(ref(db), u);

  await notifyUser(withdrawal.uid, {
    type: "WITHDRAWAL_COMPLETED",
    title: "Withdrawal completed",
    body: `UGX ${withdrawal.amount.toLocaleString()} has been processed.`
  });
}

// ================================================================
// ATOMIC WORKFLOW: RECORD BET OUTCOME (WIN)
// Called by admin after a bet closes. Distributes profit across
// the three wallets and updates the cycle totals.
// ================================================================
export async function recordBetWin({ uid, cycleId, stake, odds, adminUid, config, betId }){
  const user = await getOnce(`${PATH.users}/${uid}`);
  if(!user) throw new Error("User not found.");
  const wallets = { ...ZERO_WALLETS, ...(user.wallets || {}) };
  if(wallets.activeAllocation < stake) throw new Error("Insufficient allocation.");

  const grossReturn = Math.round(stake * odds);
  const grossProfit = grossReturn - stake;
  const dist = calculateProfitDistribution(grossProfit, config);

  // Stake returns to allocation; profit splits 3 ways.
  // On win: stake returns -> activeAllocation stays same (stake was consumed,
  // then returns). For simplicity, we consume the stake then add back
  // return, which nets out to +grossProfit spread across destinations.
  const newWallets = {
    ...wallets,
    // Active allocation decreases by stake (stake was used)
    activeAllocation: wallets.activeAllocation - stake,
    // Available earnings gets the user's profit share
    availableEarnings: wallets.availableEarnings + dist.availableEarnings,
    // Reserve gets the reserve-addition share
    protectedReserve: wallets.protectedReserve + dist.reserveAddition,
    // Company share is tracked separately (not user money)
    companyShareContributed: wallets.companyShareContributed + dist.companyShare,
    totalEarningsGenerated: wallets.totalEarningsGenerated + dist.availableEarnings
  };

  const riskState = deriveRiskState(newWallets, config);

  const now = Date.now();
  const txWin  = push(ref(db, PATH.transactions)).key;
  const txDist = push(ref(db, PATH.transactions)).key;
  const txRes  = push(ref(db, PATH.transactions)).key;
  const txCo   = push(ref(db, PATH.transactions)).key;
  const logId  = push(ref(db, PATH.auditLogs)).key;

  const base = { uid, cycleId, currency: "UGX", status: "COMPLETED",
                 timestamp: now, actor: adminUid, referenceId: betId };

  const u = {};
  u[`${PATH.users}/${uid}/wallets`] = newWallets;
  u[`${PATH.users}/${uid}/riskState`] = riskState;

  u[`${PATH.transactions}/${txWin}`] = {
    ...base, txId: txWin, type: "BET_WIN",
    amount: stake, wallet: "activeAllocation",
    previousBalance: wallets.activeAllocation,
    newBalance: wallets.activeAllocation - stake,
    note: `Stake consumed on win @ ${odds}`
  };
  u[`${PATH.transactions}/${txDist}`] = {
    ...base, txId: txDist, type: "PROFIT_DISTRIBUTION",
    amount: dist.availableEarnings, wallet: "availableEarnings",
    previousBalance: wallets.availableEarnings,
    newBalance: newWallets.availableEarnings,
    note: "Available earnings credit"
  };
  u[`${PATH.transactions}/${txRes}`] = {
    ...base, txId: txRes, type: "RESERVE_ADDITION",
    amount: dist.reserveAddition, wallet: "protectedReserve",
    previousBalance: wallets.protectedReserve,
    newBalance: newWallets.protectedReserve,
    note: "Reserve credit from profit"
  };
  u[`${PATH.transactions}/${txCo}`] = {
    ...base, txId: txCo, type: "COMPANY_SHARE",
    amount: dist.companyShare, wallet: "companyShare",
    previousBalance: wallets.companyShareContributed,
    newBalance: newWallets.companyShareContributed,
    note: "Company share recorded"
  };

  // Cycle totals
  u[`${PATH.cycles}/${cycleId}/currentReserve`] = newWallets.protectedReserve;
  u[`${PATH.cycles}/${cycleId}/availableEarnings`] = newWallets.availableEarnings;
  u[`${PATH.cycles}/${cycleId}/totalWins`] = (user.wallets?.totalWins || 0) + grossProfit;
  u[`${PATH.cycles}/${cycleId}/winsCount`] = (user.wallets?.winsCount || 0) + 1;
  u[`${PATH.cycles}/${cycleId}/totalCompanyShare`] = (user.wallets?.totalCompanyShare || 0) + dist.companyShare;

  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: "BET_WIN", target: betId,
    previousValue: null, newValue: { stake, odds, grossProfit, distribution: dist },
    note: `Won @ ${odds}`, timestamp: now
  };

  await update(ref(db), u);
  await notifyUser(uid, {
    type: "PROFIT_CREDITED",
    title: "Bet won",
    body: `Profit of UGX ${grossProfit.toLocaleString()} distributed.`
  });
}

// ================================================================
// ATOMIC WORKFLOW: RECORD BET OUTCOME (LOSS)
// ================================================================
export async function recordBetLoss({ uid, cycleId, stake, odds, adminUid, config, betId }){
  const user = await getOnce(`${PATH.users}/${uid}`);
  if(!user) throw new Error("User not found.");
  const wallets = { ...ZERO_WALLETS, ...(user.wallets || {}) };
  if(wallets.activeAllocation < stake) throw new Error("Insufficient allocation.");

  const newWallets = {
    ...wallets,
    activeAllocation: wallets.activeAllocation - stake
  };
  const riskState = deriveRiskState(newWallets, config);

  const now = Date.now();
  const txId  = push(ref(db, PATH.transactions)).key;
  const logId = push(ref(db, PATH.auditLogs)).key;

  const u = {};
  u[`${PATH.users}/${uid}/wallets`] = newWallets;
  u[`${PATH.users}/${uid}/riskState`] = riskState;
  u[`${PATH.transactions}/${txId}`] = {
    txId, uid, cycleId, type: "BET_LOSS",
    amount: -stake, currency: "UGX", wallet: "activeAllocation",
    previousBalance: wallets.activeAllocation,
    newBalance: newWallets.activeAllocation,
    referenceId: betId, status: "COMPLETED",
    timestamp: now, actor: adminUid, note: `Lost @ ${odds}`
  };
  u[`${PATH.cycles}/${cycleId}/totalLosses`] = (user.wallets?.totalLosses || 0) + stake;
  u[`${PATH.cycles}/${cycleId}/lossesCount`] = (user.wallets?.lossesCount || 0) + 1;
  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: "BET_LOSS", target: betId,
    previousValue: null, newValue: { stake, odds },
    note: `Lost @ ${odds}`, timestamp: Date.now()
  };
  await update(ref(db), u);
  await notifyUser(uid, {
    type: "LOSS_RECORDED",
    title: "Bet result recorded",
    body: `A stake of UGX ${stake.toLocaleString()} was lost.`
  });
}

// ================================================================
// ATOMIC WORKFLOW: UPDATE SYSTEM CONFIG (versioned)
// ================================================================
export async function updateSystemConfig({ nextConfig, adminUid, reason="" }){
  const prev = (await getOnce(PATH.systemConfig)) || {};
  const version = (prev.version || 0) + 1;
  const now = Date.now();
  const next = { ...prev, ...nextConfig, version, updatedAt: now, updatedBy: adminUid };
  const histId = push(ref(db, PATH.systemConfigHistory)).key;
  const logId  = push(ref(db, PATH.auditLogs)).key;

  const u = {};
  u[PATH.systemConfig] = next;
  u[`${PATH.systemConfigHistory}/${histId}`] = {
    changedAt: now, changedBy: adminUid, previous: prev, next, reason
  };
  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: "SYSTEM_CONFIG_UPDATE", target: "system_config",
    previousValue: prev, newValue: next, note: reason, timestamp: now
  };
  await update(ref(db), u);
  return next;
}

// ================================================================
// POOL STATS (public, read-only)
// ================================================================
export async function computePoolStats(){
  const [users, txs, bets] = await Promise.all([
    listAll(PATH.users),
    listAll(PATH.transactions),
    listAll(PATH.betRecords)
  ]);
  let totalContrib = 0, totalReserve = 0, totalAvailable = 0;
  let totalDistributed = 0, totalWithdrawn = 0, totalCompany = 0;
  users.forEach(u => {
    const w = u.wallets || {};
    totalContrib      += w.totalContribution   || 0;
    totalReserve      += w.protectedReserve    || 0;
    totalAvailable    += w.availableEarnings   || 0;
    totalDistributed  += w.totalEarningsGenerated || 0;
    totalWithdrawn    += w.totalWithdrawn      || 0;
    totalCompany      += w.companyShareContributed || 0;
  });
  const committed = users.reduce((s,u) => s + ((u.wallets||{}).activeAllocation || 0), 0);
  return {
    totalContrib, totalReserve, totalAvailable, totalDistributed,
    totalWithdrawn, totalCompany, committed,
    activeBets: bets.filter(b => b.status === "pending").length,
    completedBets: bets.filter(b => b.status === "completed").length,
    txCount: txs.length
  };
}