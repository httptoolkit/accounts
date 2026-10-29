import { expect } from 'chai';

import {
    TeamSizeQuote,
    getProratedUpgradeCost,
    getRenewalCost
} from '../src/index';

const quoteFor = (period: {
    daysRemaining: number,
    daysInPeriod: number
}): TeamSizeQuote => ({
    currency: 'USD',
    unitPrice: 100,
    currentQuantity: 5,
    renewalQuantity: 5,
    minQuantity: 1,
    maxQuantity: 500,
    interval: 'annual',
    nextBillDate: '2024-03-20',
    ...period
});

describe('Team size pricing', () => {

    describe('pro-rated upgrades', () => {

        it("charges the documented share for a mid-year annual upgrade", () => {
            // Annual renewal on the 20th of March 2023, upgrading from the 26th of June:
            const quote = quoteFor({ daysRemaining: 366 - 98, daysInPeriod: 366 });

            expect(getProratedUpgradeCost(quote, 6)).to.equal(((366 - 98) / 366) * 100);
        });

        it("charges the documented share for a mid-month upgrade", () => {
            // Monthly renewal on the 6th of July 2023, upgrading on the 18th:
            const quote = quoteFor({ daysRemaining: 19, daysInPeriod: 31 });

            expect(getProratedUpgradeCost(quote, 6)).to.equal((19 / 31) * 100);
        });

        it("charges the documented share just after a renewal", () => {
            // Monthly renewal on the 6th of May 2023, upgrading on the 8th:
            const quote = quoteFor({ daysRemaining: 29, daysInPeriod: 31 });

            expect(getProratedUpgradeCost(quote, 6)).to.equal((29 / 31) * 100);
        });

        it("charges per added license", () => {
            const quote = quoteFor({ daysRemaining: 19, daysInPeriod: 31 });

            expect(getProratedUpgradeCost(quote, 8)).to.equal(3 * (19 / 31) * 100);
        });

        it("charges nothing for a downgrade", () => {
            const quote = quoteFor({ daysRemaining: 19, daysInPeriod: 31 });

            expect(getProratedUpgradeCost(quote, 3)).to.equal(0);
        });

        it("charges nothing for no change", () => {
            const quote = quoteFor({ daysRemaining: 19, daysInPeriod: 31 });

            expect(getProratedUpgradeCost(quote, 5)).to.equal(0);
        });

        it("charges the full price when upgrading on the renewal day", () => {
            const quote = quoteFor({ daysRemaining: 31, daysInPeriod: 31 });

            expect(getProratedUpgradeCost(quote, 6)).to.equal(100);
        });

    });

    describe('renewal costs', () => {

        it("bills every license at the full price, for upgrades and downgrades alike", () => {
            const quote = quoteFor({ daysRemaining: 19, daysInPeriod: 31 });

            expect(getRenewalCost(quote, 8)).to.equal(800);
            expect(getRenewalCost(quote, 3)).to.equal(300);
        });

    });

});
