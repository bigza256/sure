import { db, ref, get } from "./firebase.js";

let _cache = null;

export async function loadSystemConfig(force=false){
  if(_cache && !force) return _cache;
  const snap = await get(ref(db, "system_config"));
  _cache = snap.exists() ? snap.val() : { ...DEFAULTS };
  return _cache;
}
export function getCachedConfig(){ return _cache; }
export function clearConfigCache(){ _cache = null; }

export const DEFAULTS = {
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
  designatedMobileMoney: { number: "", name: "", version: 1, updatedAt: 0 },
  riskLevels: {
    NORMAL:    { minReservePercent: 60, maxAllocationPercent: 25 },
    CAUTION:   { minReservePercent: 40, maxAllocationPercent: 15 },
    DEFENSIVE: { minReservePercent: 20, maxAllocationPercent: 10 },
    RECOVERY:  { minReservePercent: 0,  maxAllocationPercent: 0  }
  },
  status: "PRODUCTION",
  maintenanceMode: false
};