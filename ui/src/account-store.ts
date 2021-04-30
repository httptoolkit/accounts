import { makeObservable, observable, computed, flow } from 'mobx';

import {
    getLastUserData,
    getLatestUserData,
    loginEvents,
    initializeAuthUi,
    showLoginDialog,
    logOut
} from '../../module/dist/auth';
import {
    getSubscriptionPlanCode,
    SubscriptionPlan,
    SubscriptionPlanCode,
    SubscriptionPlans
} from '../../module/dist/plans';

const isSSR = typeof window === 'undefined';

initializeAuthUi({
    closeable: false
});

export class AccountStore {

    constructor() {
        makeObservable(this, {
            user: observable,
            userEmail: computed,
            isLoggedIn: computed,
            isPaidUser: computed,
            isPastDueUser: computed,
            userSubscription: computed,
            updateUser: flow.bound
        });

        // Update account data automatically on login, logout & every 10 mins
        loginEvents.on('authenticated', async () => {
            await this.updateUser();
            loginEvents.emit('user_data_loaded');
        });
        loginEvents.on('logout', this.updateUser);
        if (!isSSR) setInterval(this.updateUser, 1000 * 60 * 10);

        this.updateUser();
    }

    user = getLastUserData();

    @computed get userEmail() {
        return this.user?.email;
    }

    @computed get isLoggedIn() {
        return !!this.userEmail;
    }

    @computed private get isStatusUnexpired() {
        const subscriptionExpiry = this.user.subscription?.expiry;
        const subscriptionStatus = this.user.subscription?.status;

        const expiryMargin = subscriptionStatus === 'active'
            // If we're offline during subscription renewal, and the sub was active last
            // we checked, then we might just have outdated data, so leave extra slack.
            // This gives a week of offline usage. Should be enough, given that most HTTP
            // development needs network connectivity anyway.
            ? 1000 * 60 * 60 * 24 * 7
            : 0;

        return !!subscriptionExpiry &&
            subscriptionExpiry.valueOf() + expiryMargin > Date.now();
    }

    @computed get isPaidUser() {
        // ------------------------------------------------------------------
        // You could set this to true to become a paid user for free.
        // I'd rather you didn't. HTTP Toolkit takes time & love to build,
        // and I can't do that if it doesn't pay my bills!
        //
        // Fund open source - if you want Pro, help pay for its development.
        // Can't afford it? Get in touch: tim@httptoolkit.tech.
        // ------------------------------------------------------------------

        // If you're before the last expiry date, your subscription is valid,
        // unless it's past_due, in which case you're in a strange ambiguous
        // zone, and the expiry date is the next retry. In that case, your
        // status is unexpired, but _not_ considered as valid for Pro features.
        // Note that explicitly cancelled ('deleted') subscriptions are still
        // valid until the end of the last paid period though!
        return this.user.subscription?.status !== 'past_due' &&
            this.isStatusUnexpired;
    }

    @computed get isPastDueUser() {
        // Is the user a subscribed user whose payments are failing? Keep them
        // in an intermediate state so they can fix it (for now, until payment
        // retries fail, and their subscription cancels & expires completely).
        return this.user.subscription?.status === 'past_due' &&
            this.isStatusUnexpired;
    }

    @computed get userSubscription() {
        return this.isPaidUser || this.isPastDueUser
            ? this.user.subscription
            : undefined;
    }

    getPlanByCode(name: SubscriptionPlanCode): SubscriptionPlan | undefined {
        return SubscriptionPlans[name];
    }

    getPlanById(id: number) {
        const planCode = getSubscriptionPlanCode(id);
        return planCode
            ? this.getPlanByCode(planCode)
            : undefined;
    }

    *updateUser() {
        this.user = yield getLatestUserData();
    }

    // Re-export functions from the stateless auth module:
    showLoginDialog() {
        showLoginDialog();
    }

    logOut() {
        logOut();
    }

}