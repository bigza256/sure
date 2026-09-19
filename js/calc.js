// ============================================
// SURE — Centralized Financial Calculation Engine
// Every formula lives here. No financial math anywhere else.
// ============================================

export function calculateActiveAllocation(contribution, config){
  return Math.floor(contribution * (config.activeAllocationPercent / 100));
}

export function calculateProtectedReserve(contribution, config){
  return Math.floor(contribution * (config.reservePercent / 100));
}

export function calculateGrossReturn(stake, odds){
  return Math.round(stake * odds);
}

export function calculateGrossProfit(stake, odds){
  return calculateGrossReturn(stake, odds) - stake;
}

export function calculateProfitDistribution(grossProfit, config){
  const d = config.profitDistribution || {};
  const availPct    = d.availableEarningsPercent ?? 12.5;
  const companyPct  = d.companySharePercent ?? 12.5;
  const reservePct  = d.reserveAdditionPercent ?? 75;
  return {
    availableEarnings: Math.floor(grossProfit * (availPct / 100)),
    companyShare:      Math.floor(grossProfit * (companyPct / 100)),
    reserveAddition:   Math.floor(grossProfit * (reservePct / 100))
  };
}

export function calculateReservePercent(reserve, activeAllocation){
  const total = (reserve || 0) + (activeAllocation || 0);
  if(total === 0) return 100;
  return (reserve / total) * 100;
}

export function calculateRiskLevel(reservePercent, config){
  const L = config.riskLevels;
  if(reservePercent >= L.NORMAL.minReservePercent)    return "NORMAL";
  if(reservePercent >= L.CAUTION.minReservePercent)   return "CAUTION";
  if(reservePercent >= L.DEFENSIVE.minReservePercent) return "DEFENSIVE";
  return "RECOVERY";
}

export function calculateMaxAllocationPercent(riskLevel, config){
  return config.riskLevels[riskLevel]?.maxAllocationPercent ?? 0;
}

export function calculateCycleSettlement(cycle, config){
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
    totalLosses: cycle.totalLosses || 0,
    totalWins:   cycle.totalWins   || 0,
    maxDrawdown: cycle.maxDrawdown || 0,
    finalSettlement,
    netPosition: finalSettlement - startingContribution
  };
}

/**
 * Preview of a contribution — used on the deposit page and by admin
 * when approving. Never used to credit a balance directly.
 */
export function previewContribution(amount, config){
  const allocation   = calculateActiveAllocation(amount, config);
  const reserve      = calculateProtectedReserve(amount, config);
  const grossReturn  = calculateGrossReturn(allocation, config.targetOdds);
  const grossProfit  = calculateGrossProfit(allocation, config.targetOdds);
  const distribution = calculateProfitDistribution(grossProfit, config);
  return {
    contribution: amount,
    activeAllocation: allocation,
    protectedReserve: reserve,
    targetOdds: config.targetOdds,
    grossReturn,
    grossProfit,
    distribution
  };
}