// ============================================
// SURE — Centralized Financial Calculation Engine
// ALL financial formulas live here. No exceptions.
// ============================================

export function calculateActiveAllocation(contribution, cfg){
  return Math.floor(contribution * (cfg.activeAllocationPercent / 100));
}
export function calculateProtectedReserve(contribution, cfg){
  return Math.floor(contribution * (cfg.reservePercent / 100));
}
export function calculateGrossReturn(stake, odds){
  return Math.round(stake * odds);
}
export function calculateGrossProfit(stake, odds){
  return calculateGrossReturn(stake, odds) - stake;
}
export function calculateProfitDistribution(grossProfit, cfg){
  const d = cfg.profitDistribution;
  const avail   = Math.floor(grossProfit * (d.availableEarningsPercent / 100));
  const company = Math.floor(grossProfit * (d.companySharePercent / 100));
  const reserve = grossProfit - avail - company; // last one absorbs rounding
  return { availableEarnings: avail, companyShare: company, reserveAddition: reserve };
}
export function calculateReservePercent(reserve, activeAllocation){
  const total = reserve + activeAllocation;
  if(total <= 0) return 100;
  return (reserve / total) * 100;
}
export function calculateRiskLevel(reservePercent, cfg){
  const L = cfg.riskLevels;
  if(reservePercent >= L.NORMAL.minReservePercent)    return "NORMAL";
  if(reservePercent >= L.CAUTION.minReservePercent)   return "CAUTION";
  if(reservePercent >= L.DEFENSIVE.minReservePercent) return "DEFENSIVE";
  return "RECOVERY";
}
export function calculateMaxAllocationPercent(riskLevel, cfg){
  return cfg.riskLevels[riskLevel]?.maxAllocationPercent ?? 0;
}
export function previewContribution(amount, cfg){
  const allocation  = calculateActiveAllocation(amount, cfg);
  const reserve     = calculateProtectedReserve(amount, cfg);
  const grossReturn = calculateGrossReturn(allocation, cfg.targetOdds);
  const grossProfit = calculateGrossProfit(allocation, cfg.targetOdds);
  const dist        = calculateProfitDistribution(grossProfit, cfg);
  return {
    contribution: amount,
    activeAllocation: allocation,
    protectedReserve: reserve,
    targetOdds: cfg.targetOdds,
    grossReturn, grossProfit,
    distribution: dist
  };
}
export function calculateCycleSettlement(cycle, cfg){
  const startingContribution = cycle.startingContribution || 0;
  const finalReserve         = cycle.currentReserve || 0;
  const availableEarnings    = cycle.availableEarnings || 0;
  const companyShare         = cycle.totalCompanyShare || 0;
  const finalSettlement      = finalReserve + availableEarnings;
  return {
    startingContribution,
    finalReserve,
    availableEarnings,
    totalEarningsGenerated: availableEarnings,
    companyShare,
    totalWins: cycle.totalWins || 0,
    totalLosses: cycle.totalLosses || 0,
    winsCount: cycle.winsCount || 0,
    lossesCount: cycle.lossesCount || 0,
    maxDrawdown: cycle.maxDrawdown || 0,
    finalSettlement,
    netPosition: finalSettlement - startingContribution
  };
}