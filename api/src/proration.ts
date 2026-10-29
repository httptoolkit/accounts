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
