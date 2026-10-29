import _ from 'lodash';
import moment from 'moment';

import { Interval } from '@httptoolkit/accounts';

export interface BillingPeriod {
    periodStartDate: string; // YYYY-MM-DD
    nextBillDate: string; // YYYY-MM-DD
    daysInPeriod: number;
    daysRemaining: number;
    // False when the period start had to be guessed (see below):
    isExact: boolean;
}

/**
 * Paddle pro-rates mid-term quantity increases by the whole days left in the current
 * billing period, so each added license costs (days remaining / days in period) of its
 * full price. Both are calendar-based, so period length varies: a year from the 20th of
 * March 2023 is 366 days, while a month from the 6th of July 2023 is 31.
 */
export function getBillingPeriod(
    nextBillDate: string,
    interval: Interval,
    now: number = Date.now()
): BillingPeriod {
    if (interval === 'perpetual') throw new Error('Cannot pro-rate a perpetual subscription');

    const billDate = moment.utc(nextBillDate, 'YYYY-MM-DD', true);
    if (!billDate.isValid()) throw new Error(`Invalid next bill date: ${nextBillDate}`);

    // A bill on the last day of a month may have been moved there from a later billing day
    // that doesn't exist in that month (e.g. the 31st billing on the 28th of February), so
    // the previous bill could have been as late as the end of its own month. We assume it
    // was, giving the shortest possible period, so estimates err on the high side.
    const isMonthEnd = billDate.date() === billDate.daysInMonth();
    const sameDayLastPeriod = billDate.clone().subtract(1, interval === 'annual' ? 'year' : 'month');
    const periodStart = isMonthEnd
        ? sameDayLastPeriod.endOf('month').startOf('day')
        : sameDayLastPeriod;
    const today = moment.utc(now).startOf('day');

    const daysInPeriod = billDate.diff(periodStart, 'days');

    return {
        periodStartDate: periodStart.format('YYYY-MM-DD'),
        nextBillDate: billDate.format('YYYY-MM-DD'),
        daysInPeriod,
        // Clamped, so that stale data can never produce a negative or >100% quote:
        daysRemaining: _.clamp(billDate.diff(today, 'days'), 0, daysInPeriod),
        isExact: !isMonthEnd
    };
}

// An upgrade we've requested from Paddle, which it bills immediately as a pro-rated charge:
export interface RequestedUpgrade {
    from: number;
    to: number;
    requestedAt: number;
}

export interface ProratedChargeCheck {
    netAmount: number;
    expectedAmount: number | undefined; // Undefined if we didn't request this change
    daysRemaining: number;
    daysInPeriod: number;
    matchesExpectation: boolean;
}

// Charges within this of a full period are just normal renewals, not pro-rated changes:
const FULL_PERIOD_TOLERANCE = 0.01;

// Paddle charges whole minor units (e.g. pence), so we compare in those:
const toMinorUnits = (amount: number, currency: string) => Math.round(amount * Math.pow(10,
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
));

/**
 * Checks a payment that isn't for a full period against the upgrade we requested. Paddle
 * calculates these charges itself, but we quote them to customers beforehand, so any
 * mismatch means our quotes don't match what customers are really charged.
 *
 * Returns undefined for ordinary renewals, which have nothing to check, and for periods
 * whose start we can only estimate, where a mismatch wouldn't tell us anything.
 */
export function checkProratedCharge(payment: {
    netAmount: number,
    currency: string,
    unitPrice: number,
    quantity: number,
    nextBillDate: string,
    interval: Interval
}, upgrade: RequestedUpgrade | undefined, now: number = Date.now()): ProratedChargeCheck | undefined {
    const fullPeriodAmount = payment.unitPrice * payment.quantity;
    if (!fullPeriodAmount) return undefined;

    const chargedShare = payment.netAmount / fullPeriodAmount;
    if (Math.abs(chargedShare - 1) <= FULL_PERIOD_TOLERANCE) return undefined;

    // Paddle pro-rates from the day the change was made:
    const { daysRemaining, daysInPeriod, isExact } = getBillingPeriod(
        payment.nextBillDate,
        payment.interval,
        upgrade?.requestedAt ?? now
    );
    if (!isExact) return undefined;
    if (!daysRemaining) return undefined; // Nothing to pro-rate

    const expectedAmount = upgrade && upgrade.to === payment.quantity
        ? payment.unitPrice * (upgrade.to - upgrade.from) * (daysRemaining / daysInPeriod)
        : undefined;

    return {
        netAmount: payment.netAmount,
        expectedAmount,
        daysRemaining,
        daysInPeriod,
        // Deliberately strict - any difference at all means we've misunderstood Paddle's maths:
        matchesExpectation: expectedAmount !== undefined &&
            toMinorUnits(payment.netAmount, payment.currency) ===
                toMinorUnits(expectedAmount, payment.currency)
    };
}
