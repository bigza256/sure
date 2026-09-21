// ============================================
// SURE — data access + atomic financial workflows
// Every balance-changing operation writes a matching ledger row.
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


// ================================================================
// PATHS
// ================================================================

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


// ================================================================
// DEFAULT WALLET STRUCTURE
// ================================================================

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
// ADMIN CHECK
// Reads /admins/{uid}
// Must match the Firebase security rule:
//
// root.child('admins').child(auth.uid).val() === true
// ================================================================

export async function isAdmin(uid){
  if(!uid) return false;

  try{
    const snap = await get(
      ref(db, `${PATH.admins}/${uid}`)
    );

    return snap.exists() && snap.val() === true;

  }catch(_){
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
  return onValue(
    ref(db, path),
    snap => cb(
      snap.exists() ? snap.val() : null
    )
  );
}


export async function listAll(path){
  const data = await getOnce(path);

  if(!data) return [];

  return Object.entries(data).map(
    ([id, v]) => ({
      id,
      ...v
    })
  );
}


export async function listBy(path, field, value){
  const q = query(
    ref(db, path),
    orderByChild(field),
    equalTo(value)
  );

  const snap = await get(q);

  if(!snap.exists()) return [];

  return Object.entries(snap.val()).map(
    ([id, v]) => ({
      id,
      ...v
    })
  );
}


// ================================================================
// WRITE HELPERS
// ================================================================

export async function pushItem(path, data){
  const r = push(ref(db, path));

  await set(
    r,
    {
      id: r.key,
      ...data
    }
  );

  return r.key;
}


export async function updateItem(path, id, data){
  await update(
    ref(db, `${path}/${id}`),
    data
  );
}


// ================================================================
// AUDIT LOG
// ================================================================

export async function logActivity({
  adminId,
  action,
  target = null,
  prev = null,
  next = null,
  note = ""
}){
  return pushItem(
    PATH.auditLogs,
    {
      actor: adminId,
      actorRole: "admin",
      action,
      target,
      previousValue: prev,
      newValue: next,
      note,
      timestamp: Date.now()
    }
  );
}


// ================================================================
// USER NOTIFICATION
// ================================================================

export async function notifyUser(
  uid,
  {
    type,
    title,
    body = "",
    meta = {}
  }
){
  return pushItem(
    `${PATH.notifications}/${uid}`,
    {
      type,
      title,
      body,
      meta,
      read: false,
      createdAt: Date.now()
    }
  );
}


// ================================================================
// DERIVED RISK STATE
// ================================================================

export function deriveRiskState(wallets, config){

  const reservePct = calculateReservePercent(
    wallets.protectedReserve,
    wallets.activeAllocation
  );

  const level = calculateRiskLevel(
    reservePct,
    config
  );

  return {
    level,
    reservePercent:
      Math.round(reservePct * 10) / 10,
    lastEvaluatedAt: Date.now()
  };
}


// ================================================================
// DEPOSIT SUBMISSION
//
// depositId must equal the record key.
// The security rule requires this.
// ================================================================

export async function createDepositSubmission(data){

  const newRef = push(
    ref(db, PATH.depositSubmissions)
  );

  const depositId = newRef.key;

  await set(
    newRef,
    {
      depositId,
      ...data,

      relatedContributionId: null,
      relatedTransactionIds: [],

      reviewedAt: null,
      reviewedBy: null,

      rejectionReason: ""
    }
  );

  return depositId;
}


// ================================================================
// ATOMIC WORKFLOW: APPROVE DEPOSIT
//
// Credits wallets, creates contribution,
// cycle and ledger entries.
// ================================================================

export async function approveDeposit({
  deposit,
  adminUid,
  config
}){

  const fresh = await getOnce(
    `${PATH.depositSubmissions}/${deposit.depositId}`
  );

  if(!fresh){
    throw new Error("Deposit not found.");
  }

  if(fresh.status !== "PENDING"){
    throw new Error(
      "Deposit has already been reviewed."
    );
  }


  const user = await getOnce(
    `${PATH.users}/${deposit.uid}`
  );

  if(!user){
    throw new Error("User record not found.");
  }

  if(user.status === "suspended"){
    throw new Error(
      "User account is suspended."
    );
  }


  const wallets = {
    ...ZERO_WALLETS,
    ...(user.wallets || {})
  };


  const allocation =
    calculateActiveAllocation(
      deposit.amount,
      config
    );

  const reserve =
    calculateProtectedReserve(
      deposit.amount,
      config
    );


  const newWallets = {

    ...wallets,

    activeAllocation:
      wallets.activeAllocation + allocation,

    protectedReserve:
      wallets.protectedReserve + reserve,

    totalContribution:
      wallets.totalContribution + deposit.amount
  };


  const riskState =
    deriveRiskState(
      newWallets,
      config
    );


  const now = Date.now();


  const contributionId =
    push(ref(db, PATH.contributions)).key;

  const cycleId =
    push(ref(db, PATH.cycles)).key;

  const txContrib =
    push(ref(db, PATH.transactions)).key;

  const txAllocation =
    push(ref(db, PATH.transactions)).key;

  const txReserve =
    push(ref(db, PATH.transactions)).key;

  const logId =
    push(ref(db, PATH.auditLogs)).key;


  const u = {};


  // --------------------------------------------------------------
  // USER WALLET
  // --------------------------------------------------------------

  u[
    `${PATH.users}/${deposit.uid}/wallets`
  ] = newWallets;


  u[
    `${PATH.users}/${deposit.uid}/riskState`
  ] = riskState;


  u[
    `${PATH.users}/${deposit.uid}/currentCycleId`
  ] = cycleId;


  // --------------------------------------------------------------
  // CONTRIBUTION
  // --------------------------------------------------------------

  u[
    `${PATH.contributions}/${contributionId}`
  ] = {

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


  // --------------------------------------------------------------
  // CYCLE
  // --------------------------------------------------------------

  u[
    `${PATH.cycles}/${cycleId}`
  ] = {

    cycleId,

    uid: deposit.uid,

    configVersion: config.version,

    startingContribution:
      deposit.amount,

    startingReserve:
      newWallets.protectedReserve,

    startDate: now,

    endDate:
      now +
      (config.cycleDays || 30) *
      86400000,

    currentReserve:
      newWallets.protectedReserve,

    availableEarnings:
      newWallets.availableEarnings,

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


  // --------------------------------------------------------------
  // TRANSACTION BASE
  // --------------------------------------------------------------

  const base = {

    uid: deposit.uid,

    cycleId,

    currency: "UGX",

    status: "COMPLETED",

    timestamp: now,

    actor: adminUid
  };


  // --------------------------------------------------------------
  // CONTRIBUTION TRANSACTION
  // --------------------------------------------------------------

  u[
    `${PATH.transactions}/${txContrib}`
  ] = {

    ...base,

    txId: txContrib,

    type: "CONTRIBUTION",

    amount: deposit.amount,

    wallet: "totalContribution",

    previousBalance:
      wallets.totalContribution,

    newBalance:
      newWallets.totalContribution,

    referenceId:
      deposit.depositId,

    note:
      "Contribution approved"
  };


  // --------------------------------------------------------------
  // ACTIVE ALLOCATION TRANSACTION
  // --------------------------------------------------------------

  u[
    `${PATH.transactions}/${txAllocation}`
  ] = {

    ...base,

    txId: txAllocation,

    type: "ACTIVE_ALLOCATION",

    amount: allocation,

    wallet: "activeAllocation",

    previousBalance:
      wallets.activeAllocation,

    newBalance:
      newWallets.activeAllocation,

    referenceId:
      contributionId,

    note:
      "Active allocation credit"
  };


  // --------------------------------------------------------------
  // RESERVE TRANSACTION
  // --------------------------------------------------------------

  u[
    `${PATH.transactions}/${txReserve}`
  ] = {

    ...base,

    txId: txReserve,

    type: "RESERVE_ADDITION",

    amount: reserve,

    wallet: "protectedReserve",

    previousBalance:
      wallets.protectedReserve,

    newBalance:
      newWallets.protectedReserve,

    referenceId:
      contributionId,

    note:
      "Protected reserve credit"
  };


  // --------------------------------------------------------------
  // UPDATE DEPOSIT
  // --------------------------------------------------------------

  u[
    `${PATH.depositSubmissions}/${deposit.depositId}/status`
  ] = "APPROVED";


  u[
    `${PATH.depositSubmissions}/${deposit.depositId}/reviewedAt`
  ] = now;


  u[
    `${PATH.depositSubmissions}/${deposit.depositId}/reviewedBy`
  ] = adminUid;


  u[
    `${PATH.depositSubmissions}/${deposit.depositId}/relatedContributionId`
  ] = contributionId;


  u[
    `${PATH.depositSubmissions}/${deposit.depositId}/relatedTransactionIds`
  ] =
    [
      txContrib,
      txAllocation,
      txReserve
    ];


  // --------------------------------------------------------------
  // AUDIT LOG
  // --------------------------------------------------------------

  u[
    `${PATH.auditLogs}/${logId}`
  ] = {

    logId,

    actor: adminUid,

    actorRole: "admin",

    action: "APPROVE_DEPOSIT",

    target:
      deposit.depositId,

    previousValue:
      "PENDING",

    newValue:
      "APPROVED",

    note:
      `UGX ${deposit.amount} for ${deposit.userEmail || deposit.uid}`,

    timestamp: now
  };


  // --------------------------------------------------------------
  // ATOMIC FINANCIAL UPDATE
  // --------------------------------------------------------------

  await update(
    ref(db),
    u
  );


  // --------------------------------------------------------------
  // USER NOTIFICATION
  // --------------------------------------------------------------

  await notifyUser(
    deposit.uid,
    {
      type: "DEPOSIT_APPROVED",

      title:
        "Contribution received",

      body:
        `Your contribution of UGX ${deposit.amount.toLocaleString()} has been approved.`,

      meta: {
        contributionId,
        cycleId
      }
    }
  );


  return {
    contributionId,
    cycleId,
    txIds: [
      txContrib,
      txAllocation,
      txReserve
    ]
  };
}


// ================================================================
// ATOMIC WORKFLOW: REJECT DEPOSIT
// ================================================================

export async function rejectDeposit({
  deposit,
  adminUid,
  reason
}){

  const fresh = await getOnce(
    `${PATH.depositSubmissions}/${deposit.depositId}`
  );

  if(
    !fresh ||
    fresh.status !== "PENDING"
  ){
    throw new Error(
      "Already reviewed."
    );
  }


  const now = Date.now();

  const logId =
    push(ref(db, PATH.auditLogs)).key;


  const u = {};


  u[
    `${PATH.depositSubmissions}/${deposit.depositId}/status`
  ] = "REJECTED";


  u[
    `${PATH.depositSubmissions}/${deposit.depositId}/reviewedAt`
  ] = now;


  u[
    `${PATH.depositSubmissions}/${deposit.depositId}/reviewedBy`
  ] = adminUid;


  u[
    `${PATH.depositSubmissions}/${deposit.depositId}/rejectionReason`
  ] =
    reason || "";


  u[
    `${PATH.auditLogs}/${logId}`
  ] = {

    logId,

    actor: adminUid,

    actorRole: "admin",

    action: "REJECT_DEPOSIT",

    target:
      deposit.depositId,

    previousValue:
      "PENDING",

    newValue:
      "REJECTED",

    note:
      reason || "",

    timestamp: now
  };


  await update(
    ref(db),
    u
  );


  await notifyUser(
    deposit.uid,
    {
      type: "DEPOSIT_REJECTED",

      title:
        "Contribution rejected",

      body:
        reason
          ? `Reason: ${reason}`
          : "Your deposit could not be verified."
    }
  );
}


// ================================================================
// ATOMIC WORKFLOW: BET WIN
//
// Stake is consumed and returned.
// Profit is split according to config.
// ================================================================

export async function recordBetWin({
  uid,
  cycleId,
  stake,
  odds,
  adminUid,
  config,
  betId
}){

  const user =
    await getOnce(
      `${PATH.users}/${uid}`
    );

  if(!user){
    throw new Error(
      "User not found."
    );
  }


  const wallets = {
    ...ZERO_WALLETS,
    ...(user.wallets || {})
  };


  if(
    wallets.activeAllocation < stake
  ){
    throw new Error(
      "Insufficient allocation."
    );
  }


  const grossReturn =
    Math.round(
      stake * odds
    );

  const grossProfit =
    grossReturn - stake;


  const dist =
    calculateProfitDistribution(
      grossProfit,
      config
    );


  const newWallets = {

    ...wallets,

    availableEarnings:
      wallets.availableEarnings +
      dist.availableEarnings,

    protectedReserve:
      wallets.protectedReserve +
      dist.reserveAddition,

    companyShareContributed:
      wallets.companyShareContributed +
      dist.companyShare,

    totalEarningsGenerated:
      wallets.totalEarningsGenerated +
      dist.availableEarnings
  };


  const riskState =
    deriveRiskState(
      newWallets,
      config
    );


  const cycle =
    await getOnce(
      `${PATH.cycles}/${cycleId}`
    ) || {};


  const now = Date.now();


  const txStake =
    push(ref(db, PATH.transactions)).key;

  const txReturn =
    push(ref(db, PATH.transactions)).key;

  const txEarn =
    push(ref(db, PATH.transactions)).key;

  const txRes =
    push(ref(db, PATH.transactions)).key;

  const txCo =
    push(ref(db, PATH.transactions)).key;

  const logId =
    push(ref(db, PATH.auditLogs)).key;


  const base = {

    uid,

    cycleId,

    currency: "UGX",

    status: "COMPLETED",

    timestamp: now,

    actor: adminUid,

    referenceId: betId
  };


  const u = {};


  u[
    `${PATH.users}/${uid}/wallets`
  ] = newWallets;


  u[
    `${PATH.users}/${uid}/riskState`
  ] = riskState;


  // BET STAKE

  u[
    `${PATH.transactions}/${txStake}`
  ] = {

    ...base,

    txId: txStake,

    type: "BET_STAKE",

    amount: -stake,

    wallet: "activeAllocation",

    previousBalance:
      wallets.activeAllocation,

    newBalance:
      wallets.activeAllocation - stake,

    note:
      `Stake committed @ ${odds}`
  };


  // STAKE RETURN

  u[
    `${PATH.transactions}/${txReturn}`
  ] = {

    ...base,

    txId: txReturn,

    type: "STAKE_RETURN",

    amount: stake,

    wallet: "activeAllocation",

    previousBalance:
      wallets.activeAllocation - stake,

    newBalance:
      wallets.activeAllocation,

    note:
      `Stake returned @ ${odds}`
  };


  // AVAILABLE EARNINGS

  u[
    `${PATH.transactions}/${txEarn}`
  ] = {

    ...base,

    txId: txEarn,

    type: "PROFIT_DISTRIBUTION",

    amount:
      dist.availableEarnings,

    wallet:
      "availableEarnings",

    previousBalance:
      wallets.availableEarnings,

    newBalance:
      newWallets.availableEarnings,

    note:
      "Available earnings credit"
  };


  // RESERVE

  u[
    `${PATH.transactions}/${txRes}`
  ] = {

    ...base,

    txId: txRes,

    type: "RESERVE_ADDITION",

    amount:
      dist.reserveAddition,

    wallet:
      "protectedReserve",

    previousBalance:
      wallets.protectedReserve,

    newBalance:
      newWallets.protectedReserve,

    note:
      "Reserve credit from profit"
  };


  // COMPANY SHARE

  u[
    `${PATH.transactions}/${txCo}`
  ] = {

    ...base,

    txId: txCo,

    type: "COMPANY_SHARE",

    amount:
      dist.companyShare,

    wallet:
      "companyShare",

    previousBalance:
      wallets.companyShareContributed,

    newBalance:
      newWallets.companyShareContributed,

    note:
      "Company share recorded"
  };


  // CYCLE UPDATES

  u[
    `${PATH.cycles}/${cycleId}/currentReserve`
  ] =
    newWallets.protectedReserve;


  u[
    `${PATH.cycles}/${cycleId}/availableEarnings`
  ] =
    newWallets.availableEarnings;


  u[
    `${PATH.cycles}/${cycleId}/totalWins`
  ] =
    (cycle.totalWins || 0) +
    grossProfit;


  u[
    `${PATH.cycles}/${cycleId}/winsCount`
  ] =
    (cycle.winsCount || 0) +
    1;


  u[
    `${PATH.cycles}/${cycleId}/totalCompanyShare`
  ] =
    (cycle.totalCompanyShare || 0) +
    dist.companyShare;


  // AUDIT LOG

  u[
    `${PATH.auditLogs}/${logId}`
  ] = {

    logId,

    actor: adminUid,

    actorRole: "admin",

    action: "BET_WIN",

    target: betId,

    previousValue: null,

    newValue: {
      stake,
      odds,
      grossProfit,
      distribution: dist
    },

    note:
      `Won @ ${odds}`,

    timestamp: now
  };


  await update(
    ref(db),
    u
  );


  await notifyUser(
    uid,
    {
      type: "PROFIT_CREDITED",

      title:
        "Bet won",

      body:
        `Profit of UGX ${grossProfit.toLocaleString()} distributed.`
    }
  );
}


// ================================================================
// ATOMIC WORKFLOW: BET LOSS
//
// Stake permanently leaves active allocation.
// ================================================================

export async function recordBetLoss({
  uid,
  cycleId,
  stake,
  odds,
  adminUid,
  config,
  betId
}){

  const user =
    await getOnce(
      `${PATH.users}/${uid}`
    );

  if(!user){
    throw new Error(
      "User not found."
    );
  }


  const wallets = {
    ...ZERO_WALLETS,
    ...(user.wallets || {})
  };


  if(
    wallets.activeAllocation < stake
  ){
    throw new Error(
      "Insufficient allocation."
    );
  }


  const newWallets = {

    ...wallets,

    activeAllocation:
      wallets.activeAllocation - stake
  };


  const riskState =
    deriveRiskState(
      newWallets,
      config
    );


  const cycle =
    await getOnce(
      `${PATH.cycles}/${cycleId}`
    ) || {};


  const now = Date.now();


  const txId =
    push(ref(db, PATH.transactions)).key;

  const logId =
    push(ref(db, PATH.auditLogs)).key;


  const u = {};


  u[
    `${PATH.users}/${uid}/wallets`
  ] = newWallets;


  u[
    `${PATH.users}/${uid}/riskState`
  ] = riskState;


  u[
    `${PATH.transactions}/${txId}`
  ] = {

    txId,

    uid,

    cycleId,

    type: "BET_LOSS",

    amount: -stake,

    currency: "UGX",

    wallet: "activeAllocation",

    previousBalance:
      wallets.activeAllocation,

    newBalance:
      newWallets.activeAllocation,

    referenceId: betId,

    status: "COMPLETED",

    timestamp: now,

    actor: adminUid,

    note:
      `Lost @ ${odds}`
  };


  u[
    `${PATH.cycles}/${cycleId}/totalLosses`
  ] =
    (cycle.totalLosses || 0) +
    stake;


  u[
    `${PATH.cycles}/${cycleId}/lossesCount`
  ] =
    (cycle.lossesCount || 0) +
    1;


  u[
    `${PATH.auditLogs}/${logId}`
  ] = {

    logId,

    actor: adminUid,

    actorRole: "admin",

    action: "BET_LOSS",

    target: betId,

    previousValue: null,

    newValue: {
      stake,
      odds
    },

    note:
      `Lost @ ${odds}`,

    timestamp: now
  };


  await update(
    ref(db),
    u
  );


  await notifyUser(
    uid,
    {
      type: "LOSS_RECORDED",

      title:
        "Bet result recorded",

      body:
        `A stake of UGX ${stake.toLocaleString()} was lost.`
    }
  );
}


// ================================================================
// ATOMIC WORKFLOW: COMPLETE WITHDRAWAL
//
// Debits availableEarnings only when completed.
// ================================================================

export async function completeWithdrawal({
  withdrawal,
  adminUid
}){

  const fresh =
    await getOnce(
      `${PATH.withdrawals}/${withdrawal.wid}`
    );


  if(!fresh){
    throw new Error(
      "Withdrawal not found."
    );
  }


  if(fresh.status === "COMPLETED"){
    throw new Error(
      "Already completed."
    );
  }


  if(fresh.status === "REJECTED"){
    throw new Error(
      "Cannot complete a rejected withdrawal."
    );
  }


  const user =
    await getOnce(
      `${PATH.users}/${withdrawal.uid}`
    );


  if(!user){
    throw new Error(
      "User record not found."
    );
  }


  const wallets = {
    ...ZERO_WALLETS,
    ...(user.wallets || {})
  };


  if(
    wallets.availableEarnings <
    withdrawal.amount
  ){
    throw new Error(
      "Insufficient available earnings."
    );
  }


  const newWallets = {

    ...wallets,

    availableEarnings:
      wallets.availableEarnings -
      withdrawal.amount,

    totalWithdrawn:
      wallets.totalWithdrawn +
      withdrawal.amount
  };


  const now = Date.now();


  const txId =
    push(ref(db, PATH.transactions)).key;

  const logId =
    push(ref(db, PATH.auditLogs)).key;


  const u = {};


  u[
    `${PATH.users}/${withdrawal.uid}/wallets`
  ] = newWallets;


  u[
    `${PATH.withdrawals}/${withdrawal.wid}/status`
  ] = "COMPLETED";


  u[
    `${PATH.withdrawals}/${withdrawal.wid}/processedBy`
  ] = adminUid;


  u[
    `${PATH.withdrawals}/${withdrawal.wid}/processedAt`
  ] = now;


  u[
    `${PATH.transactions}/${txId}`
  ] = {

    txId,

    uid: withdrawal.uid,

    cycleId:
      user.currentCycleId || "",

    type: "WITHDRAWAL",

    amount:
      -withdrawal.amount,

    currency: "UGX",

    wallet:
      "availableEarnings",

    previousBalance:
      wallets.availableEarnings,

    newBalance:
      newWallets.availableEarnings,

    referenceId:
      withdrawal.wid,

    status: "COMPLETED",

    timestamp: now,

    actor: adminUid,

    note:
      "Withdrawal completed"
  };


  u[
    `${PATH.auditLogs}/${logId}`
  ] = {

    logId,

    actor: adminUid,

    actorRole: "admin",

    action:
      "WITHDRAWAL_COMPLETED",

    target:
      withdrawal.wid,

    previousValue:
      fresh.status,

    newValue:
      "COMPLETED",

    note:
      `UGX ${withdrawal.amount}`,

    timestamp: now
  };


  await update(
    ref(db),
    u
  );


  await notifyUser(
    withdrawal.uid,
    {
      type:
        "WITHDRAWAL_COMPLETED",

      title:
        "Withdrawal completed",

      body:
        `UGX ${withdrawal.amount.toLocaleString()} has been processed.`
    }
  );
}


// ================================================================
// UPDATE SYSTEM CONFIG
//
// IMPORTANT:
// This function intentionally does NOT use:
//
//     update(ref(db), u)
//
// because that requests a write from the database root.
//
// Instead, each protected branch is written directly:
//     /system_config
//     /system_config_history/{id}
//     /audit_logs/{id}
//
// This keeps the admin permission checks scoped to their
// respective database paths.
// ================================================================

export async function updateSystemConfig({
  nextConfig,
  adminUid,
  reason = ""
}){

  // --------------------------------------------------------------
  // BASIC ADMIN UID CHECK
  // --------------------------------------------------------------

  if(!adminUid){
    throw new Error(
      "Admin UID is required."
    );
  }


  // --------------------------------------------------------------
  // VERIFY THAT THE CURRENT USER IS ACTUALLY AN ADMIN
  //
  // This uses the same /admins/{uid} value checked by the
  // Firebase security rules.
  // --------------------------------------------------------------

  const adminStatus =
    await isAdmin(adminUid);


  if(!adminStatus){
    throw new Error(
      "Admin authorization failed. /admins/" +
      adminUid +
      " must be true."
    );
  }


  // --------------------------------------------------------------
  // LOAD CURRENT CONFIGURATION
  // --------------------------------------------------------------

  const prev =
    (await getOnce(PATH.systemConfig)) || {};


  // --------------------------------------------------------------
  // CREATE NEXT VERSION
  // --------------------------------------------------------------

  const version =
    (prev.version || 0) + 1;


  const now =
    Date.now();


  const next = {

    ...prev,

    ...nextConfig,

    version,

    updatedAt:
      now,

    updatedBy:
      adminUid
  };


  // --------------------------------------------------------------
  // CREATE HISTORY / AUDIT IDS
  // --------------------------------------------------------------

  const histId =
    push(
      ref(db, PATH.systemConfigHistory)
    ).key;


  const logId =
    push(
      ref(db, PATH.auditLogs)
    ).key;


  // --------------------------------------------------------------
  // 1. UPDATE /system_config
  //
  // This is intentionally scoped to /system_config rather than
  // the database root.
  // --------------------------------------------------------------

  await update(
    ref(db, PATH.systemConfig),
    next
  );


  // --------------------------------------------------------------
  // 2. SAVE CONFIGURATION HISTORY
  // --------------------------------------------------------------

  await set(
    ref(
      db,
      `${PATH.systemConfigHistory}/${histId}`
    ),
    {
      changedAt:
        now,

      changedBy:
        adminUid,

      previous:
        prev,

      next,

      reason
    }
  );


  // --------------------------------------------------------------
  // 3. SAVE AUDIT LOG
  // --------------------------------------------------------------

  await set(
    ref(
      db,
      `${PATH.auditLogs}/${logId}`
    ),
    {
      logId,

      actor:
        adminUid,

      actorRole:
        "admin",

      action:
        "SYSTEM_CONFIG_UPDATE",

      target:
        "system_config",

      previousValue:
        prev,

      newValue:
        next,

      note:
        reason,

      timestamp:
        now
    }
  );


  // --------------------------------------------------------------
  // RETURN THE NEW CONFIGURATION
  // --------------------------------------------------------------

  return next;
}


// ================================================================
// POOL STATS
// Public read-only calculations.
// ================================================================

export async function computePoolStats(){

  const [
    users,
    txs,
    bets
  ] = await Promise.all([

    listAll(PATH.users),

    listAll(PATH.transactions),

    listAll(PATH.betRecords)

  ]);


  let totalContrib = 0;
  let totalReserve = 0;
  let totalAvailable = 0;
  let totalDistributed = 0;
  let totalWithdrawn = 0;
  let totalCompany = 0;
  let committed = 0;


  users.forEach(u => {

    const w =
      u.wallets || {};


    totalContrib +=
      w.totalContribution || 0;


    totalReserve +=
      w.protectedReserve || 0;


    totalAvailable +=
      w.availableEarnings || 0;


    totalDistributed +=
      w.totalEarningsGenerated || 0;


    totalWithdrawn +=
      w.totalWithdrawn || 0;


    totalCompany +=
      w.companyShareContributed || 0;


    committed +=
      w.activeAllocation || 0;

  });


  return {

    totalContrib,

    totalReserve,

    totalAvailable,

    totalDistributed,

    totalWithdrawn,

    totalCompany,

    committed,

    activeBets:
      bets.filter(
        b => b.status === "pending"
      ).length,

    completedBets:
      bets.filter(
        b => b.status === "completed"
      ).length,

    txCount:
      txs.length
  };
}