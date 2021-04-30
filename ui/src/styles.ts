import * as styledComponents from 'styled-components';
import type { ThemeProps } from 'styled-components';

import reset from 'styled-reset';

const fontSizes = {
    textInputFontSize: '13px',
    textSize: '15px',
    subHeadingSize: '18px',
    headingSize: '20px',
    largeHeadingSize: '24px',
    loudHeadingSize: '38px',
};

export const warningColor = '#f1971f';

export const theme = {
    fontFamily: 'Lato, Arial, sans-serif',
    monoFontFamily: "'Fira Mono', monospace",

    mainBackground: '#fafafa',
    mainLowlightBackground: '#eaeaea',
    mainColor: '#222',

    lowlightTextOpacity: 0.65,
    pillContrast: 0.8,

    primaryInputBackground: '#1076b9',
    primaryInputColor: '#fafafa',

    secondaryInputBorder: '#7ab2e2',
    secondaryInputColor: '#1665af',

    textInputBackground: '#fafafa',
    textInputColor: '#222222',

    highlightBackground: '#ffffff',
    highlightColor: '#222',

    popColor: '#e1421f',

    warningColor: '#f1971f',
    warningBackground: '#f1971f40',

    successColor: '#097123',
    successBackground: '#4caf7d40',

    containerBackground: '#d8e2e6',
    containerWatermark: '#a0afaf',
    containerBorder: '#888',

    // These are the same as the standard defaults
    linkColor: '#0000EE',
    visitedLinkColor: '#551A8B',

    monacoTheme: 'vs-custom',

    modalGradient: 'radial-gradient(#40404b, #111118)',

    ...fontSizes
};

export type Theme = typeof theme;

const {
    default: styled,
    css,
    createGlobalStyle,
    keyframes,
    ThemeProvider,
} = styledComponents as unknown as styledComponents.ThemedStyledComponentsModule<Theme>;

export {
    styled,
    css,
    createGlobalStyle,
    keyframes,
    ThemeProvider,
    ThemeProps
};

export const GlobalStyles = createGlobalStyle`
    ${reset};

    body {
        min-height: 100%;
        margin: 0;
        padding: 0;

        font-family: ${p => p.theme.fontFamily};

        color: ${p => p.theme.mainColor};
        background-color: ${p => p.theme.containerBackground};

        border-top: 2px solid ${p => p.theme.popColor};
    }

    input {
        font-family: ${p => p.theme.fontFamily};
    }

    em {
        font-style: italic;
    }

    strong {
        font-weight: bold;
    }

    :active {
        outline: none;
    }

    /* Override Auth0's style choices to match the rest of the UI */
    .auth0-lock {
        font-family: ${p => p.theme.fontFamily} !important;

        .auth0-lock-widget {
            box-shadow: 0 2px 10px 0 rgba(0,0,0,0.2) !important;
            overflow: visible !important;
        }

        .auth0-lock-form {
            .auth0-lock-name {
                font-size: ${fontSizes.headingSize} !important;
            }

            p, .auth0-lock-social-button-text {
                font-size: ${fontSizes.textSize} !important;
            }
        }
    }
`;

export const media = {
    desktop: (...args: Parameters<typeof css>) => css`
        @media (min-width: 1084px) {
            ${ css(...args) }
        }
    `,
    tablet: (...args: Parameters<typeof css>) => css`
        @media (min-width: 600px) and (max-width: 1083px) {
            ${ css(...args) }
        }
    `,
    mobile: (...args: Parameters<typeof css>) => css`
        @media (max-width: 599px) {
            ${ css(...args) }
        }
    `,

    // Combos:
    desktopOrTablet: (...args: Parameters<typeof css>) => css`
        @media (min-width: 600px) {
            ${ css(...args) }
        }
    `,
    mobileOrTablet: (...args: Parameters<typeof css>) => css`
        @media (max-width: 1083px) {
            ${ css(...args) }
        }
    `,
}