import {
  db, ref, get, set, update, push, remove, query,
  orderByChild, equalTo, onValue, runTransaction
} from "./firebase.js";
import { writeLedgerEntry } from "./ledger.js";

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

export async function getOnce(path){
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
}
export function watch(path, cb){
  return onValue(ref(db, path), s => cb(s.exists() ? s.val() : null));
}
export async function listAll(path){
  const d = await getOnce(path);
  return d ? Object.entries(d).map(([id,v]) => ({ id, ...v })) : [];
}
export async function listBy(path, field, value){
  const q = query(ref(db, path), orderByChild(field), equalTo(value));
  const snap = await get(q);
  if(!snap.exists()) return [];
  return Object.entries(snap.val()).map(([id,v]) => ({ id, ...v }));
}
export async function pushItem(path, data){
  const r = push(ref(db, path));
  await set(r, { id: r.key, ...data });
  return r.key;
}
export async function updateItem(path, id, data){
  await update(ref(db, `${path}/${id}`), data);
}

export async function isAdmin(uid){
  if(!uid) return false;
  const snap = await get(ref(db, `${PATH.admins}/${uid}`));
  return snap.exists() && snap.val() === true;
}

export async function logActivity({ adminId, action, target=null, prev=null, next=null, note="" }){
  return pushItem(PATH.auditLogs, {
    actor: adminId, action, target,
    previousValue: prev, newValue: next,
    note, timestamp: Date.now()
  });
}

export async function notify(uid, { type, title, body, meta={} }){
  return pushItem(`${PATH.notifications}/${uid}`, {
    type, title, body, meta, read: false, createdAt: Date.now()
  });
}

export async function updateSystemConfig(newConfig, actorUid, reason=""){
  const prev = (await getOnce(PATH.systemConfig)) || {};
  const nextVersion = (prev.version || 0) + 1;
  const next = { ...prev, ...newConfig, version: nextVersion, updatedAt: Date.now(), updatedBy: actorUid };
  await set(ref(db, PATH.systemConfig), next);
  await pushItem(PATH.systemConfigHistory, {
    changedAt: Date.now(), changedBy: actorUid,
    previous: prev, next, reason
  });
  await logActivity({
    adminId: actorUid, action: "SYSTEM_CONFIG_UPDATE",
    target: "system_config", prev, next, note: reason
  });
  return next;
}