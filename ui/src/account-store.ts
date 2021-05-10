import { makeObservable, observable, computed, flow } from 'mobx';

import {
    getBillingData,
    loginEvents,
    initializeAuthUi,
    showLoginDialog,
    hideLoginDialog,
    logOut,
    BillingAccount
} from '../../module/dist/auth';
import type {
    SubscriptionPlanCode,
} from "../../module/src/types";
import {
    getSubscriptionPlanCode,
    SubscriptionPlan,
    SubscriptionPlans
} from '../../module/dist/plans';

const isSSR = typeof window === 'undefined';

initializeAuthUi({
    apiBase: process.env.API_BASE,
    closeable: false,
    rememberLastLogin: false
});

export class AccountStore {

    constructor() {
        makeObservable(this, {
            user: observable,
            isLoggedIn: computed,
            userSubscription: computed,
            updateUser: flow.bound
        });

        // Update account data automatically on login, logout & every 10 mins
        loginEvents.on('authenticated', async () => {
            await this.updateUser();
        });
        loginEvents.on('logout', this.updateUser);
        if (!isSSR) setInterval(this.updateUser, 1000 * 60 * 10);

        this.updateUser();
    }

    user: BillingAccount | undefined = undefined;

    @computed get isLoggedIn() {
        return !!this.user?.email;
    }

    @computed private get isStatusUnexpired() {
        const subscriptionExpiry = this.user?.subscription?.expiry;
        const subscriptionStatus = this.user?.subscription?.status;

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

    @computed get userSubscription() {
        return this.isStatusUnexpired
            ? this.user!.subscription
            : undefined;
    }

    *updateUser() {
        this.user = yield getBillingData();
        loginEvents.emit('user_data_loaded');
    }

    // Re-export functions from the stateless auth module:
    showLoginDialog() {
        showLoginDialog();
    }

    hideLoginDialog() {
        hideLoginDialog();
    }

    logOut() {
        logOut();
    }

}