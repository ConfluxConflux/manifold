import { Bet } from 'common/bet'
import { User } from 'common/user'
import { Visibility } from 'common/contract'
import { QuestType } from 'common/quest'
import { Answer } from 'common/answer'
export type AnyBalanceChangeType =
  | BalanceChange
  | BetBalanceChange
  | TxnBalanceChange

export type BalanceChange = {
  key: string
  amount: number
  type: string
  createdTime: number
}

type MinimalContract = {
  question: string
  slug?: string
  visibility: Visibility
  creatorUsername: string
}

type CustomBalanceChange = Omit<BalanceChange, 'type'>
export const BET_BALANCE_CHANGE_TYPES = [
  'create_bet',
  'sell_shares',
  'redeem_shares',
  'fill_bet',
  'loan_payment',
] as const

export type BetBalanceChange = CustomBalanceChange & {
  type: (typeof BET_BALANCE_CHANGE_TYPES)[number]
  bet: Pick<Bet, 'outcome' | 'shares'>
  answer: Pick<Answer, 'text' | 'id'> | undefined
  contract: MinimalContract
}

export const TXN_BALANCE_CHANGE_TYPES = [
  'UNIQUE_BETTOR_BONUS',
  'BETTING_STREAK_BONUS',
  'SIGNUP_BONUS',
  'CONTRACT_RESOLUTION_PAYOUT',
  'CONTRACT_UNDO_RESOLUTION_PAYOUT',
  'PRODUCE_SPICE',
  'CONTRACT_UNDO_PRODUCE_SPICE',
  'CONSUME_SPICE',
  'MARKET_BOOST_REDEEM',
  'MARKET_BOOST_CREATE',
  'QUEST_REWARD',
  'LEAGUE_PRIZE',
  'BOUNTY_POSTED',
  'BOUNTY_AWARDED',
  'CREATE_CONTRACT_ANTE',
  'MANA_PAYMENT',
  'LOAN',
  'STARTING_BALANCE',
  'ADD_SUBSIDY',
  'CHARITY',
] as const

export type TxnType = (typeof TXN_BALANCE_CHANGE_TYPES)[number]
export type TxnBalanceChange = CustomBalanceChange & {
  type: TxnType
  contract?: MinimalContract
  questType?: QuestType
  user?: Pick<User, 'username' | 'name'>
  charity?: { name: string; slug: string }
}

export const isBetChange = (
  change: AnyBalanceChangeType
): change is BetBalanceChange => 'bet' in change

export const isTxnChange = (
  change: AnyBalanceChangeType
): change is TxnBalanceChange =>
  TXN_BALANCE_CHANGE_TYPES.includes(change.type as any)

export const isRawBalanceChange = (
  change: AnyBalanceChangeType
): change is BalanceChange => 'key' in change
