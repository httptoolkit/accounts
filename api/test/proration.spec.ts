import { expect } from 'chai';

import { getBillingPeriod } from '../src/proration.ts';

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

});
