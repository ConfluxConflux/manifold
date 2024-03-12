import { CPMMNumericContract } from 'common/contract'
import { filterDefined } from 'common/util/array'
import { mean, sum } from 'lodash'
import {
  getAnswerProbability,
  getInitialAnswerProbability,
} from 'common/calculate'

export const getMultiNumericAnswerMidpoints = (
  contract: CPMMNumericContract
) => {
  return contract.answers.map((a) => mean(getMultiNumericAnswerToRange(a.text)))
}

export const getNumericBucketSize = (
  min: number,
  max: number,
  buckets: number
) => (max - min) / buckets

export const getDecimalPlaces = (min: number, max: number, buckets: number) =>
  getNumericBucketSize(min, max, buckets) > 10 / buckets
    ? 0
    : Math.max(
        0,
        Math.ceil(Math.abs(Math.log10(getNumericBucketSize(min, max, buckets))))
      )

export const getMultiNumericAnswerBucketRanges = (
  min: number,
  max: number,
  buckets: number
) => {
  const rangeSize = max - min
  if (rangeSize === 0 || isNaN(buckets)) {
    return [[min, max]]
  }
  const stepSize = rangeSize / buckets
  const decimalPlaces = getDecimalPlaces(min, max, buckets)

  const ranges: [number, number][] = []
  for (let i = 0; i < buckets; i++) {
    const bucketStart = Number((min + i * stepSize).toFixed(decimalPlaces))
    const bucketEnd = Number((min + (i + 1) * stepSize).toFixed(decimalPlaces))
    ranges.push([bucketStart, bucketEnd])
  }

  return ranges
}

export const getMultiNumericAnswerBucketRangeNames = (
  min: number,
  max: number,
  buckets: number
) => {
  const ranges = getMultiNumericAnswerBucketRanges(min, max, buckets)
  return ranges.map(([min, max]) => `${min}-${max}`)
}

export const getMultiNumericAnswerToRange = (originalAnswerText: string) => {
  const answerText = originalAnswerText.trim()
  const regex = /[-+]?\d+(\.\d+)?/g
  const matches = answerText.match(regex)
  if (!matches || matches.length !== 2) {
    throw new Error('Invalid range format')
  }
  const dashCount = answerText.split('-').length - 1
  const min =
    dashCount === 1 ? Math.abs(parseFloat(matches[0])) : parseFloat(matches[0])
  const max =
    dashCount === 1 ? Math.abs(parseFloat(matches[1])) : parseFloat(matches[1])

  return [min, max]
}

export const getMultiNumericAnswerToMidpoint = (answerText: string) => {
  const [min, max] = getMultiNumericAnswerToRange(answerText)
  return (max + min) / 2
}

export function getExpectedValue(
  contract: CPMMNumericContract,
  initialOnly?: boolean
) {
  const { answers } = contract

  const answerProbabilities = filterDefined(
    answers.map((a) =>
      initialOnly
        ? getInitialAnswerProbability(contract, a)
        : getAnswerProbability(contract, a.id)
    )
  )
  const answerValues = answers.map((a) =>
    mean(getMultiNumericAnswerToRange(a.text))
  )

  return sum(answerProbabilities.map((p, i) => p * answerValues[i]))
}

export function getFormattedExpectedValue(contract: CPMMNumericContract) {
  return formatExpectedValue(getExpectedValue(contract), contract)
}

export function formatExpectedValue(
  value: number,
  contract: CPMMNumericContract
) {
  // There are a few NaN values on dev
  if (isNaN(value)) return 'N/A'
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: getDecimalPlaces(
      contract.min,
      contract.max,
      contract.answers.length
    ),
  })
  return formatter.format(value).replace('$', '')
}
