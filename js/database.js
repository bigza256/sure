// ============================================
// SURE — data access + atomic financial workflows
// Every balance-changing operation writes a matching ledger row.
//
// Search for "ISSUE" / "FIX" comments for review notes.
// ============================================

import {
  db, ref, get, set, update, push, query,
  orderByChild, equalTo, onValue
} from "./firebase.js";

// FIX: namespace import so we can OPTIONALLY use `auth` without breaking
// the module if firebase.js doesn't export it.
import * as FB from "./firebase.js";

import {
  calculateActiveAllocation,
  calculateProtectedReserve,
  calculateProfitDistribution,
  calculateReservePercent,
  calculateRiskLevel
} from "./calc.js";


// ================================================================
// PATHS
// ================================================================
export const PATH = {
  users: "users",
  depositSubmissions: "deposit_submissions",
  contributions: "contributions",
  transactions: "transactions",
  cycles: "cycles",
  allocations: "allocations",
  betRecords: "bet_records",
  withdrawals: "withdrawals",
  notifications: "notifications",
  auditLogs: "audit_logs",
  systemConfig: "system_config",
  systemConfigHistory: "system_config_history",
  admins: "admins",
  comments: "comments"
};

export const ZERO_WALLETS = {
  activeAllocation: 0,
  protectedReserve: 0,
  availableEarnings: 0,
  totalContribution: 0,
  totalWithdrawn: 0,
  totalEarningsGenerated: 0,
  companyShareContributed: 0
};


// ================================================================
// SMALL INTERNAL HELPERS
// ================================================================
const newKey = path => push(ref(db, path)).key;

// Firebase throws on `undefined` values anywhere in a payload.
function stripUndefined(v){
  if(Array.isArray(v)) return v.map(stripUndefined);
  if(v && typeof v === "object"){
    const out = {};
    for(const [k, val] of Object.entries(v)){
      if(val !== undefined) out[k] = stripUndefined(val);
    }
    return out;
  }
  return v;
}

// FIX: notification failure must never make a completed money move look failed.
async function safeNotify(uid, payload){
  try{ await notifyUser(uid, payload); }
  catch(e){ console.warn("Notification failed (non-fatal):", e?.message || e); }
}

function assertPositiveInt(n, label){
  if(!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)){
    throw new Error(`${label} must be a positive whole number (UGX).`);
  }
}


// ================================================================
// ADMIN CHECK — reads /admins/{uid}
// ================================================================
export async function isAdmin(uid){
  if(!uid) return false;
  try{
    const snap = await get(ref(db, `${PATH.admins}/${uid}`));
    return snap.exists() && snap.val() === true;
  }catch(e){
    // FIX: don't silently hide rule/network errors — they look like "not admin".
    console.warn("isAdmin read failed:", e?.code || e?.message || e);
    return false;
  }
}


// ================================================================
// READ HELPERS
// ================================================================
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

// ISSUE: needs ".indexOn": ["<field>"] on this path in your rules,
// otherwise Firebase downloads everything and logs an indexOn warning.
export async function listBy(path, field, value){
  const q = query(ref(db, path), orderByChild(field), equalTo(value));
  const snap = await get(q);
  if(!snap.exists()) return [];
  return Object.entries(snap.val()).map(([id, v]) => ({ id, ...v }));
}


// ================================================================
// WRITE HELPERS
// ================================================================
export async function pushItem(path, data){
  const r = push(ref(db, path));
  await set(r, { id: r.key, ...data });
  return r.key;
}

export async function updateItem(path, id, data){
  await update(ref(db, `${path}/${id}`), data);
}


// ================================================================
// AUDIT LOG
// ================================================================
export async function logActivity({
  adminId, action, target = null, prev = null, next = null, note = ""
}){
  // FIX: other audit writers include `logId`; your rules likely require it.
  const logId = newKey(PATH.auditLogs);
  await set(ref(db, `${PATH.auditLogs}/${logId}`), {
    logId,
    actor: adminId,
    actorRole: "admin",
    action,
    target,
    previousValue: prev,
    newValue: next,
    note,
    timestamp: Date.now()
  });
  return logId;
}


// ================================================================
// USER NOTIFICATION
// ISSUE: admin writes into /notifications/{otherUid}; rules must allow it.
// ================================================================
export async function notifyUser(uid, { type, title, body = "", meta = {} }){
  return pushItem(`${PATH.notifications}/${uid}`, {
    type, title, body, meta, read: false, createdAt: Date.now()
  });
}


// ================================================================
// DERIVED RISK STATE
// ================================================================
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
// DEPOSIT SUBMISSION
// depositId must equal the record key (security rule).
// ================================================================
export async function createDepositSubmission(data){
  const newRef = push(ref(db, PATH.depositSubmissions));
  const depositId = newRef.key;

  await set(newRef, {
    depositId,
    ...data,
    relatedContributionId: null,
    relatedTransactionIds: [],
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: ""
  });
  return depositId;
}


// ================================================================
// ATOMIC WORKFLOW: APPROVE DEPOSIT
// ================================================================
export async function approveDeposit({ deposit, adminUid, config }){

  const fresh = await getOnce(`${PATH.depositSubmissions}/${deposit.depositId}`);
  if(!fresh) throw new Error("Deposit not found.");
  if(fresh.status !== "PENDING") throw new Error("Deposit has already been reviewed.");

  // FIX: trust the database record, never the object passed from the UI.
  const uid = fresh.uid;
  const amount = fresh.amount;
  assertPositiveInt(amount, "Deposit amount");

  const user = await getOnce(`${PATH.users}/${uid}`);
  if(!user) throw new Error("User record not found.");
  if(user.status === "suspended") throw new Error("User account is suspended.");

  const wallets = { ...ZERO_WALLETS, ...(user.wallets || {}) };

  const allocation = calculateActiveAllocation(amount, config);
  const reserve = calculateProtectedReserve(amount, config);
  if(allocation + reserve !== amount){
    console.warn(`Allocation+reserve (${allocation + reserve}) != amount (${amount})`);
  }

  const newWallets = {
    ...wallets,
    activeAllocation: wallets.activeAllocation + allocation,
    protectedReserve: wallets.protectedReserve + reserve,
    totalContribution: wallets.totalContribution + amount
  };

  const riskState = deriveRiskState(newWallets, config);
  const now = Date.now();

  const contributionId = newKey(PATH.contributions);
  const cycleId = newKey(PATH.cycles);
  const txContrib = newKey(PATH.transactions);
  const txAllocation = newKey(PATH.transactions);
  const txReserve = newKey(PATH.transactions);
  const logId = newKey(PATH.auditLogs);

  const dPath = `${PATH.depositSubmissions}/${deposit.depositId}`;
  const u = {};

  u[`${PATH.users}/${uid}/wallets`] = newWallets;
  u[`${PATH.users}/${uid}/riskState`] = riskState;
  u[`${PATH.users}/${uid}/currentCycleId`] = cycleId;

  u[`${PATH.contributions}/${contributionId}`] = {
    contributionId, uid, cycleId, amount,
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
    cycleId, uid,
    configVersion: config.version,
    startingContribution: amount,
    startingReserve: newWallets.protectedReserve,
    startDate: now,
    endDate: now + (config.cycleDays || 30) * 86400000,
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

  const base = {
    uid, cycleId,
    currency: "UGX",
    status: "COMPLETED",
    timestamp: now,
    actor: adminUid
  };

  u[`${PATH.transactions}/${txContrib}`] = {
    ...base, txId: txContrib, type: "CONTRIBUTION", amount,
    wallet: "totalContribution",
    previousBalance: wallets.totalContribution,
    newBalance: newWallets.totalContribution,
    referenceId: deposit.depositId,
    note: "Contribution approved"
  };

  u[`${PATH.transactions}/${txAllocation}`] = {
    ...base, txId: txAllocation, type: "ACTIVE_ALLOCATION", amount: allocation,
    wallet: "activeAllocation",
    previousBalance: wallets.activeAllocation,
    newBalance: newWallets.activeAllocation,
    referenceId: contributionId,
    note: "Active allocation credit"
  };

  u[`${PATH.transactions}/${txReserve}`] = {
    ...base, txId: txReserve, type: "RESERVE_ADDITION", amount: reserve,
    wallet: "protectedReserve",
    previousBalance: wallets.protectedReserve,
    newBalance: newWallets.protectedReserve,
    referenceId: contributionId,
    note: "Protected reserve credit"
  };

  u[`${dPath}/status`] = "APPROVED";
  u[`${dPath}/reviewedAt`] = now;
  u[`${dPath}/reviewedBy`] = adminUid;
  u[`${dPath}/relatedContributionId`] = contributionId;
  u[`${dPath}/relatedTransactionIds`] = [txContrib, txAllocation, txReserve];

  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: "APPROVE_DEPOSIT",
    target: deposit.depositId,
    previousValue: "PENDING",
    newValue: "APPROVED",
    note: `UGX ${amount} for ${fresh.userEmail || uid}`,
    timestamp: now
  };

  await update(ref(db), stripUndefined(u));

  await safeNotify(uid, {
    type: "DEPOSIT_APPROVED",
    title: "Contribution received",
    body: `Your contribution of UGX ${amount.toLocaleString()} has been approved.`,
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
  const logId = newKey(PATH.auditLogs);
  const dPath = `${PATH.depositSubmissions}/${deposit.depositId}`;

  const u = {};
  u[`${dPath}/status`] = "REJECTED";
  u[`${dPath}/reviewedAt`] = now;
  u[`${dPath}/reviewedBy`] = adminUid;
  u[`${dPath}/rejectionReason`] = reason || "";
  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: "REJECT_DEPOSIT",
    target: deposit.depositId,
    previousValue: "PENDING",
    newValue: "REJECTED",
    note: reason || "",
    timestamp: now
  };

  await update(ref(db), u);

  // FIX: use fresh.uid, not the client-supplied deposit.uid
  await safeNotify(fresh.uid, {
    type: "DEPOSIT_REJECTED",
    title: "Contribution rejected",
    body: reason ? `Reason: ${reason}` : "Your deposit could not be verified."
  });
}


// ================================================================
// ATOMIC WORKFLOW: BET WIN
// ================================================================
export async function recordBetWin({ uid, cycleId, stake, odds, adminUid, config, betId }){

  assertPositiveInt(stake, "Stake");
  if(!(odds > 1)) throw new Error("Odds must be greater than 1 for a win.");

  const user = await getOnce(`${PATH.users}/${uid}`);
  if(!user) throw new Error("User not found.");

  const wallets = { ...ZERO_WALLETS, ...(user.wallets || {}) };
  if(wallets.activeAllocation < stake) throw new Error("Insufficient allocation.");

  const grossReturn = Math.round(stake * odds);
  const grossProfit = grossReturn - stake;
  const dist = calculateProfitDistribution(grossProfit, config);

  const distSum = dist.availableEarnings + dist.reserveAddition + dist.companyShare;
  if(distSum !== grossProfit){
    console.warn(`Profit split (${distSum}) != grossProfit (${grossProfit})`);
  }

  const newWallets = {
    ...wallets,
    availableEarnings: wallets.availableEarnings + dist.availableEarnings,
    protectedReserve: wallets.protectedReserve + dist.reserveAddition,
    companyShareContributed: wallets.companyShareContributed + dist.companyShare,
    totalEarningsGenerated: wallets.totalEarningsGenerated + dist.availableEarnings
  };

  const riskState = deriveRiskState(newWallets, config);
  const cycle = (await getOnce(`${PATH.cycles}/${cycleId}`)) || {};
  const now = Date.now();

  const txStake = newKey(PATH.transactions);
  const txReturn = newKey(PATH.transactions);
  const txEarn = newKey(PATH.transactions);
  const txRes = newKey(PATH.transactions);
  const txCo = newKey(PATH.transactions);
  const logId = newKey(PATH.auditLogs);

  const base = {
    uid, cycleId,
    currency: "UGX",
    status: "COMPLETED",
    timestamp: now,
    actor: adminUid,
    referenceId: betId
  };

  const u = {};
  u[`${PATH.users}/${uid}/wallets`] = newWallets;
  u[`${PATH.users}/${uid}/riskState`] = riskState;

  u[`${PATH.transactions}/${txStake}`] = {
    ...base, txId: txStake, type: "BET_STAKE", amount: -stake,
    wallet: "activeAllocation",
    previousBalance: wallets.activeAllocation,
    newBalance: wallets.activeAllocation - stake,
    note: `Stake committed @ ${odds}`
  };

  u[`${PATH.transactions}/${txReturn}`] = {
    ...base, txId: txReturn, type: "STAKE_RETURN", amount: stake,
    wallet: "activeAllocation",
    previousBalance: wallets.activeAllocation - stake,
    newBalance: wallets.activeAllocation,
    note: `Stake returned @ ${odds}`
  };

  u[`${PATH.transactions}/${txEarn}`] = {
    ...base, txId: txEarn, type: "PROFIT_DISTRIBUTION",
    amount: dist.availableEarnings,
    wallet: "availableEarnings",
    previousBalance: wallets.availableEarnings,
    newBalance: newWallets.availableEarnings,
    note: "Available earnings credit"
  };

  u[`${PATH.transactions}/${txRes}`] = {
    ...base, txId: txRes, type: "RESERVE_ADDITION",
    amount: dist.reserveAddition,
    wallet: "protectedReserve",
    previousBalance: wallets.protectedReserve,
    newBalance: newWallets.protectedReserve,
    note: "Reserve credit from profit"
  };

  u[`${PATH.transactions}/${txCo}`] = {
    ...base, txId: txCo, type: "COMPANY_SHARE",
    amount: dist.companyShare,
    wallet: "companyShare",
    previousBalance: wallets.companyShareContributed,
    newBalance: newWallets.companyShareContributed,
    note: "Company share recorded"
  };

  u[`${PATH.cycles}/${cycleId}/currentReserve`] = newWallets.protectedReserve;
  u[`${PATH.cycles}/${cycleId}/availableEarnings`] = newWallets.availableEarnings;
  u[`${PATH.cycles}/${cycleId}/totalWins`] = (cycle.totalWins || 0) + grossProfit;
  u[`${PATH.cycles}/${cycleId}/winsCount`] = (cycle.winsCount || 0) + 1;
  u[`${PATH.cycles}/${cycleId}/totalCompanyShare`] = (cycle.totalCompanyShare || 0) + dist.companyShare;

  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: "BET_WIN",
    target: betId ?? null,
    previousValue: null,
    newValue: { stake, odds, grossProfit, distribution: dist },
    note: `Won @ ${odds}`,
    timestamp: now
  };

  await update(ref(db), stripUndefined(u));

  await safeNotify(uid, {
    type: "PROFIT_CREDITED",
    title: "Bet won",
    body: `Profit of UGX ${grossProfit.toLocaleString()} distributed.`
  });
}


// ================================================================
// ATOMIC WORKFLOW: BET LOSS
// ================================================================
export async function recordBetLoss({ uid, cycleId, stake, odds, adminUid, config, betId }){

  assertPositiveInt(stake, "Stake");

  const user = await getOnce(`${PATH.users}/${uid}`);
  if(!user) throw new Error("User not found.");

  const wallets = { ...ZERO_WALLETS, ...(user.wallets || {}) };
  if(wallets.activeAllocation < stake) throw new Error("Insufficient allocation.");

  const newWallets = { ...wallets, activeAllocation: wallets.activeAllocation - stake };
  const riskState = deriveRiskState(newWallets, config);
  const cycle = (await getOnce(`${PATH.cycles}/${cycleId}`)) || {};
  const now = Date.now();

  const txId = newKey(PATH.transactions);
  const logId = newKey(PATH.auditLogs);

  const u = {};
  u[`${PATH.users}/${uid}/wallets`] = newWallets;
  u[`${PATH.users}/${uid}/riskState`] = riskState;

  u[`${PATH.transactions}/${txId}`] = {
    txId, uid, cycleId,
    type: "BET_LOSS",
    amount: -stake,
    currency: "UGX",
    wallet: "activeAllocation",
    previousBalance: wallets.activeAllocation,
    newBalance: newWallets.activeAllocation,
    referenceId: betId ?? null,
    status: "COMPLETED",
    timestamp: now,
    actor: adminUid,
    note: `Lost @ ${odds}`
  };

  u[`${PATH.cycles}/${cycleId}/totalLosses`] = (cycle.totalLosses || 0) + stake;
  u[`${PATH.cycles}/${cycleId}/lossesCount`] = (cycle.lossesCount || 0) + 1;

  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: "BET_LOSS",
    target: betId ?? null,
    previousValue: null,
    newValue: { stake, odds },
    note: `Lost @ ${odds}`,
    timestamp: now
  };

  await update(ref(db), stripUndefined(u));

  await safeNotify(uid, {
    type: "LOSS_RECORDED",
    title: "Bet result recorded",
    body: `A stake of UGX ${stake.toLocaleString()} was lost.`
  });
}


// ================================================================
// ATOMIC WORKFLOW: COMPLETE WITHDRAWAL
// ================================================================
export async function completeWithdrawal({ withdrawal, adminUid }){

  const wPath = `${PATH.withdrawals}/${withdrawal.wid}`;
  const fresh = await getOnce(wPath);
  if(!fresh) throw new Error("Withdrawal not found.");

  // FIX: whitelist payable statuses.
  const PAYABLE = ["PENDING", "APPROVED"];
  if(!PAYABLE.includes(fresh.status)){
    throw new Error(`Cannot complete a withdrawal that is ${fresh.status}.`);
  }

  const uid = fresh.uid;
  const amount = fresh.amount;
  assertPositiveInt(amount, "Withdrawal amount");

  const user = await getOnce(`${PATH.users}/${uid}`);
  if(!user) throw new Error("User record not found.");

  const wallets = { ...ZERO_WALLETS, ...(user.wallets || {}) };
  if(wallets.availableEarnings < amount) throw new Error("Insufficient available earnings.");

  const newWallets = {
    ...wallets,
    availableEarnings: wallets.availableEarnings - amount,
    totalWithdrawn: wallets.totalWithdrawn + amount
  };

  const now = Date.now();
  const txId = newKey(PATH.transactions);
  const logId = newKey(PATH.auditLogs);

  const u = {};
  u[`${PATH.users}/${uid}/wallets`] = newWallets;
  u[`${wPath}/status`] = "COMPLETED";
  u[`${wPath}/processedBy`] = adminUid;
  u[`${wPath}/processedAt`] = now;

  u[`${PATH.transactions}/${txId}`] = {
    txId, uid,
    cycleId: user.currentCycleId || "",
    type: "WITHDRAWAL",
    amount: -amount,
    currency: "UGX",
    wallet: "availableEarnings",
    previousBalance: wallets.availableEarnings,
    newBalance: newWallets.availableEarnings,
    referenceId: withdrawal.wid,
    status: "COMPLETED",
    timestamp: now,
    actor: adminUid,
    note: "Withdrawal completed"
  };

  u[`${PATH.auditLogs}/${logId}`] = {
    logId, actor: adminUid, actorRole: "admin",
    action: "WITHDRAWAL_COMPLETED",
    target: withdrawal.wid,
    previousValue: fresh.status,
    newValue: "COMPLETED",
    note: `UGX ${amount}`,
    timestamp: now
  };

  await update(ref(db), u);

  await safeNotify(uid, {
    type: "WITHDRAWAL_COMPLETED",
    title: "Withdrawal completed",
    body: `UGX ${amount.toLocaleString()} has been processed.`
  });
}


// ================================================================
// UPDATE SYSTEM CONFIG  (FIXED)
//
// ★ The previous version wrote each changed key as a separate child
//   path (u["system_config/version"] = 2, etc.). Firebase Realtime
//   Database evaluates the parent ".validate" on /system_config
//   against the merged state, and child writes can trip it when the
//   child has no explicit ".validate" of its own (e.g. updatedAt,
//   updatedBy, minContribution, maxContribution).
//
//   The version that WORKED before wrote the whole node:
//     u["system_config"] = next;
//
//   That is what this version does too — full node, single atomic
//   update, alongside the history and audit writes.
// ================================================================
export async function updateSystemConfig({ nextConfig, adminUid, reason = "" }){

  const authUid = FB.auth?.currentUser?.uid || null;
  const uid = authUid || adminUid;

  if(!uid) throw new Error("Admin UID is required.");

  if(authUid && adminUid && authUid !== adminUid){
    throw new Error(
      `Admin UID mismatch: signed in as ${authUid} but adminUid=${adminUid}. ` +
      `Security rules use the signed-in user.`
    );
  }
  if(!authUid){
    console.warn("firebase.js does not export `auth`; cannot verify adminUid matches the signed-in user.");
  }

  if(!(await isAdmin(uid))){
    throw new Error(`Admin authorization failed. /admins/${uid} must be true.`);
  }

  const prev = (await getOnce(PATH.systemConfig)) || {};
  const now = Date.now();

  const next = {
    ...prev,
    ...stripUndefined(nextConfig),
    version: (prev.version || 0) + 1,
    updatedAt: now,
    updatedBy: uid
  };

  const histId = newKey(PATH.systemConfigHistory);
  const logId = newKey(PATH.auditLogs);

  const u = {};

  // ★ Write the WHOLE system_config node — this is the shape that passed
  //   the security rules before.
  u[PATH.systemConfig] = next;

  u[`${PATH.systemConfigHistory}/${histId}`] = {
    changedAt: now,
    changedBy: uid,
    previous: prev,
    next,
    reason
  };

  u[`${PATH.auditLogs}/${logId}`] = {
    logId,
    actor: uid,
    actorRole: "admin",
    action: "SYSTEM_CONFIG_UPDATE",
    target: "system_config",
    previousValue: prev,
    newValue: next,
    note: reason,
    timestamp: now
  };

  try{
    await update(ref(db), stripUndefined(u));
  }catch(e){
    if(e?.code === "PERMISSION_DENIED" || /permission_denied/i.test(e?.message || "")){
      console.error("system_config write denied.", {
        signedInUid: authUid,
        adminUidParam: adminUid,
        paths: Object.keys(u)
      });
      throw new Error(
        "Permission denied writing system config. Check the /system_config, " +
        "/system_config_history and /audit_logs rules (.write and .validate)."
      );
    }
    throw e;
  }

  return next;
}


// ================================================================
// POOL STATS
// ================================================================
export async function computePoolStats(){

  const [users, bets, txCountSnap] = await Promise.all([
    listAll(PATH.users),
    listAll(PATH.betRecords),
    getOnce(PATH.transactions).then(d => (d ? Object.keys(d).length : 0))
  ]);

  const t = {
    totalContrib: 0, totalReserve: 0, totalAvailable: 0,
    totalDistributed: 0, totalWithdrawn: 0, totalCompany: 0, committed: 0
  };

  users.forEach(u => {
    const w = u.wallets || {};
    t.totalContrib += w.totalContribution || 0;
    t.totalReserve += w.protectedReserve || 0;
    t.totalAvailable += w.availableEarnings || 0;
    t.totalDistributed += w.totalEarningsGenerated || 0;
    t.totalWithdrawn += w.totalWithdrawn || 0;
    t.totalCompany += w.companyShareContributed || 0;
    t.committed += w.activeAllocation || 0;
  });

  return {
    ...t,
    activeBets: bets.filter(b => b.status === "pending").length,
    completedBets: bets.filter(b => b.status === "completed").length,
    txCount: txCountSnap
  };
}