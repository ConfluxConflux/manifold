import { Dictionary, min, orderBy, sum, sumBy, uniq } from 'lodash'
import {
  calculatePayout,
  calculateTotalSpentAndShares,
  getContractBetMetricsPerAnswer,
} from './calculate'
import { Bet, LimitBet } from './bet'
import {
  Contract,
  CPMMMultiContract,
  CPMMMultiNumeric,
  getAdjustedProfit,
} from './contract'
import { User } from './user'
import { computeFills } from './new-bet'
import { CpmmState, getCpmmProbability } from './calculate-cpmm'
import { removeUndefinedProps } from './util/object'
import { floatingEqual, logit } from './util/math'
import { ContractMetric } from 'common/contract-metric'
import { Answer } from 'common/answer'
import { noFees } from './fees'
import { DisplayUser } from './api/user-types'

export const computeInvestmentValue = (
  bets: Bet[],
  contractsDict: { [k: string]: Contract }
) => {
  let investmentValue = 0
  let cashInvestmentValue = 0
  for (const bet of bets) {
    const contract = contractsDict[bet.contractId]
    if (!contract || contract.isResolved) continue

    let payout
    try {
      payout = calculatePayout(contract, bet, 'MKT')
    } catch (e) {
      console.log(
        'contract',
        contract.question,
        contract.mechanism,
        contract.id
      )
      console.error(e)
      payout = 0
    }
    const value = payout - (bet.loanAmount ?? 0)
    if (isNaN(value)) continue

    if (contract.token === 'CASH') {
      cashInvestmentValue += value
    } else {
      investmentValue += value
    }
  }

  return { investmentValue, cashInvestmentValue }
}

export const computeInvestmentValueCustomProb = (
  bets: Bet[],
  contract: Contract,
  p: number
) => {
  return sumBy(bets, (bet) => {
    if (!contract) return 0
    const { outcome, shares } = bet

    const betP = outcome === 'YES' ? p : 1 - p

    const value = betP * shares
    if (isNaN(value)) return 0
    return value
  })
}

const getLoanTotal = (
  bets: Bet[],
  contractsDict: { [k: string]: Contract }
) => {
  return sumBy(bets, (bet) => {
    const contract = contractsDict[bet.contractId]
    if (!contract || contract.isResolved) return 0
    return bet.loanAmount ?? 0
  })
}

export const ELASTICITY_BET_AMOUNT = 10000 // readjust with platform volume

export const computeElasticity = (
  unfilledBets: LimitBet[],
  contract: Contract,
  betAmount = ELASTICITY_BET_AMOUNT
) => {
  const { mechanism, isResolved } = contract

  switch (mechanism) {
    case 'cpmm-1':
      return computeBinaryCpmmElasticity(
        isResolved ? [] : unfilledBets, // only consider limit orders for open markets
        contract,
        betAmount
      )
    case 'cpmm-multi-1':
      return computeMultiCpmmElasticity(
        isResolved ? [] : unfilledBets, // only consider limit orders for open markets
        contract,
        betAmount
      )
    default: // there are some contracts on the dev DB with crazy mechanisms
      return 1_000_000
  }
}

export const computeBinaryCpmmElasticity = (
  unfilledBets: LimitBet[],
  cpmmState: CpmmState,
  betAmount: number
) => {
  const sortedBets = unfilledBets.sort((a, b) => a.createdTime - b.createdTime)

  const userIds = uniq(unfilledBets.map((b) => b.userId))
  // Assume all limit orders are good.
  const userBalances = Object.fromEntries(
    userIds.map((id) => [id, Number.MAX_SAFE_INTEGER])
  )

  const {
    cpmmState: { pool: poolY, p: pY },
  } = computeFills(
    cpmmState,
    'YES',
    betAmount,
    undefined,
    sortedBets,
    userBalances
  )
  const resultYes = getCpmmProbability(poolY, pY)

  const {
    cpmmState: { pool: poolN, p: pN },
  } = computeFills(
    cpmmState,
    'NO',
    betAmount,
    undefined,
    sortedBets,
    userBalances
  )
  const resultNo = getCpmmProbability(poolN, pN)

  // handle AMM overflow
  const safeYes = Number.isFinite(resultYes)
    ? Math.min(resultYes, 0.995)
    : 0.995
  const safeNo = Number.isFinite(resultNo) ? Math.max(resultNo, 0.005) : 0.005

  return logit(safeYes) - logit(safeNo)
}

export const computeBinaryCpmmElasticityFromAnte = (
  ante: number,
  betAmount = ELASTICITY_BET_AMOUNT
) => {
  const pool = { YES: ante, NO: ante }
  const p = 0.5

  const cpmmState = {
    pool,
    p,
    collectedFees: noFees,
  }

  const {
    cpmmState: { pool: poolY, p: pY },
  } = computeFills(cpmmState, 'YES', betAmount, undefined, [], {})
  const resultYes = getCpmmProbability(poolY, pY)

  const {
    cpmmState: { pool: poolN, p: pN },
  } = computeFills(cpmmState, 'NO', betAmount, undefined, [], {})
  const resultNo = getCpmmProbability(poolN, pN)

  // handle AMM overflow
  const safeYes = Number.isFinite(resultYes) ? resultYes : 1
  const safeNo = Number.isFinite(resultNo) ? resultNo : 0

  return logit(safeYes) - logit(safeNo)
}

const computeMultiCpmmElasticity = (
  unfilledBets: LimitBet[],
  contract: CPMMMultiContract | CPMMMultiNumeric,
  betAmount: number
) => {
  const elasticities = contract.answers.map((a) => {
    const cpmmState = {
      pool: { YES: a.poolYes, NO: a.poolNo },
      p: 0.5,
      collectedFees: noFees,
    }
    const unfilledBetsForAnswer = unfilledBets.filter(
      (b) => b.answerId === a.id
    )
    return computeBinaryCpmmElasticity(
      unfilledBetsForAnswer,
      cpmmState,
      betAmount
    )
  })
  return min(elasticities) ?? 1_000_000
}

export const calculateNewPortfolioMetrics = (
  user: User,
  contractsById: { [k: string]: Contract },
  unresolvedBets: Bet[]
) => {
  const { investmentValue, cashInvestmentValue } = computeInvestmentValue(
    unresolvedBets,
    contractsById
  )
  const loanTotal = getLoanTotal(unresolvedBets, contractsById)
  return {
    investmentValue,
    cashInvestmentValue,
    balance: user.balance,
    cashBalance: user.cashBalance,
    spiceBalance: user.spiceBalance,
    totalDeposits: user.totalDeposits,
    totalCashDeposits: user.totalCashDeposits,
    loanTotal,
    timestamp: Date.now(),
    userId: user.id,
  }
}

export const calculateMetricsByContractAndAnswer = (
  betsByContractId: Dictionary<Bet[]>,
  contractsById: Dictionary<Contract>,
  user: User,
  answersByContractId: Dictionary<Answer[]>
) => {
  return Object.entries(betsByContractId).map(([contractId, bets]) => {
    const contract: Contract = contractsById[contractId]
    const answers = answersByContractId[contractId]
    return calculateUserMetrics(contract, bets, user, answers)
  })
}

export const calculateUserMetrics = (
  contract: Contract,
  bets: Bet[],
  user: DisplayUser,
  answers: Answer[]
) => {
  // ContractMetrics will have an answerId for every answer, and a null for the overall metrics.
  const currentMetrics = getContractBetMetricsPerAnswer(contract, bets, answers)

  return currentMetrics.map((current) => {
    return removeUndefinedProps({
      ...current,
      contractId: contract.id,
      userName: user.name,
      userId: user.id,
      userUsername: user.username,
      userAvatarUrl: user.avatarUrl,
      profitAdjustment: getAdjustedProfit(
        contract,
        current.profit,
        answers,
        current.answerId
      ),
    } as ContractMetric)
  })
}

export type MarginalBet = Pick<
  Bet,
  | 'userId'
  | 'answerId'
  | 'contractId'
  | 'amount'
  | 'shares'
  | 'outcome'
  | 'createdTime'
  | 'loanAmount'
  | 'isRedemption'
  | 'probAfter'
>

export const calculateUserMetricsWithNewBetsOnly = (
  newBets: MarginalBet[],
  um: Omit<ContractMetric, 'id'>
) => {
  const needsTotalSpentBackfilled = !um.totalSpent
  const initialTotalSpent: { [key: string]: number } = um.totalSpent ?? {}
  // TODO: remove this after backfilling
  if (needsTotalSpentBackfilled) {
    if (um.hasNoShares && !um.hasYesShares) {
      initialTotalSpent.NO = um.invested
    } else if (um.hasYesShares && !um.hasNoShares) {
      initialTotalSpent.YES = um.invested
    } else {
      initialTotalSpent.NO = um.invested / 2
      initialTotalSpent.YES = um.invested / 2
    }
  }

  const initialTotalShares = { ...um.totalShares }

  const { totalSpent, totalShares } = calculateTotalSpentAndShares(
    newBets,
    initialTotalSpent,
    initialTotalShares
  )

  const invested = sum(Object.values(totalSpent))
  const loan = sumBy(newBets, (b) => b.loanAmount ?? 0) + um.loan

  const hasShares = Object.values(totalShares).some(
    (shares) => !floatingEqual(shares, 0)
  )
  const hasYesShares = (totalShares.YES ?? 0) >= 1
  const hasNoShares = (totalShares.NO ?? 0) >= 1
  const soldOut = !hasNoShares && !hasYesShares
  const maxSharesOutcome = soldOut
    ? null
    : (totalShares.NO ?? 0) > (totalShares.YES ?? 0)
    ? 'NO'
    : 'YES'
  const lastBet = orderBy(newBets, (b) => b.createdTime, 'desc')[0]
  const payout = soldOut
    ? 0
    : maxSharesOutcome
    ? totalShares[maxSharesOutcome] *
      (maxSharesOutcome === 'NO' ? 1 - lastBet.probAfter : lastBet.probAfter)
    : 0
  const totalAmountSold =
    (um.totalAmountSold ?? 0) +
    sumBy(
      newBets.filter((b) => b.isRedemption || b.amount < 0),
      (b) => -b.amount
    )
  const totalAmountInvested =
    (um.totalAmountInvested ?? 0) +
    sumBy(
      newBets.filter((b) => b.amount > 0 && !b.isRedemption),
      (b) => b.amount
    )
  const profit = payout + totalAmountSold - totalAmountInvested
  const profitPercent = floatingEqual(totalAmountInvested, 0)
    ? 0
    : (profit / totalAmountInvested) * 100

  return {
    ...um,
    loan: floatingEqual(loan, 0) ? 0 : loan,
    invested: floatingEqual(invested, 0) ? 0 : invested,
    totalShares,
    hasNoShares,
    hasYesShares,
    hasShares,
    maxSharesOutcome,
    lastBetTime: lastBet.createdTime,
    totalSpent,
    payout: floatingEqual(payout, 0) ? 0 : payout,
    totalAmountSold: floatingEqual(totalAmountSold, 0) ? 0 : totalAmountSold,
    totalAmountInvested: floatingEqual(totalAmountInvested, 0)
      ? 0
      : totalAmountInvested,
    profit,
    profitPercent,
  }
}
