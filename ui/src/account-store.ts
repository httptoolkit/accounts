import * as _ from 'lodash';
import { makeObservable, observable, computed, flow } from 'mobx';
import { delay } from "@httptoolkit/util";

import { reportError } from './errors';

import {
    getBillingData,
    updateTeamMembers,
    cancelSubscription,
    loginEvents,
    initializeAuthUi,
    showLoginDialog,
    hideLoginDialog,
    logOut,
    BillingAccount
} from '@httptoolkit/accounts';

export class AccountStore {

    constructor() {
        makeObservable(this, {
            user: observable,
            isMaybeLoggedIn: observable,
            isLoggedIn: computed,
            isAccountUpdateInProcess: observable,
            userSubscription: computed,
            updateUser: flow.bound
        });

        // Update account data automatically on login, logout & every 10 mins
        loginEvents.on('authenticated', flow(function * (this: AccountStore) {
            this.isMaybeLoggedIn = true;
            yield this.updateUser();
        }.bind(this)));
        loginEvents.on('logout', this.updateUser);

        initializeAuthUi({
            closeable: false,
            rememberLastLogin: false
        });

        setInterval(this.updateUser, 1000 * 60 * 10);

        this.updateUser();
    }

    user: BillingAccount | undefined = undefined;

    // Defaults to true, updated to match isLoggedIn after the first
    // user update that completes.
    isMaybeLoggedIn = true;

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
        try {
            this.user = yield getBillingData();
            loginEvents.emit('user_data_loaded');
        } catch (e: any) {
            console.log("Failed to load user data");
            reportError(e);
            this.user = undefined;
        }

        // Once we've got the user data (successfully or not) we now
        // know for sure whether we're logged in.
        this.isMaybeLoggedIn = this.isLoggedIn
    }

    // Re-export functions from the stateless auth module:
    showLoginDialog() {
        showLoginDialog();
    }

    hideLoginDialog() {
        hideLoginDialog();
    }

    updateTeamMembers = flow(function * (
        this: AccountStore,
        idsToRemove: string[],
        emailsToAdd: string[]
    ) {
        const originalTeamMembers = _.cloneDeep(this.user!.teamMembers);

        // Optimistically update our data model
        this.user!.teamMembers = this.user!.teamMembers?.filter(
            member => !idsToRemove.includes(member.id)
        ).concat(emailsToAdd.map((email) =>
            ({ id: PLACEHOLDER_ID_PREFIX + placeholderId++, name: email, locked: true })
        ));

        try {
            yield updateTeamMembers(idsToRemove, emailsToAdd);
            yield delay(1000); // Wait to reduce race conditions during updates here
            yield this.updateUser(); // Reload the billing data after changes
        } catch (e) {
            // Undo our optimistic update:
            this.user!.teamMembers = originalTeamMembers;
            alert(e);
            throw e;
        }
    }).bind(this)

    logOut() {
        logOut();
    }

    // Set when we know a cancel is processing elsewhere:
    isAccountUpdateInProcess = false;

    get canManageSubscription() {
        return !!this.userSubscription?.canManageSubscription;
    }

    cancelSubscription = flow(function * (this: AccountStore) {
        try {
            this.isAccountUpdateInProcess = true;
            yield cancelSubscription();
            yield this.waitForUserUpdate(() =>
                !this.user?.subscription ||
                this.user?.subscription.status === 'deleted'
            );
            console.log('Subscription cancellation confirmed');
        } catch (e: any) {
            console.log(e);
            reportError(`Subscription cancellation failed: ${e.message || e}`);
            throw e;
        } finally {
            this.isAccountUpdateInProcess = false;
        }
    }).bind(this);

    private waitForUserUpdate = flow(function * (
        this: AccountStore,
        completedCheck: () => boolean
    ) {
        let focused = true;

        const setFocused = () => {
            focused = true;
            this.updateUser();
        };

        const setUnfocused = () => {
            focused = false;
        };

        window.addEventListener('focus', setFocused);
        window.addEventListener('blur', setUnfocused);

        // Keep checking the user's subscription data at intervals, whilst other processes
        // (update from payment provider) complete elsewhere...
        yield this.updateUser();
        let ticksSinceCheck = 0;
        while (!completedCheck()) {
            yield delay(1000);
            ticksSinceCheck += 1;

            if (focused || ticksSinceCheck > 10) {
                // Every 10s while blurred or 500ms while focused, check the user data:
                ticksSinceCheck = 0;
                yield this.updateUser();
            }
        }
        window.removeEventListener('focus', setFocused);
        window.removeEventListener('blur', setUnfocused);
    }).bind(this);

}

// Used as an id for team members who are added optimistically, while the request runs
export const PLACEHOLDER_ID_PREFIX = "placeholder-member-id-";
let placeholderId = 0;