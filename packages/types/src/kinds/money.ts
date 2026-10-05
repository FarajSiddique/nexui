import { z } from 'zod';

export const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const moneySchema = z.strictObject({
  amount: z.number().min(0).max(1_000_000_000),
  currency: currencySchema,
});

export type Money = z.infer<typeof moneySchema>;

// Approximate US dollars per unit, fixed for slice 1 (spec section D: "approximate").
export const USD_PER_UNIT: Readonly<Record<string, number>> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,
  CAD: 0.73,
  AUD: 0.66,
  NZD: 0.6,
  CHF: 1.12,
  CNY: 0.14,
  HKD: 0.128,
  TWD: 0.031,
  KRW: 0.00073,
  SGD: 0.74,
  THB: 0.028,
  VND: 0.00004,
  IDR: 0.000063,
  MYR: 0.21,
  PHP: 0.017,
  INR: 0.012,
  AED: 0.272,
  TRY: 0.03,
  MXN: 0.055,
  BRL: 0.18,
  ZAR: 0.054,
  SEK: 0.095,
  NOK: 0.093,
  DKK: 0.145,
  ISK: 0.0072,
  PLN: 0.25,
  CZK: 0.043,
  HUF: 0.0028,
};

/** Converts an amount into another currency, or null when either currency is unknown. */
export function convertMoney(money: Money, to: string): number | null {
  const from = USD_PER_UNIT[money.currency];
  const target = USD_PER_UNIT[to];

  if (from === undefined || target === undefined) {
    return null;
  }

  return (money.amount * from) / target;
}
