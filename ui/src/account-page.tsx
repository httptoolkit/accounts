import * as _ from 'lodash';
import * as React from 'react';
import {
    formatDistanceStrict, format
} from 'date-fns';

import { styled, media } from './styles';

import { AccountStore } from './account-store';

const PageContainer = styled.main`
    padding-top: 40px;

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

export const AccountPage = (props: {
    accountStore: AccountStore
}) => {
    const { accountStore } = props;

    const {
        userEmail,
        userSubscription
    } = accountStore;

    return <PageContainer>
        <PageHeading>Your Account</PageHeading>

        <AccountSection>
            <SectionHeading>Subscription</SectionHeading>

            <ContentGrid>
                <ContentLabel>Email</ContentLabel>
                <ContentValue>{ userEmail }</ContentValue>

                <ContentLabel>
                    Plan
                </ContentLabel>
                <ContentValue>
                    { accountStore.getPlanByCode(userSubscription!.plan)?.name ?? 'Unknown' }
                </ContentValue>

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
                        }[userSubscription!.status]) || 'Unknown'
                    }
                </ContentValue>

                <ContentLabel>
                    {
                        ({
                            'active': 'Renews',
                            'trialing': 'Trial ends',
                            'past_due': 'Next payment attempt',
                            'deleted': 'Ends',
                        }[userSubscription!.status]) || 'Current period ends'
                    }
                </ContentLabel>
                <ContentValue>
                    {
                        formatDistanceStrict(userSubscription!.expiry, new Date(), {
                            addSuffix: true
                        })
                    } ({
                        format(userSubscription!.expiry, "do 'of' MMMM yyyy")
                    })
                </ContentValue>
            </ContentGrid>

            {
                userSubscription!.status === 'past_due' && <Explanation>
                    Your subscription payment failed, and will be reattempted shortly.
                    If retried payments continue to fail then your subscription will be
                    cancelled automatically.
                </Explanation>
            }
        </AccountSection>
    </PageContainer>;
};