// ============================================
// SURE — reusable data-access layer
// All balance-changing operations go through here so every
// mutation writes a matching ledger/transaction record.
// ============================================
import {
  db, ref, get, set, update, push, remove, query,
  orderByChild, equalTo, onValue, runTransaction
} from "./firebase.js";

export const PATH = {
  users: "users",
  deposits: "deposits",
  withdrawals: "withdrawals",
  transactions: "transactions",
  bets: "bets",
  comments: "comments",
  cycles: "cycles",
  notifications: "notifications",
  settings: "settings",
  activityLogs: "activityLogs"
};

// ---------- read helpers ----------
export async function getOnce(path){
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
}
export function watch(path, cb){
  return onValue(ref(db, path), snap => cb(snap.exists() ? snap.val() : null));
}
export async function listBy(path, field, value){
  const q = query(ref(db, path), orderByChild(field), equalTo(value));
  const snap = await get(q);
  if(!snap.exists()) return [];
  return Object.entries(snap.val()).map(([id,v])=>({ id, ...v }));
}
export async function listAll(path){
  const data = await getOnce(path);
  if(!data) return [];
  return Object.entries(data).map(([id,v])=>({ id, ...v }));
}

// ---------- write helpers ----------
export async function pushItem(path, data){
  const r = push(ref(db, path));
  await set(r, { id: r.key, ...data });
  return r.key;
}
export async function updateItem(path, id, data){
  await update(ref(db, `${path}/${id}`), data);
}

// ---------- ledger ----------
/**
 * Append-only transaction record.
 * type: DEPOSIT | BET_STAKE | BET_RETURN | PROFIT_DISTRIBUTION |
 *       WITHDRAWAL | REFUND | ADJUSTMENT
 */
export async function writeTransaction({
  uid, type, amount, balanceAfter = null,
  reference = null, note = "", meta = {}, createdBy = null
}){
  return pushItem(PATH.transactions, {
    uid, type, amount: Number(amount) || 0,
    balanceAfter, reference, note, meta,
    createdBy, createdAt: Date.now()
  });
}

/** Append an admin activity log entry. */
export async function logActivity({ adminId, action, target=null, prev=null, next=null, note="" }){
  return pushItem(PATH.activityLogs, {
    adminId, action, target, previousValue: prev, newValue: next,
    note, createdAt: Date.now()
  });
}

// ---------- atomic balance op ----------
/**
 * Adjust a user's balance atomically and always write a ledger entry.
 * delta sign determines credit/debit. Prevents negative balances.
 */
export async function adjustBalance(uid, delta, { type, reference=null, note="", meta={}, createdBy=null } = {}){
  const userRef = ref(db, `${PATH.users}/${uid}`);
  let balanceAfter;
  const result = await runTransaction(userRef, (u)=>{
    if(!u) return u;
    const next = (Number(u.balance)||0) + Number(delta);
    if(next < 0) return; // abort — insufficient
    u.balance = next;
    balanceAfter = next;
    return u;
  });
  if(!result.committed) throw new Error("Insufficient balance");
  await writeTransaction({ uid, type, amount:Number(delta), balanceAfter, reference, note, meta, createdBy });
  return balanceAfter;
}

// ---------- pool accounting ----------
export async function computePoolStats(){
  const [users, bets, txs] = await Promise.all([
    listAll(PATH.users),
    listAll(PATH.bets),
    listAll(PATH.transactions)
  ]);
  const contributors = users.filter(u => (u.totalDeposited||0) > 0 && u.status !== "suspended");
  const totalContrib = contributors.reduce((s,u)=> s + (u.totalDeposited||0), 0);
  const totalReserve = contributors.reduce((s,u)=> s + (u.reserveBalance||0), 0);
  const totalWithdrawn = users.reduce((s,u)=> s + (u.totalWithdrawn||0), 0);
  const totalDistributed = users.reduce((s,u)=> s + (u.totalDistributed||0), 0);

  const committed = bets
    .filter(b=> b.status === "pending")
    .reduce((s,b)=> s + (b.plannedStake||0), 0);

  const realizedProfit = bets
    .filter(b=> b.result === "WIN")
    .reduce((s,b)=> s + (b.profitLoss||0), 0);
  const realizedLoss = bets
    .filter(b=> b.result === "LOSS")
    .reduce((s,b)=> s + Math.abs(b.profitLoss||0), 0);

  const net = realizedProfit - realizedLoss;

  // contribution % per contributor
  const withPct = contributors.map(u=>({
    ...u,
    contributionPct: totalContrib ? (u.totalDeposited||0)/totalContrib : 0
  }));

  return {
    totalContrib, totalReserve, totalWithdrawn, totalDistributed,
    committed, realizedProfit, realizedLoss, net,
    contributors: withPct,
    activeBets: bets.filter(b=>b.status==="pending").length,
    completedBets: bets.filter(b=>b.status==="completed").length,
    txs
  };
}

// ---------- cycle ----------
export function cycleInfo(cycle){
  if(!cycle) return { daysCompleted:0, daysLeft:0, startDate:null, endDate:null };
  const start = cycle.startDate || Date.now();
  const end = cycle.endDate || (start + 30*86400000);
  const now = Date.now();
  const daysCompleted = Math.max(0, Math.min(30, Math.floor((now-start)/86400000)));
  const daysLeft = Math.max(0, Math.ceil((end-now)/86400000));
  return { ...cycle, daysCompleted, daysLeft };
}