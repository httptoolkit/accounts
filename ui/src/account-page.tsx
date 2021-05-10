import * as _ from 'lodash';
import * as React from 'react';
import {
    formatDistanceStrict, format
} from 'date-fns';

import { getPlanByCode } from '../../module/src/plans';

import { styled, media } from './styles';

import { AccountStore } from './account-store';

import { Button, ButtonLink } from './inputs';
import { Transactions } from './account-transactions';
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

export const AccountPage = (props: {
    accountStore: AccountStore
}) => {
    const { accountStore } = props;

    const {
        user,
        userSubscription,
        logOut
    } = accountStore;

    const sub = userSubscription!;
    if (!user) throw new Error("Account page with no user data");

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

            <AccountControls>
                { sub.status !== 'deleted' &&
                    sub.updateBillingDetailsUrl &&
                    <ButtonLink
                        href={ sub.updateBillingDetailsUrl }
                        target='_blank'
                        rel='noreferrer noopener'
                    >
                        Update billing details
                    </ButtonLink>
                }
                { sub.status !== 'deleted' &&
                    sub.cancelSubscriptionUrl &&
                    <ButtonLink
                        href={ sub.cancelSubscriptionUrl }
                        target='_blank'
                        rel='noreferrer noopener'
                    >
                        Cancel subscription
                    </ButtonLink>
                }
            </AccountControls>
        </AccountSection>

        { sub && user.teamMembers && <AccountSection>
            <SectionHeading>Team</SectionHeading>
            <TeamMembers
                licenseCount={sub.quantity}
                teamMembers={user.teamMembers}
            />
        </AccountSection> }

        <AccountSection>
            <SectionHeading>Invoices</SectionHeading>
            <Transactions transactions={user.transactions} />
        </AccountSection>
    </PageContainer>;
};