import * as React from 'react';

import { styled } from './styles';
import { WarningIcon } from './icons';

import type {
    TeamMember
} from '../../module/src/auth';

const Explanation = styled.p`
    font-style: italic;
    margin-top: 10px;
    line-height: 1.3;
`;

export const TeamMembers = (p: {
    licenseCount: number,
    teamMembers: TeamMember[],
}) => {
    return <div>
        <Explanation>
            Your subscription includes licenses for up to { p.licenseCount } team member{
                p.licenseCount > 1 ? 's' : ''
            }. All members of the team have full access to paid features, but will not
            be able to access invoices or modify the subscription and the team itself.
        </Explanation>

        <TeamMembersContainer>
            { p.teamMembers.map((member) => <TeamMemberRow
                key={member.id}
                disabled={!!member.error}
            >
                <TeamMemberName>
                    { member.name }
                </TeamMemberName>

                { member.error
                    ? <WarningDetails>
                        <WarningIcon/>
                        { member.error === 'inconsistent-member-data'
                            ? 'Unexpected data inconsistency, please email support@httptoolkit.tech.'
                        : member.error === 'member-beyond-team-limit'
                            ? 'Team member is beyond your subscription capacity, please upgrade.'
                        : 'Unknown error, please email support@httptoolkit.tech' }
                    </WarningDetails>
                    : <div />
                }
            </TeamMemberRow>) }
        </TeamMembersContainer>
    </div>
};

const TeamMembersContainer = styled.ol`
    list-style: none;
    margin-top: 20px;
`;

const TeamMemberRow = styled.li<{ disabled?: boolean }>`
    display: grid;
    grid-template-columns: 1fr 1fr min-content;
    align-items: baseline;

    border-radius: 4px;
    background-color: ${p => p.theme.mainBackground};

    padding: 10px 15px;
    margin: 10px 0;

    ${p => p.disabled && `
        opacity: 0.7;
        box-shadow: none;
    `}

    font-size: ${p => p.theme.textSize};
`;

const TeamMemberName = styled.p`
    padding: 4px 0;
`;

const WarningDetails = styled.div`
    font-style: italic;
    grid-column: 1 / -1;
    margin: 10px 0 5px;
`;