import * as _ from 'lodash';
import { makeObservable, observable, computed, flow, when } from 'mobx';
import { delay, asErrorLike } from "@httptoolkit/util";

import { reportError } from './errors';

import {
    getBillingData,
    updateTeamMembers,
    updateTeamSize,
    getTeamSizeQuote,
    cancelSubscription,
    logOut,
    BillingAccount,
    TeamSizeQuote
} from '@httptoolkit/accounts';

export class AccountStore {

    constructor() {
        makeObservable(this, {
            user: observable,
            isMaybeLoggedIn: observable,
            isLoggedIn: computed,
            isAccountUpdateInProcess: observable,
            userSubscription: computed,
            teamSizeQuote: observable,
            isLoadingTeamSizeQuote: observable,
            teamSizeQuoteError: observable,
            updateUser: flow.bound
        });

        // Update account data now & automatically every 10 mins
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
        } catch (e: any) {
            console.log("Failed to load user data");
            reportError(e);
            this.user = undefined;
        }

        // Once we've got the user data (successfully or not) we now
        // know for sure whether we're logged in.
        this.isMaybeLoggedIn = this.isLoggedIn
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

            // The minimum team size depends on who's assigned a license:
            this.invalidateTeamSizeQuote();
        } catch (e) {
            // Undo our optimistic update:
            this.user!.teamMembers = originalTeamMembers;
            alert(e);
            throw e;
        }
    }).bind(this);

    // Bindings to link the account store to the React login modal:
    login = flow(function* (this: AccountStore) {
        if (!this.isLoggedIn) {
            yield when(() => this.isLoggedIn);
        }
    }).bind(this);

    finalizeLogin = flow(function* (this: AccountStore) {
        yield this.updateUser();
    }).bind(this);

    logOut = flow(function* (this: AccountStore) {
        if (this.isLoggedIn) {
            yield logOut();
            yield this.updateUser();
        }
    }).bind(this);

    // Set when we know a cancel is processing elsewhere:
    isAccountUpdateInProcess = false;

    get canManageSubscription() {
        return !!this.userSubscription?.canManageSubscription;
    }

    get canUpdateTeamSize() {
        return !!this.userSubscription?.canUpdateTeamSize;
    }

    // Pricing for team size changes. Loaded lazily, since it needs a (slow) payment
    // provider lookup that's wasted on everybody who never opens the controls.
    teamSizeQuote: TeamSizeQuote | undefined = undefined;
    isLoadingTeamSizeQuote = false;
    teamSizeQuoteError: string | undefined = undefined;

    private teamSizeQuoteGeneration = 0;

    invalidateTeamSizeQuote() {
        this.teamSizeQuoteGeneration += 1;
        this.teamSizeQuote = undefined;
    }

    loadTeamSizeQuote = flow(function * (this: AccountStore, options: { refresh?: boolean } = {}) {
        // Quoting needs a slow payment provider lookup, so we keep the result until
        // something invalidates it, rather than re-fetching each time the UI asks.
        if (this.isLoadingTeamSizeQuote || (this.teamSizeQuote && !options.refresh)) return;

        const generation = this.teamSizeQuoteGeneration;
        this.isLoadingTeamSizeQuote = true;
        this.teamSizeQuoteError = undefined;
        try {
            const quote: TeamSizeQuote = yield getTeamSizeQuote();
            if (generation === this.teamSizeQuoteGeneration) this.teamSizeQuote = quote;
        } catch (e) {
            const error = asErrorLike(e);
            console.log(error);
            reportError(`Team size quote failed: ${error.message}`);
            this.teamSizeQuoteError = error.message;
        } finally {
            this.isLoadingTeamSizeQuote = false;
        }
    }).bind(this);

    updateTeamSize = flow(function * (this: AccountStore, newTeamSize: number) {
        try {
            this.isAccountUpdateInProcess = true;
            const isUpgrade = newTeamSize > (this.user?.subscription?.quantity ?? 0);

            yield updateTeamSize(newTeamSize);

            if (isUpgrade) {
                // Paddle bills & applies the extra licenses now, then tells us by
                // webhook, so we poll until our own data catches up.
                const confirmed = yield this.waitForUserUpdate(() =>
                    this.user?.subscription?.quantity === newTeamSize
                );

                if (!confirmed) {
                    // The update was accepted, we just never saw it land. Report it,
                    // rather than silently showing the old count as if nothing happened.
                    reportError(`Team size update to ${newTeamSize} was not confirmed in time`);
                }
            } else {
                // Downgrades are deferred to the next billing cycle, so there's no
                // change to wait for - just pick up whatever the API reports now.
                yield this.updateUser();
            }

            this.invalidateTeamSizeQuote();
        } catch (e) {
            const error = asErrorLike(e);
            console.log(error);
            reportError(`Team size update failed: ${error.message}`);
            alert(error.message);
            throw e;
        } finally {
            this.isAccountUpdateInProcess = false;
        }
    }).bind(this);

    cancelSubscription = flow(function * (this: AccountStore) {
        try {
            this.isAccountUpdateInProcess = true;
            yield cancelSubscription();
            const confirmed = yield this.waitForUserUpdate(() =>
                !this.user?.subscription ||
                this.user?.subscription.status === 'deleted'
            );

            if (confirmed) console.log('Subscription cancellation confirmed');
            else reportError('Subscription cancellation was not confirmed in time');
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
        // Bounded, so that an upstream change we never hear about leaves a stale spinner
        // rather than polling for the lifetime of the page:
        const giveUpAt = Date.now() + POLL_TIMEOUT_MS;

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
        while (!completedCheck() && Date.now() < giveUpAt) {
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

        // False means we gave up waiting, not that the change failed - callers decide
        // how much to trust their own data at that point:
        return completedCheck();
    }).bind(this);

}

// How long we'll poll for our own data to reflect a change made upstream:
const POLL_TIMEOUT_MS = 1000 * 60;

// Used as an id for team members who are added optimistically, while the request runs
export const PLACEHOLDER_ID_PREFIX = "placeholder-member-id-";
let placeholderId = 0;