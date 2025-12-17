import * as styledComponents from 'styled-components';
import type { ThemeProps } from 'styled-components';

import reset from 'styled-reset';

import "@fontsource/dm-sans";
import "@fontsource/dm-mono";

// This attempts to closely follow the styles in the UI itself, since they're built on very
// similar foundations. That means that some properties are included but aren't used here -
// that's totally fine, don't worry about it.

const fontSizes = {
    smallPrintSize: '12px',
    textInputFontSize: '13px',
    textSize: '14.5px',
    subHeadingSize: '17px',
    headingSize: '20px',
    largeHeadingSize: '24px',
    loudHeadingSize: '38px',
};

export const warningColor = '#f1971f';
const warningBackground = '#f1971f40';
const successColor = "#097123";
const successBackground = "#cee7da";
export const popColor = '#e1421f';

const black = "#000000";
const inkBlack = "#16181e";
const inkGrey = "#1e2028";
const darkerGrey = "#25262e";
const darkGrey = "#32343B";
const darkishGrey =  "#53565e";
const mediumGrey = "#818490";
const lightGrey = "#9a9da8";
const ghostGrey = "#e4e8ed";
const greyWhite = "#f2f2f2";
const almostWhite = "#fafafa";
const white = "#ffffff";

const darkerBlue = "#2d4cbd";
const lighterBlue = "#6284fa";


export const lightTheme = {
    fontFamily: '"DM Sans", Arial, sans-serif',
    monoFontFamily: '"DM Mono", monospace',

    mainBackground: almostWhite,
    mainLowlightBackground: greyWhite,
    mainLowlightColor: darkishGrey,
    mainColor: inkGrey,

    highlightBackground: white,
    highlightColor: inkGrey,

    lowlightTextOpacity: 0.65,
    boxShadowAlpha: 0.3,

    pillContrast: 0.9,
    pillDefaultColor: lightGrey,

    primaryInputBackground: darkerBlue,
    primaryInputColor: white,

    secondaryInputBorder: lighterBlue,
    secondaryInputColor: darkerBlue,

    inputBackground: white,
    inputHoverBackground: greyWhite,
    inputBorder: darkishGrey,
    inputColor: inkGrey,
    inputPlaceholderColor: darkishGrey,
    inputWarningPlaceholder: '#8c5c1d', // Mix of warning + inkGrey

    popColor,
    popOverlayColor: white,

    warningColor,
    warningBackground,
    successColor,
    successBackground,

    containerBackground: ghostGrey,
    containerWatermark: mediumGrey,
    containerBorder: lightGrey,

    // These are the same as the standard defaults
    linkColor: '#0000EE',
    visitedLinkColor: '#551A8B',

    modalGradient: 'radial-gradient(#40404b, #111118)',

    ...fontSizes,
} as const;

export const darkTheme = {
    fontFamily: '"DM Sans", Arial, sans-serif',
    monoFontFamily: '"DM Mono", monospace',

    mainBackground: darkGrey,
    mainLowlightBackground: darkerGrey,
    mainLowlightColor: mediumGrey,
    mainColor: white,

    highlightBackground: darkishGrey,
    highlightColor: white,

    lowlightTextOpacity: 0.65,
    boxShadowAlpha: 0.4,

    pillContrast: 0.85,
    pillDefaultColor: lightGrey,

    primaryInputBackground: darkerBlue,
    primaryInputColor: white,

    secondaryInputBorder: darkerBlue,
    secondaryInputColor: lighterBlue,

    inputBackground: inkBlack,
    inputHoverBackground: inkGrey,
    inputBorder: darkishGrey,
    inputColor: white,
    inputPlaceholderColor: mediumGrey,
    inputWarningPlaceholder: '#e8b978', // Mix of warning + white

    popColor,
    popOverlayColor: white,

    warningColor,
    warningBackground,
    successColor,
    successBackground,

    containerBackground: inkGrey,
    containerWatermark: lightGrey,
    containerBorder: black,

    linkColor: '#8699ff',
    visitedLinkColor: '#ac7ada',

    modalGradient: `radial-gradient(${white}, ${lightGrey})`,

    ...fontSizes,
} as const;

export const Themes = {
    'light': lightTheme,
    'dark': darkTheme
};

export type ThemeName = keyof typeof Themes;
export type Theme = typeof Themes[ThemeName];

export const theme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? darkTheme
    : lightTheme;

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

    * {
        box-sizing: border-box;
    }

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