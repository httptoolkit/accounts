import fetch from "node-fetch";

const PROFITWELL_PRIVATE_TOKEN = process.env.PROFITWELL_PRIVATE_TOKEN;
const PROFITWELL_API_BASE_URL = process.env.PROFITWELL_API_BASE_URL
    ?? 'https://api.profitwell.com';

interface Traits {
    'Payment provider'?: string,
    'Country code'?: string
}

// Attempt to update the user to log subscription metadata (e.g. the provider used) so
// we can work out where the actual money is later on.
export async function setRevenueTraits(email: string, traits: Traits) {
    await Promise.all(Object.entries(traits).map(async ([category, trait]) => {
        if (!trait) return;

        const response = await fetch(`${PROFITWELL_API_BASE_URL}/v2/customer_traits/trait/`, {
            method: 'PUT',
            headers: {
                'Authorization': PROFITWELL_PRIVATE_TOKEN!,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, category, trait })
        });

        const responseBody = await response.text().catch(console.log);

        if (response.status === 400 && responseBody?.includes('Customer already has trait')) {
            // This is totally fine, if it's already set then we're happy regardless.
            return;
        } else if (!response.ok) {
            console.log(responseBody);
            throw new Error(`Failed to set Profitwell ${category}:${trait} on ${email} (${response.status})`);
        } else {
            // Trait set OK, all good.
            return;
        }
    }));
}