import { styled, css } from './styles';

export const interactiveMouseoverStyles = css`
    &[disabled] {
        cursor: default;
    }

    &:not([disabled]) {
        cursor: pointer;

        background-image: linear-gradient(transparent, rgba(0,0,0,.05) 40%, rgba(0,0,0,.1));
        &:hover {
            background-image: none;
        }

        &:active {
            background-image: linear-gradient(rgba(0,0,0,.1), rgba(0,0,0,.05) 40%, transparent);
        }
    }
`;

const BaseButtonStyles = css`
    -webkit-appearance: none;
    cursor: pointer;
    padding: 6px 16px;
    border-radius: 4px;
    border: none;

    font-family: ${p => p.theme.fontFamily};
    font-size: ${p => p.theme.textSize};

    display: block;
    text-decoration: none;
    text-align: center;
    font-weight: inherit;
    line-height: normal;

    ${interactiveMouseoverStyles}
`;

export const Button = styled.button.attrs(() => ({
    // 'submit' is the default, which makes 'enter' behaviour super wacky:
    'type': 'button'
}))`
    ${BaseButtonStyles}

    /*
     * Need both to ensure link button colours have higher
     * specificity than the a:visited default.
     */
    &, &:visited {
        color: ${p => p.theme.primaryInputColor};
    }

    &[disabled] {
        background-color: ${p => p.theme.containerWatermark};
    }

    &:not([disabled]) {
        background-color: ${p => p.theme.primaryInputBackground};
    }
`;

export const ButtonLink = Button.withComponent('a');

export const SecondaryButton = styled.button.attrs(() => ({
    // 'submit' is the default, which makes 'enter' behaviour super wacky:
    'type': 'button'
}))`
    ${BaseButtonStyles}

    background-color: transparent;

    &, &:visited {
        color: ${p => p.theme.secondaryInputColor};
    }

    border-width: 2px;
    border-style: solid;

    &[disabled] {
        color: ${p => p.theme.containerWatermark};
        border-color: ${p => p.theme.containerWatermark};
    }

    &:not([disabled]) {
        border-color: ${p => p.theme.secondaryInputBorder};
    }
`;

export const UnstyledButton = styled.button.attrs(() => ({
    // 'submit' is the default, which makes 'enter' behaviour super wacky:
    'type': 'button'
}))`
    /* Reset styles that get broken because <button> overrides them: */
    border: none;
    background: none;
    font-family: inherit;
    font-size: inherit;
    color: inherit;

    &[disabled] {
        cursor: default;
    }

    &:not([disabled]) {
        cursor: pointer;
    }
`;