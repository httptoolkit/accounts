import { expect } from 'chai';

import { getBillingPeriod, checkProratedCharge } from '../src/proration.ts';

describe('Proration', () => {

    describe('billing periods', () => {

        it("counts a leap year annual period as 366 days", () => {
            // Annual renewal on the 20th of March 2023, upgrading from the 26th of June:
            const period = getBillingPeriod(
                '2024-03-20',
                'annual',
                Date.UTC(2023, 5, 26)
            );

            expect(period.periodStartDate).to.equal('2023-03-20');
            expect(period.daysInPeriod).to.equal(366);
            expect(period.daysRemaining).to.equal(366 - 98);
        });

        it("counts a non-leap annual period as 365 days", () => {
            const period = getBillingPeriod(
                '2023-03-20',
                'annual',
                Date.UTC(2022, 5, 26)
            );

            expect(period.periodStartDate).to.equal('2022-03-20');
            expect(period.daysInPeriod).to.equal(365);
        });

        it("counts a 31 day month, upgrading mid-month", () => {
            // Monthly renewal on the 6th of July 2023, upgrading on the 18th:
            const period = getBillingPeriod(
                '2023-08-06',
                'monthly',
                Date.UTC(2023, 6, 18)
            );

            expect(period.periodStartDate).to.equal('2023-07-06');
            expect(period.daysInPeriod).to.equal(31);
            expect(period.daysRemaining).to.equal(19);
        });

        it("counts a 31 day month, upgrading just after renewal", () => {
            // Monthly renewal on the 6th of May 2023, upgrading on the 8th:
            const period = getBillingPeriod(
                '2023-06-06',
                'monthly',
                Date.UTC(2023, 4, 8)
            );

            expect(period.periodStartDate).to.equal('2023-05-06');
            expect(period.daysInPeriod).to.equal(31);
            expect(period.daysRemaining).to.equal(29);
        });

        it("counts a short month correctly", () => {
            const period = getBillingPeriod(
                '2023-03-10',
                'monthly',
                Date.UTC(2023, 1, 20)
            );

            expect(period.periodStartDate).to.equal('2023-02-10');
            expect(period.daysInPeriod).to.equal(28);
            expect(period.daysRemaining).to.equal(18);
        });

        it("charges the full period on the renewal day itself", () => {
            const period = getBillingPeriod(
                '2023-08-06',
                'monthly',
                Date.UTC(2023, 6, 6)
            );

            expect(period.daysRemaining).to.equal(period.daysInPeriod);
        });

        it("charges nothing on the day of the next bill", () => {
            const period = getBillingPeriod(
                '2023-08-06',
                'monthly',
                Date.UTC(2023, 7, 6)
            );

            expect(period.daysRemaining).to.equal(0);
        });

        it("clamps overdue subscriptions to zero, rather than going negative", () => {
            const period = getBillingPeriod(
                '2023-08-06',
                'monthly',
                Date.UTC(2023, 8, 20)
            );

            expect(period.daysRemaining).to.equal(0);
        });

        it("clamps to a full period if the bill date is further away than one period", () => {
            const period = getBillingPeriod(
                '2023-08-06',
                'monthly',
                Date.UTC(2023, 0, 1)
            );

            expect(period.daysRemaining).to.equal(period.daysInPeriod);
        });

        it("assumes the latest possible start for a monthly bill at a month end", () => {
            // Billing on the 31st, so moved to the 28th in February:
            const period = getBillingPeriod('2023-02-28', 'monthly', Date.UTC(2023, 1, 10));

            expect(period.periodStartDate).to.equal('2023-01-31');
            expect(period.daysInPeriod).to.equal(28);
            expect(period.isExact).to.equal(false);
        });

        it("assumes the latest possible start for a 30 day month end", () => {
            const period = getBillingPeriod('2023-04-30', 'monthly', Date.UTC(2023, 3, 10));

            expect(period.periodStartDate).to.equal('2023-03-31');
            expect(period.daysInPeriod).to.equal(30);
        });

        it("assumes a leap day start for an annual bill at the end of February", () => {
            const period = getBillingPeriod('2025-02-28', 'annual', Date.UTC(2024, 5, 1));

            expect(period.periodStartDate).to.equal('2024-02-29');
            expect(period.daysInPeriod).to.equal(365);
        });

        it("knows the exact start when the bill isn't at a month end", () => {
            // Billing on the 30th, so moved to the 28th in February but not in March:
            const period = getBillingPeriod('2023-03-30', 'monthly', Date.UTC(2023, 2, 10));

            expect(period.periodStartDate).to.equal('2023-02-28');
            expect(period.daysInPeriod).to.equal(30);
            expect(period.isExact).to.equal(true);
        });

        it("rejects perpetual subscriptions", () => {
            expect(() =>
                getBillingPeriod('2023-08-06', 'perpetual', Date.UTC(2023, 6, 18))
            ).to.throw('Cannot pro-rate a perpetual subscription');
        });

        it("rejects unparseable bill dates", () => {
            expect(() =>
                getBillingPeriod('not-a-date', 'monthly', Date.UTC(2023, 6, 18))
            ).to.throw('Invalid next bill date');
        });

    });

    describe('pro-rated charge checks', () => {

        // A real Team annual subscription: 7 licenses at 28.74 net each, renewing on
        // the 1st of July. 100 of its 365 days remain on the 23rd of March.
        const UNIT_PRICE = 28.74;
        const NEXT_BILL = '2027-07-01';
        const UPGRADE_DAY = Date.UTC(2027, 2, 23);
        const TWO_LICENSE_CHARGE = 2 * UNIT_PRICE * (100 / 365);

        const upgrade = (from: number, to: number, requestedAt = UPGRADE_DAY) =>
            ({ from, to, requestedAt });

        const check = (
            netAmount: number,
            quantity: number,
            requested: ReturnType<typeof upgrade> | undefined,
            currency = 'USD'
        ) => checkProratedCharge({
            netAmount,
            currency,
            unitPrice: UNIT_PRICE,
            quantity,
            nextBillDate: NEXT_BILL,
            interval: 'annual'
        }, requested, UPGRADE_DAY);

        it("ignores an ordinary full-period renewal", () => {
            expect(check(UNIT_PRICE * 7, 7, undefined)).to.equal(undefined);
        });

        it("ignores a renewal that's a rounded cent out", () => {
            expect(check((UNIT_PRICE * 7) + 0.01, 7, undefined)).to.equal(undefined);
        });

        it("accepts the exact charge for the requested upgrade", () => {
            const result = check(TWO_LICENSE_CHARGE, 9, upgrade(7, 9))!;

            expect(result.daysRemaining).to.equal(100);
            expect(result.daysInPeriod).to.equal(365);
            expect(result.expectedAmount).to.be.closeTo(TWO_LICENSE_CHARGE, 0.0001);
            expect(result.matchesExpectation).to.equal(true);
        });

        it("accepts the expected charge rounded to whole cents", () => {
            const result = check(Math.round(TWO_LICENSE_CHARGE * 100) / 100, 9, upgrade(7, 9))!;
            expect(result.matchesExpectation).to.equal(true);
        });

        it("flags a charge that's a single cent out", () => {
            const result = check(Math.round(TWO_LICENSE_CHARGE * 100) / 100 - 0.01, 9, upgrade(7, 9))!;
            expect(result.matchesExpectation).to.equal(false);
        });

        it("accepts rounding to whole units in currencies without minor units", () => {
            const exactYen = 2 * 3000 * (100 / 365);
            const result = checkProratedCharge({
                netAmount: Math.round(exactYen),
                currency: 'JPY',
                unitPrice: 3000,
                quantity: 9,
                nextBillDate: NEXT_BILL,
                interval: 'annual'
            }, upgrade(7, 9), UPGRADE_DAY)!;

            expect(result.matchesExpectation).to.equal(true);
        });

        it("flags a charge pro-rated over a single day more", () => {
            const result = check(2 * UNIT_PRICE * (101 / 365), 9, upgrade(7, 9))!;
            expect(result.matchesExpectation).to.equal(false);
        });

        it("flags a charge for a different number of licenses", () => {
            const result = check(3 * UNIT_PRICE * (100 / 365), 9, upgrade(7, 9))!;
            expect(result.matchesExpectation).to.equal(false);
        });

        it("counts days from when the upgrade was requested, not when the payment arrives", () => {
            const result = checkProratedCharge({
                netAmount: TWO_LICENSE_CHARGE,
                currency: 'USD',
                unitPrice: UNIT_PRICE,
                quantity: 9,
                nextBillDate: NEXT_BILL,
                interval: 'annual'
            }, upgrade(7, 9), UPGRADE_DAY + 1000 * 60 * 60 * 24 * 3)!;

            expect(result.daysRemaining).to.equal(100);
            expect(result.matchesExpectation).to.equal(true);
        });

        it("flags a pro-rated charge with no requested upgrade", () => {
            const result = check(TWO_LICENSE_CHARGE, 9, undefined)!;

            expect(result.expectedAmount).to.equal(undefined);
            expect(result.matchesExpectation).to.equal(false);
        });

        it("flags a pro-rated charge for a different upgrade than requested", () => {
            const result = check(TWO_LICENSE_CHARGE, 9, upgrade(7, 10))!;

            expect(result.expectedAmount).to.equal(undefined);
            expect(result.matchesExpectation).to.equal(false);
        });

        it("doesn't check charges in periods with a guessed start", () => {
            expect(checkProratedCharge({
                netAmount: 5,
                currency: 'USD',
                unitPrice: UNIT_PRICE,
                quantity: 9,
                nextBillDate: '2027-06-30',
                interval: 'annual'
            }, upgrade(7, 9), UPGRADE_DAY)).to.equal(undefined);
        });

        it("ignores charges on the day of renewal, when there's nothing to pro-rate", () => {
            expect(check(5, 9, upgrade(7, 9, Date.UTC(2027, 6, 1)))).to.equal(undefined);
        });

    });

});
