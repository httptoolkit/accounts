export const ACCOUNTS_API_BASE = process.env.ACCOUNTS_API ?? // Useful for local override for testing
    process.env.GATSBY_ACCOUNTS_API ?? // Useful to override in local Gatsby dev
    `https://accounts.httptoolkit.tech/api`;

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function doWhile<T>(
    doFn: () => Promise<T>,
    whileFn: () => Promise<boolean> | boolean
) {
    do {
        await doFn();
    } while (await whileFn());
}