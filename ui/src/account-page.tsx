import * as _ from 'lodash';
import * as React from 'react';
import { observer } from 'mobx-react-lite';
import {
    formatDistanceStrict, format, formatDistanceToNow
} from 'date-fns';

import { getPlanByCode, SubscriptionPlans } from '../../module/src/plans';

import { styled, media } from './styles';
import { Icon } from './icons';

import { AccountStore } from './account-store';

import { Button, ButtonLink } from './inputs';
import { Transactions, PlaceholderTransactions } from './account-transactions';
import { TeamMembers } from './account-team-members';

const PageContainer = styled.main`
    position: relative;
    padding: 40px 0;

    ${media.desktop`
        margin: 0 auto;
        width: 800px;
    `}

    ${media.mobileOrTablet`
        width: auto;
        margin: 0 20px;
    `}
`;

const PageHeading = styled.h1`
    font-size: ${p => p.theme.loudHeadingSize};
    font-weight: bold;
`;

const LogOutButton = styled(Button)`
    ${media.desktop`
        position: absolute;
        top: 40px;
        right: 0;
    `}

    ${media.mobileOrTablet`
        margin-top: 20px;
    `}
`;

const AccountSection = styled.section`
    margin-top: 40px;
`;

const SectionHeading = styled.h2`
    font-size: ${p => p.theme.largeHeadingSize};
    margin-bottom: 20px;
`;

const ContentLabel = styled.h3`
    text-transform: uppercase;
    opacity: ${p => p.theme.lowlightTextOpacity};
    display: inline-block;
`;

const ContentGrid = styled.div`
    margin-top: 10px;

    display: grid;
    grid-template-columns: fit-content(40%) 1fr;
    grid-gap: 10px;
`;

const ContentValue = styled.p`
    display: inline-block;
`;

const Explanation = styled.p`
    font-style: italic;
    margin-top: 10px;
`;

const AccountControls = styled.div`
    margin-top: 20px;
    display: flex;
    flex-direction: row;

    > :not(:last-child) {
        margin-right: 10px;
    }
`;

const AccountUpdateSpinner = styled(Icon).attrs(() => ({
    icon: ['fac', 'spinner-arc'],
    spin: true
}))`
    margin: 0 0 0 10px;
`;

export const AccountPage = observer((props: {
    accountStore: AccountStore
}) => {
    const { accountStore } = props;

    const {
        user,
        userSubscription,
        updateTeamMembers,
        isAccountUpdateInProcess,
        canManageSubscription,
        cancelSubscription,
        logOut
    } = accountStore;

    const sub = userSubscription;
    if (!user || !sub) {
        alert(`No subscription found for ${
            user?.email ?? 'this user'
        }`);
        logOut();
        window.location.reload();
        return null;
    }

    const confirmSubscriptionCancellation = () => {
        const subscription = userSubscription;
        if (!subscription) {
            throw new Error("Can't cancel without a subscription");
        }

        const planName = SubscriptionPlans[subscription.plan].name;

        let cancelEffect: string;

        if (subscription.status === 'active') {
            cancelEffect = `It will remain usable until it expires in ${
                formatDistanceToNow(subscription.expiry)
            } but will not renew.`;
        } else if (subscription.status === 'past_due') {
            cancelEffect = 'No more renewals will be attempted and it will deactivate immediately.';
        } else {
            throw new Error(`Cannot cancel subscription with status ${subscription.status}`);
        }

        const confirmed = confirm([
            `This will cancel your HTTP Toolkit ${planName} subscription.`,
            cancelEffect,
            "Are you sure?"
        ].join('\n\n'));

        if (!confirmed) return;

        cancelSubscription().catch((e) => {
            alert(e.message);
        });
    };

    return <PageContainer>
        <PageHeading>Your Account</PageHeading>

        <LogOutButton onClick={logOut}>
            Log out
        </LogOutButton>

        <AccountSection>
            <SectionHeading>Subscription</SectionHeading>

            <ContentGrid>
                <ContentLabel>Email</ContentLabel>
                <ContentValue>{ user.email }</ContentValue>

                <ContentLabel>
                    Plan
                </ContentLabel>
                <ContentValue>
                    { getPlanByCode(sub.plan)?.name ?? 'Unknown' }
                </ContentValue>

                { user.teamMembers && <>
                    <ContentLabel>
                        Licenses
                    </ContentLabel>
                    <ContentValue>
                        { sub.quantity }
                    </ContentValue>
                </> }

                <ContentLabel>
                    Status
                </ContentLabel>
                <ContentValue>
                    {
                        ({
                            'active': 'Active',
                            'trialing': 'Active (trial)',
                            'past_due': 'Past due',
                            'deleted': 'Cancelled'
                        }[sub.status]) || 'Unknown'
                    }
                    { isAccountUpdateInProcess &&
                        <AccountUpdateSpinner />
                    }
                </ContentValue>

                <ContentLabel>
                    {
                        ({
                            'active': 'Renews',
                            'trialing': 'Trial ends',
                            'past_due': 'Next payment attempt',
                            'deleted': 'Ends',
                        }[sub.status]) || 'Current period ends'
                    }
                </ContentLabel>
                <ContentValue>
                    {
                        formatDistanceStrict(sub.expiry, new Date(), {
                            addSuffix: true
                        })
                    } ({
                        format(sub.expiry, "do 'of' MMMM yyyy")
                    })
                </ContentValue>
            </ContentGrid>

            {
                sub.status === 'past_due' && <Explanation>
                    Your subscription payment failed, and will be reattempted shortly.
                    If retried payments continue to fail then your subscription will be
                    cancelled automatically.
                </Explanation>
            }

            { canManageSubscription &&
                <AccountControls>
                    { sub.updateBillingDetailsUrl &&
                        <ButtonLink
                            href={sub.updateBillingDetailsUrl}
                            target='_blank'
                            rel='noreferrer noopener'
                        >
                            Update billing details
                        </ButtonLink>
                    }
                    <Button
                        onClick={confirmSubscriptionCancellation}
                    >
                        Cancel subscription
                    </Button>
                </AccountControls>
            }
        </AccountSection>

        { sub && user.teamMembers && <AccountSection>
            <SectionHeading>Team</SectionHeading>
            <TeamMembers
                licenseCount={sub.quantity}
                lockedLicenses={user.lockedLicenseExpiries ?? []}
                teamMembers={user.teamMembers}
                updateTeam={updateTeamMembers}
            />
        </AccountSection> }

        <AccountSection>
            <SectionHeading>Invoices</SectionHeading>
            { user.transactions === null
                ? <Explanation>
                    Historical transactions are temporarily unavailable due to a payment provider timeout.
                    Please refresh in a few minutes to try again.
                </Explanation>
                : <Transactions transactions={user.transactions} />
            }
        </AccountSection>
    </PageContainer>;
});

export const PlaceholderAccountPage = observer((props: {
    accountStore: AccountStore
}) => {
    const { accountStore } = props;
    const { logOut } = accountStore;

    return <PageContainer>
        <PageHeading>
            Your Account <Spinner />
        </PageHeading>

        <LogOutButton onClick={logOut}>
            Log out
        </LogOutButton>

        <AccountSection>
            <SectionHeading>Subscription <Spinner /></SectionHeading>

            <ContentGrid>
                <ContentLabel>Email</ContentLabel>
                <ContentValue></ContentValue>

                <ContentLabel>Plan</ContentLabel>
                <ContentValue></ContentValue>

                <ContentLabel>Licenses</ContentLabel>
                <ContentValue></ContentValue>

                <ContentLabel>Status</ContentLabel>
                <ContentValue></ContentValue>

                <ContentLabel>Renews</ContentLabel>
                <ContentValue></ContentValue>
            </ContentGrid>

            <AccountControls>
                <ButtonLink>Update billing details</ButtonLink>
                <ButtonLink>Cancel subscription</ButtonLink>
            </AccountControls>
        </AccountSection>

        <AccountSection>
            <SectionHeading>Invoices <Spinner /></SectionHeading>
            <PlaceholderTransactions />
        </AccountSection>
    </PageContainer>;
});

const Spinner = styled((p: { className?: string }) =>
    <Icon icon={['fac', 'spinner-arc']} spin className={p.className} />
)`
    font-size: 0.9em;
    margin-left: 10px;
`;