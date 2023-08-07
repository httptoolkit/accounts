import _ from 'lodash';
import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { styled } from './styles';
import { Icon, WarningIcon } from './icons';
import { Button, UnstyledButton } from './inputs';
import { PLACEHOLDER_ID_PREFIX } from './account-store';

import type {
    TeamMember
} from '../../module/src/auth';

const Explanation = styled.p`
    font-style: italic;
    margin-top: 10px;
    line-height: 1.3;
`;

export const TeamMembers = observer((p: {
    licenseCount: number,
    lockedLicenses: number[],
    teamMembers: TeamMember[],
    updateTeam: (idsToRemove: string[], emailsToAdd: string[]) => Promise<void>
}) => {
    const [removedIds, setRemovedIds] = React.useState<string[]>([]);

    const toggleTeamMemberRemoval = p.teamMembers.map((member) => () => {
        if (removedIds.includes(member.id)) {
            setRemovedIds(removedIds.filter(id => id !== member.id));
        } else {
            setRemovedIds([...removedIds, member.id]);
        }
    });

    const [emailInputs, setEmailInputs] = React.useState<string[]>([]);

    const addTeamMember = () => {
        setEmailInputs([...emailInputs, '']);
    };

    const updateMemberEmail = emailInputs.map((_email, i) => (inputEvent: React.ChangeEvent) => {
        const newValue = (inputEvent.target as HTMLInputElement).value;
        const updatedEmail = newValue
            ? [newValue]
            : []; // Drop rows if they become empty

        setEmailInputs([
            ...emailInputs.slice(0, i),
            ...updatedEmail,
            ...emailInputs.slice(i + 1),
        ]);
    });

    const formRef = React.useRef<HTMLFormElement>(null);
    const onBlurEmail = () => {
        formRef.current?.reportValidity();
    };

    const unusedLicenses = p.licenseCount
        - p.teamMembers.length
        - p.lockedLicenses.length
        + removedIds.filter(id =>
            // You only gain the slots back if the members aren't locked
            !_.find(p.teamMembers, { id })!.locked
        ).length
        - emailInputs.length;

    React.useEffect(() => {
        if (unusedLicenses < 0 && emailInputs.length > 0) {
            // Trim off the extra inputs, if you end up with more shown than should be
            // allowed (e.g. delete, add input, undelete)
            setEmailInputs(emailInputs.slice(0, unusedLicenses));
        }
    }, [emailInputs, unusedLicenses]);

    const dataIsValid = emailInputs.every(email => email.includes('@')) &&
        _.uniq(emailInputs).length === emailInputs.length &&
        unusedLicenses >= 0;

    const [updateInProgress, setUpdating] = React.useState(false);

    const canSubmitUpdate = dataIsValid &&
        !updateInProgress &&
        (emailInputs.length !== 0 || removedIds.length !== 0);

    const submitUpdate = async (e: React.MouseEvent) => {
        e.preventDefault();

        if (!canSubmitUpdate) return;
        else {
            setEmailInputs([]);
            setRemovedIds([]);
            setUpdating(true);
            try {
                await p.updateTeam(removedIds, emailInputs);
            } finally {
                setUpdating(false);
            }
        }
    };

    return <form ref={formRef}>
        <Explanation>
            Your subscription includes licenses for up to { p.licenseCount } team member{
                p.licenseCount > 1 ? 's' : ''
            }. All members of the team have full access to in-app paid features, but will not
            be able to access invoices, modify the subscription, or manage the team itself.
        </Explanation>

        <TeamMembersContainer>
            { p.teamMembers.map((member, i) => <TeamMemberRow
                key={member.id}
                disabled={!!member.error}
            >
                <TeamMemberName removed={removedIds.includes(member.id)}>
                    { member.name }
                </TeamMemberName>

                { member.id.startsWith(PLACEHOLDER_ID_PREFIX)
                    ? <Spinner />
                    : <DeleteButton
                        onClick={toggleTeamMemberRemoval[i]}
                        deleted={removedIds.includes(member.id)}
                    />
                }

                { member.error
                    ? <WarningDetails>
                        <WarningIcon/>
                        <WarningText>
                            { member.error === 'inconsistent-member-data'
                                ? 'Unexpected data inconsistency, please email support@httptoolkit.tech.'
                            : member.error === 'member-beyond-team-limit'
                                ? 'Team member is beyond your subscription capacity, please upgrade.'
                            : 'Unknown error, please email support@httptoolkit.tech' }
                        </WarningText>
                    </WarningDetails>
                    : null
                }

                { removedIds.includes(member.id) && member.locked
                    ? <WarningDetails>
                        <WarningIcon/>
                        <WarningText>
                            Licenses can only be reassigned once every 48 hours. This member was added within the last
                            48 hours, so their license will not be immediately reusable if they are removed from the team.
                        </WarningText>
                    </WarningDetails>
                    : null
                }
            </TeamMemberRow>) }

            { p.lockedLicenses.map((timestamp, i) => <LockedLicenseRow
                    key={`locked-${i}`}
                >
                    License locked until {
                        new Date(timestamp).toLocaleString()
                    }
                </LockedLicenseRow>
            ) }

            { emailInputs.map((email, i) => <NewTeamMemberRow
                    key={`member-${p.teamMembers.length + i}`}
                >
                    <Icon icon={['fas', 'plus']} />
                    <NewTeamMemberInput
                        type="email"
                        value={email}
                        placeholder="new-team-member@org.example"
                        minLength={1}
                        onBlur={onBlurEmail}
                        onChange={updateMemberEmail[i]}
                    />
                </NewTeamMemberRow>
            ) }

            { unusedLicenses > 0 &&
                <AddNewTeamMemberButton
                    onClick={addTeamMember}
                >
                    <Icon icon={['fas', 'plus']}/> Add team member
                </AddNewTeamMemberButton>
            }
        </TeamMembersContainer>

        <TeamControls>
            <Button
                disabled={!canSubmitUpdate}
                onClick={submitUpdate}
            >
                Save team changes
                { updateInProgress &&
                    <Spinner />
                }
            </Button>
        </TeamControls>
    </form>
});

const TeamMembersContainer = styled.ol`
    list-style: none;
    margin-top: 30px;
`;

const TeamMemberRow = styled.li<{ disabled?: boolean }>`
    display: grid;
    grid-template-columns: 1fr min-content;
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

const TeamMemberName = styled.p<{ removed: boolean }>`
    padding: 4px 0;

    ${p => p.removed && `
        text-decoration: line-through;
        opacity: 0.8;
    `}
`;

const WarningDetails = styled.div`
    font-style: italic;
    grid-column: 1 / -1;
    margin: 10px 0 5px;
    display: flex;
`;

const WarningText = styled.p`
    line-height: 1.3;
`;

const Spinner = styled((p: { className?: string }) =>
    <Icon icon={['fac', 'spinner-arc']} spin className={p.className} />
)`
    margin: 1px 6px;
`;


const DeleteButton = styled((p: { onClick: () => void, deleted: boolean, className?: string }) =>
    <UnstyledButton onClick={p.onClick} className={p.className}>
        { p.deleted
            ? <Icon icon={['fas', 'undo']} />
            : <Icon icon={['far', 'trash-alt']} />
        }
    </UnstyledButton>
)`
    &:hover {
        color: ${p => p.theme.popColor};
    }
`;

const LockedLicenseRow = styled.li`
    border-radius: 4px;
    background-color: ${p => p.theme.mainBackground};

    padding: 14px 15px;
    margin: 10px 0;

    text-align: center;
    font-style: italic;
    font-size: ${p => p.theme.textSize};
`;

const NewTeamMemberRow = styled.li`
    display: flex;
    align-items: baseline;
`;

const NewTeamMemberInput = styled.input`
    width: 100%;
    padding: 11px 15px 12px;
    box-sizing: border-box;

    border-radius: 4px;
    border: solid 1px rgb(0 0 0 / 20%);

    font-size: ${p => p.theme.textSize};
    font-style: italic;

    background-color: ${p => p.theme.mainBackground};

    &:focus {
        outline: none;
        border-color: #222;
    }

    margin: 0 0 10px 10px;
`;

const AddNewTeamMemberButton = styled(UnstyledButton)`
    width: 100%;
    padding: 13px 15px 13px;
    box-sizing: border-box;
    margin: 0 0 10px;

    border-radius: 4px;
    border: none;

    box-shadow: 0 2px 10px 0 rgb(0 0 0 / 20%);
    font-size: ${p => p.theme.textSize};

    cursor: pointer;
    background-color: transparent;
    &:hover {
        box-shadow: none;
        background-color: ${p => p.theme.mainBackground}90;
    }
    &:active {
        background-color: ${p => p.theme.mainBackground};
    }
`;

const TeamControls = styled.div`
    display: flex;
    margin-top: 20px;

    > :not(:last-child) {
        margin-right: 10px;
    }
`;