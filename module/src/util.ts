export const ACCOUNTS_API_BASE = process.env.ACCOUNTS_API ?? // Useful for local override for testing
    process.env.GATSBY_ACCOUNTS_API ?? // Useful to override in local Gatsby dev
    `https://accounts.httptoolkit.tech/api`;

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));