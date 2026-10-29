import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { format, parseISO } from 'date-fns';

import {
    TeamSizeQuote,
    getProratedUpgradeCost,
    getRenewalCost
} from '@httptoolkit/accounts';

import { styled } from './styles';
import { formatPrice } from './formatting';
import { Icon, WarningIcon, Spinner } from './icons';
import { Button, SecondaryButton, TextInput, UnstyledButton } from './inputs';

const plural = (count: number, word: string) =>
    `${count} ${word}${count === 1 ? '' : 's'}`;

export const TeamSize = observer((p: {
    licenseCount: number,
    assignedLicenses: number,
    quote: TeamSizeQuote | undefined,
    quoteError: string | undefined,
    isLoadingQuote: boolean,
    loadQuote: (options?: { refresh?: boolean }) => void,
    updateTeamSize: (newTeamSize: number) => Promise<void>
}) => {
    const [isOpen, setIsOpen] = React.useState(false);
    // Held as text, so the field can be emptied while a new number is typed into it:
    const [sizeInput, setSizeInput] = React.useState(p.licenseCount.toString());
    const [updateInProgress, setUpdating] = React.useState(false);
    const [hasEditedSize, setHasEditedSize] = React.useState(false);

    // The quote loads in the background, so until it arrives we use the account data we
    // already have, which covers everything except pricing & pending reductions:
    const { quote } = p;
    const minTeamSize = quote?.minQuantity ?? Math.max(1, p.assignedLicenses);
    const maxTeamSize = quote?.maxQuantity ?? Infinity;
    // Current is what's paid for this period. Renewal is lower while a reduction is pending:
    const currentSize = quote?.currentQuantity ?? p.licenseCount;
    const renewalSize = quote?.renewalQuantity ?? currentSize;

    // An empty field means "no change yet" everywhere except the field itself:
    const typedSize = parseInt(sizeInput, 10);
    const newTeamSize = Number.isNaN(typedSize) ? renewalSize : typedSize;

    React.useEffect(() => {
        if (isOpen && !quote && !p.isLoadingQuote && !p.quoteError) p.loadQuote();
    }, [isOpen, quote, p.isLoadingQuote, p.quoteError]);

    React.useEffect(() => {
        if (!quote) return;
        if (!hasEditedSize) setSizeInput(quote.renewalQuantity.toString());
        else if (newTeamSize > quote.maxQuantity) setSizeInput(quote.maxQuantity.toString());
    }, [quote]);

    const openPanel = () => {
        setSizeInput((quote?.renewalQuantity ?? p.licenseCount).toString());
        setHasEditedSize(false);
        setIsOpen(true);
        p.loadQuote();
    };

    const closePanel = () => setIsOpen(false);

    const clampSize = (size: number, min: number) =>
        setSizeInput(Math.max(min, Math.min(maxTeamSize, size)).toString());

    const editSize = (size: number, min: number) => {
        setHasEditedSize(true);
        clampSize(size, min);
    };

    // Typed input is only bounded above, so that clamping can't fight somebody midway
    // through typing a number, and empty input is left alone so the field can be cleared.
    // Below-minimum values are flagged instead, and corrected when the field is left.
    const onSizeInput = (inputEvent: React.ChangeEvent<HTMLInputElement>) => {
        const value = inputEvent.target.value;

        setHasEditedSize(true);
        if (value === '') setSizeInput('');
        else if (!Number.isNaN(parseInt(value, 10))) clampSize(parseInt(value, 10), 1);
    };

    const onSizeBlur = () => clampSize(newTeamSize, minTeamSize);

    const isBelowMinimum = newTeamSize < minTeamSize;
    const licenseChange = newTeamSize - currentSize;
    const isUpgrade = licenseChange > 0;
    const isReduction = licenseChange < 0;
    const hasPendingReduction = renewalSize < currentSize;
    const isChangePlanned = newTeamSize !== renewalSize;

    const canSubmit = !!quote &&
        isChangePlanned &&
        !isBelowMinimum &&
        !updateInProgress;

    const submitUpdate = async () => {
        if (!canSubmit) return;

        setUpdating(true);
        try {
            await p.updateTeamSize(newTeamSize);
            setIsOpen(false);
        } catch (e) {
            // Reported & alerted by the store - just leave the panel open to retry.
        } finally {
            setUpdating(false);
        }
    };

    return <>
        <LicenseSummary>
            <LicenseSummaryText>
                <Icon icon={['fas', 'users']} />
                { plural(p.licenseCount, 'license') }, { p.assignedLicenses } assigned
            </LicenseSummaryText>

            { !isOpen &&
                <SecondaryButton onClick={openPanel}>
                    Change licenses
                </SecondaryButton>
            }
        </LicenseSummary>

        { isOpen && <LicensePanel>
            <StepperRow>
                <StepperLabel>Licenses</StepperLabel>

                <Stepper>
                    <StepperButton
                        onClick={() => editSize(newTeamSize - 1, minTeamSize)}
                        disabled={newTeamSize <= minTeamSize}
                        title="Remove a license"
                    >
                        <Icon icon={['fas', 'minus']} />
                    </StepperButton>

                    <LicenseInput
                        type="number"
                        value={sizeInput}
                        min={minTeamSize}
                        max={quote?.maxQuantity}
                        onChange={onSizeInput}
                        onBlur={onSizeBlur}
                    />

                    <StepperButton
                        onClick={() => editSize(newTeamSize + 1, minTeamSize)}
                        disabled={newTeamSize >= maxTeamSize}
                        title="Add a license"
                    >
                        <Icon icon={['fas', 'plus']} />
                    </StepperButton>
                </Stepper>

                { isChangePlanned && isUpgrade &&
                    <StepperNote>Adding { licenseChange }</StepperNote>
                }
                { isChangePlanned && isReduction &&
                    <StepperNote>Removing { -licenseChange }</StepperNote>
                }
            </StepperRow>

            { newTeamSize <= minTeamSize && minTeamSize > 1 &&
                <PanelWarning>
                    <WarningIcon />
                    <WarningText>
                        You can't go below { plural(minTeamSize, 'license') } while
                        they're all assigned. Remove team members first to reduce
                        this further.
                    </WarningText>
                </PanelWarning>
            }

            { hasPendingReduction && newTeamSize === renewalSize &&
                <Explanation>
                    Your team is already set to reduce to { plural(renewalSize, 'license') } at
                    its next renewal.
                </Explanation>
            }

            { isChangePlanned && !quote && (p.quoteError
                ? <PanelMessage>
                    <WarningIcon />
                    <span>
                        Couldn't load your subscription pricing: { p.quoteError }
                    </span>
                    <SecondaryButton onClick={() => p.loadQuote({ refresh: true })}>
                        Retry
                    </SecondaryButton>
                </PanelMessage>
                : <PanelMessage>
                    <Spinner /> Loading your subscription pricing...
                </PanelMessage>
            ) }

            { quote && isUpgrade && <CostBreakdown>
                <CostLabel>
                    { plural(licenseChange, 'extra license') } at {
                        formatPrice(quote.currency, quote.unitPrice)
                    } / { quote.interval === 'annual' ? 'year' : 'month' }
                </CostLabel>
                <CostValue>pro-rated</CostValue>

                <CostTotalLabel>Due today</CostTotalLabel>
                <CostTotalValue>
                    approx. { formatPrice(quote.currency, getProratedUpgradeCost(quote, newTeamSize)) }
                </CostTotalValue>
            </CostBreakdown> }

            { quote && isReduction && <CostBreakdown>
                <CostLabel>
                    Renews { format(parseISO(quote.nextBillDate), "do 'of' MMMM yyyy") }
                </CostLabel>
                <CostValue>
                    { formatPrice(quote.currency, getRenewalCost(quote, newTeamSize)) } / {
                        quote.interval === 'annual' ? 'year' : 'month'
                    }
                </CostValue>
            </CostBreakdown> }

            { quote && isChangePlanned && <Explanation>
                { isUpgrade
                    ? 'Prices include local tax. Billed immediately to your existing payment method.'
                : isReduction
                    ? 'Prices include local tax. Takes effect at your next renewal. Your team keeps its current licenses until then.'
                    : 'Cancels your pending reduction. Nothing is charged today.' }
            </Explanation> }

            <PanelControls>
                <SecondaryButton
                    onClick={closePanel}
                    disabled={updateInProgress}
                >
                    Cancel
                </SecondaryButton>

                { isChangePlanned &&
                    <Button
                        onClick={submitUpdate}
                        disabled={!canSubmit}
                    >
                        { isUpgrade
                            ? 'Confirm upgrade'
                            : isReduction
                                ? 'Confirm downgrade'
                                : 'Cancel reduction' }
                        { updateInProgress && <Spinner /> }
                    </Button>
                }
            </PanelControls>
        </LicensePanel> }
    </>;
});

const LicenseSummary = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: space-between;

    margin-top: 20px;
    font-size: ${p => p.theme.textSize};
`;

const LicenseSummaryText = styled.p`
    > svg {
        margin-right: 10px;
        opacity: ${p => p.theme.lowlightTextOpacity};
    }
`;

const LicensePanel = styled.div`
    margin-top: 15px;
    padding: 20px;

    border-radius: 4px;
    background-color: ${p => p.theme.mainBackground};
    box-shadow: 0 2px 10px 0 rgb(0 0 0 / 20%);

    font-size: ${p => p.theme.textSize};
`;

const PanelMessage = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    line-height: 1.3;
`;

const StepperRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 15px;
    align-items: center;
`;

const StepperLabel = styled.h4`
    text-transform: uppercase;
    opacity: ${p => p.theme.lowlightTextOpacity};
`;

const Stepper = styled.div`
    display: flex;
    align-items: stretch;
    gap: 8px;
`;

const StepperButton = styled(UnstyledButton)`
    width: 32px;

    border-radius: 4px;
    border: solid 1px ${p => p.theme.inputBorder};
    background-color: ${p => p.theme.inputBackground};
    color: ${p => p.theme.inputColor};

    &[disabled] {
        opacity: 0.4;
    }

    &:not([disabled]):hover {
        background-color: ${p => p.theme.inputHoverBackground};
        color: ${p => p.theme.popColor};
    }
`;

const LicenseInput = styled(TextInput)`
    width: 70px;
    text-align: center;
    font-size: ${p => p.theme.subHeadingSize};
`;

const StepperNote = styled.p`
    font-style: italic;
    opacity: ${p => p.theme.lowlightTextOpacity};
`;

const PanelWarning = styled.div`
    display: flex;
    margin-top: 15px;
    font-style: italic;
`;

const WarningText = styled.p`
    line-height: 1.3;
`;

const CostBreakdown = styled.div`
    margin-top: 20px;
    padding-top: 15px;
    border-top: solid 1px ${p => p.theme.containerBorder};

    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px 20px;
    align-items: baseline;
`;

const CostLabel = styled.p``;
const CostValue = styled.p`
    text-align: right;
    opacity: ${p => p.theme.lowlightTextOpacity};
`;

const CostTotalLabel = styled.p`
    font-weight: bold;
`;

const CostTotalValue = styled.p`
    text-align: right;
    font-weight: bold;
    font-size: ${p => p.theme.subHeadingSize};
`;

const Explanation = styled.p`
    font-style: italic;
    margin-top: 15px;
    line-height: 1.3;
`;

const PanelControls = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 20px;
`;
