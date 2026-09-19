// ============================================
// SURE — system_config loader
// Reads financial rules from the database. Never hard-codes values.
// ============================================
import { db, ref, get } from "./firebase.js";

let _cache = null;
let _cachedAt = 0;
const TTL = 60_000;

export const DEFAULT_CONFIG = {
  version: 1,
  activeAllocationPercent: 25,
  reservePercent: 75,
  targetOdds: 1.80,
  profitDistribution: {
    availableEarningsPercent: 12.5,
    companySharePercent: 12.5,
    reserveAdditionPercent: 75
  },
  cycleDays: 30,
  minContribution: 50000,
  maxContribution: 800000,
  minWithdrawal: 10000,
  maxDailyExposure: 5000000,
  designatedMobileMoney: { number: "", name: "", version: 1 },
  riskLevels: {
    NORMAL:    { minReservePercent: 60, maxAllocationPercent: 25 },
    CAUTION:   { minReservePercent: 40, maxAllocationPercent: 15 },
    DEFENSIVE: { minReservePercent: 20, maxAllocationPercent: 10 },
    RECOVERY:  { minReservePercent: 0,  maxAllocationPercent: 0  }
  },
  status: "PRODUCTION",
  maintenanceMode: false
};

export async function loadConfig(force = false){
  if(!force && _cache && (Date.now() - _cachedAt) < TTL){
    return _cache;
  }
  try{
    const snap = await get(ref(db, "system_config"));
    _cache = snap.exists() ? { ...DEFAULT_CONFIG, ...snap.val() } : DEFAULT_CONFIG;
  }catch(_){
    _cache = DEFAULT_CONFIG;
  }
  _cachedAt = Date.now();
  return _cache;
}

export function getCachedConfig(){
  return _cache || DEFAULT_CONFIG;
}