import DecimalJs from 'decimal.js';

import { PRECISION } from '../constants/trading';

DecimalJs.set({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP });

export const D = (value: DecimalJs.Value): DecimalJs => new DecimalJs(value);

export const roundAmount = (value: DecimalJs.Value): DecimalJs =>
  D(value).toDecimalPlaces(PRECISION.amount, DecimalJs.ROUND_HALF_UP);

export const roundShares = (value: DecimalJs.Value): DecimalJs =>
  D(value).toDecimalPlaces(PRECISION.shares, DecimalJs.ROUND_HALF_UP);

export const roundPrice = (value: DecimalJs.Value): DecimalJs =>
  D(value).toDecimalPlaces(PRECISION.price, DecimalJs.ROUND_HALF_UP);

export const roundAvgPrice = (value: DecimalJs.Value): DecimalJs =>
  D(value).toDecimalPlaces(PRECISION.avgPrice, DecimalJs.ROUND_HALF_UP);

export const isPositive = (value: DecimalJs.Value): boolean => D(value).gt(0);
