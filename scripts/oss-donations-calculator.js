#!/usr/bin/env node

/**
 * SPONSORSHIP REPORT GENERATOR (GitHub & Open Collective)
 * * Dependencies: moment
 * Install: npm install moment
 * Usage:   node sponsorship-report.js
 */

const moment = require('moment');

// --- CONFIGURATION ---

const CONFIG = {
    // The specific year you want the report for
    TARGET_YEAR: 2025,

    // GitHub Settings
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_TARGET_LOGIN: process.env.GITHUB_ORG || 'your-org-name',

    // START DATE:
    // To catch all recurring payments active in the target year, this date must
    // be BEFORE your very first sponsorship started. '2019-01-01' is safe.
    GITHUB_RECONSTRUCTION_START: '2019-01-01',

    // Open Collective Settings
    OC_API_KEY: process.env.OC_API_KEY || null,
    OC_SLUG: process.env.OC_SLUG || 'your-collective-slug',
};

// --- QUERIES ---

const GH_QUERY = `
query getSponsorshipLog($target: String!, $after: String, $since: DateTime) {
    repositoryOwner(login: $target) {
        ... on Sponsorable {
            sponsorsActivities(first: 100, after: $after, since: $since, period: ALL, includeAsSponsor: true) {
                nodes {
                    action
                    paymentSource
                    sponsorsTier { monthlyPriceInCents isOneTime }
                    timestamp
                    sponsorable {
                        ... on User { login }
                        ... on Organization { login }
                    }
                }
                pageInfo { endCursor hasNextPage }
            }
        }
    }
}`;

const OC_QUERY = `
query getOutgoingExpenses($slug: String!, $dateFrom: DateTime, $dateTo: DateTime) {
  account(slug: $slug) {
    name
    transactions(
      type: DEBIT
      kind: CONTRIBUTION
      dateFrom: $dateFrom
      dateTo: $dateTo
      limit: 1000
    ) {
      nodes {
        description
        amount { valueInCents currency }
        createdAt
        toAccount { name slug }
      }
    }
  }
}`;

// --- HELPERS ---

async function fetchGraphQL(url, token, query, variables, authHeaderType = 'Authorization') {
    const headers = { 'Content-Type': 'application/json' };

    if (token) {
        if (authHeaderType === 'Api-Key') {
            headers['Api-Key'] = token;
        } else {
            headers['Authorization'] = `Bearer ${token}`;
        }
    }

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status} error from ${url}: ${text}`);
    }

    const json = await response.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2));

    return json.data;
}

function getCurrencySymbol(currencyCode) {
    switch (currencyCode) {
        case 'EUR': return '€';
        case 'GBP': return '£';
        case 'USD': return '$';
        default: return currencyCode + ' ';
    }
}

// --- GITHUB LOGIC ---

async function getGitHubEvents(token, target, startDate) {
    const events = [];
    let after = null;
    let hasNextPage = true;

    process.stderr.write(`Fetching GitHub history for ${target} from ${startDate.format('YYYY-MM-DD')}... `);

    while (hasNextPage) {
        const data = await fetchGraphQL("https://api.github.com/graphql", token, GH_QUERY, {
            target,
            after,
            since: startDate.toISOString()
        });

        if (!data || !data.repositoryOwner) {
             throw new Error("GitHub API returned no data for repositoryOwner. Check your token and GITHUB_ORG.");
        }

        const activities = data.repositoryOwner.sponsorsActivities;
        events.push(...activities.nodes);
        after = activities.pageInfo.endCursor;
        hasNextPage = activities.pageInfo.hasNextPage;
        process.stderr.write('.');
    }
    process.stderr.write('\n');
    return events;
}

function reconstructGitHubPayments(events, startDate, targetYear, myLogin) {
    const payments = [];
    const paymentMap = new Map();
    let paymentMonthDay = null;

    const selfLoginNormalized = myLogin.toLowerCase();

    // Group events by YYYY-MM-DD
    const eventsByDate = events.reduce((acc, event) => {
        const dateKey = moment(event.timestamp).format('YYYY-MM-DD');
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(event);
        return acc;
    }, {});

    let currDate = moment(startDate);
    const endSimulation = moment(`${targetYear}-12-31`).endOf('day');
    const now = moment();

    const stopDate = endSimulation.isAfter(now) ? now : endSimulation;

    while (currDate.isSameOrBefore(stopDate)) {
        const dateKey = currDate.format('YYYY-MM-DD');
        const dayOfMonth = currDate.date();
        const dailyEvents = eventsByDate[dateKey] || [];

        // 1. Process Changes
        for (const event of dailyEvents) {
            if (!event.sponsorable) continue;
            const recipientLogin = event.sponsorable.login;

            // IGNORE SELF (INCOMING MONEY)
            if (recipientLogin.toLowerCase() === selfLoginNormalized) continue;

            switch (event.action) {
                case 'CANCELLED_SPONSORSHIP':
                    paymentMap.delete(recipientLogin);
                    if (paymentMap.size === 0) paymentMonthDay = null;
                    break;
                case 'TIER_CHANGE':
                    if (event.sponsorsTier.isOneTime) {
                        paymentMap.delete(recipientLogin);
                        if (paymentMap.size === 0) paymentMonthDay = null;
                        if (currDate.year() === targetYear) {
                            payments.push({
                                source: 'GitHub',
                                date: dateKey,
                                entity: recipientLogin,
                                url: `https://github.com/${recipientLogin}`,
                                amount: event.sponsorsTier.monthlyPriceInCents / 100,
                                currency: '$'
                            });
                        }
                    } else {
                        paymentMap.set(recipientLogin, event.sponsorsTier.monthlyPriceInCents);
                    }
                    break;
                case 'REFUND':
                    if (currDate.year() === targetYear) {
                        payments.push({
                            source: 'GitHub',
                            date: dateKey,
                            entity: recipientLogin,
                            url: `https://github.com/${recipientLogin}`,
                            amount: -(event.sponsorsTier.monthlyPriceInCents / 100),
                            currency: '$'
                        });
                    }
                    break;
            }
        }

        // 2. Process Recurring Billing
        if (dayOfMonth === paymentMonthDay) {
            for (const [login, amountCents] of paymentMap.entries()) {
                if (currDate.year() === targetYear) {
                    payments.push({
                        source: 'GitHub',
                        date: dateKey,
                        entity: login,
                        url: `https://github.com/${login}`,
                        amount: amountCents / 100,
                        currency: '$'
                    });
                }
            }
        }

        // 3. Process New Sponsorships
        for (const event of dailyEvents) {
            if (event.action !== 'NEW_SPONSORSHIP') continue;
            if (!event.sponsorsTier) continue;
            if (!event.sponsorable) continue;

            const recipientLogin = event.sponsorable.login;

            // IGNORE SELF (INCOMING MONEY)
            if (recipientLogin.toLowerCase() === selfLoginNormalized) continue;

            const amountCents = event.sponsorsTier.monthlyPriceInCents;
            const isOneTime = event.sponsorsTier.isOneTime;

            if (currDate.year() === targetYear) {
                payments.push({
                    source: 'GitHub',
                    date: dateKey,
                    entity: recipientLogin,
                    url: `https://github.com/${recipientLogin}`,
                    amount: amountCents / 100,
                    currency: '$'
                });
            }

            if (!isOneTime) {
                if (paymentMonthDay === null) paymentMonthDay = dayOfMonth;
                paymentMap.set(recipientLogin, amountCents);
            }
        }

        currDate.add(1, 'days');
    }
    return payments;
}

// --- OPEN COLLECTIVE LOGIC ---

async function fetchOpenCollectivePayments(apiKey, slug, year) {
    const dateFrom = moment(`${year}-01-01`).toISOString();
    const dateTo = moment(`${year}-12-31`).endOf('day').toISOString();

    process.stderr.write(`Fetching Open Collective transactions for ${slug} (${year})...\n`);

    const data = await fetchGraphQL(
        "https://api.opencollective.com/graphql/v2", 
        apiKey, 
        OC_QUERY, 
        { slug, dateFrom, dateTo }, 
        'Api-Key'
    );

    if (!data || !data.account) {
        console.warn(`Warning: Open Collective returned no account data for slug '${slug}'. Skipping.`);
        return [];
    }

    const transactions = data.account.transactions?.nodes || [];

    return transactions.map(t => {
        const entityName = t.toAccount ? t.toAccount.name : t.description;
        const entitySlug = t.toAccount ? t.toAccount.slug : null;

        return {
            source: 'OpenCollective',
            date: moment(t.createdAt).format('YYYY-MM-DD'),
            entity: entityName,
            url: entitySlug ? `https://opencollective.com/${entitySlug}` : null,
            amount: Math.abs(t.amount.valueInCents / 100),
            currency: getCurrencySymbol(t.amount.currency)
        };
    });
}

// --- MAIN ---

async function main() {
    if (!CONFIG.GITHUB_TOKEN) {
        console.error("Error: GITHUB_TOKEN environment variable is required.");
        process.exit(1);
    }

    try {
        const ghStart = moment(CONFIG.GITHUB_RECONSTRUCTION_START);

        const ghPayments = reconstructGitHubPayments(
            await getGitHubEvents(CONFIG.GITHUB_TOKEN, CONFIG.GITHUB_TARGET_LOGIN, ghStart), 
            ghStart, 
            CONFIG.TARGET_YEAR,
            CONFIG.GITHUB_TARGET_LOGIN 
        );

        let ocPayments = [];
        if (CONFIG.OC_SLUG) {
            try {
                ocPayments = await fetchOpenCollectivePayments(CONFIG.OC_API_KEY, CONFIG.OC_SLUG, CONFIG.TARGET_YEAR);
            } catch (e) {
                console.error("Failed to fetch Open Collective data:", e.message);
            }
        }

        const allPayments = [...ghPayments, ...ocPayments];

        // --- AGGREGATION ---
        const recipientSummary = {};
        const platformSummary = {};
        let grandTotal = 0;

        for (const p of allPayments) {
            // Platform Stats
            if (!platformSummary[p.source]) platformSummary[p.source] = 0;
            platformSummary[p.source] += p.amount;

            // Recipient Stats
            if (!recipientSummary[p.entity]) {
                recipientSummary[p.entity] = {
                    total: 0,
                    url: p.url,
                    currency: p.currency // Assumption: recipient uses same currency for all tx
                };
            }
            recipientSummary[p.entity].total += p.amount;
            grandTotal += p.amount;
        }

        // --- OUTPUT ---

        // 1. Platform Totals (Brief summary)
        console.log(`\nTotals by Platform:`);
        for (const [platform, amount] of Object.entries(platformSummary)) {
            console.log(`- ${platform}: $${amount.toFixed(2)}`);
        }
        console.log(''); // spacer

        // 2. Markdown Output
        console.log(`In ${CONFIG.TARGET_YEAR}, ${CONFIG.GITHUB_TARGET_LOGIN} paid $${grandTotal.toFixed(0)} to open-source maintainers:\n`);

        const sortedEntities = Object.entries(recipientSummary).sort((a, b) => b[1].total - a[1].total);

        for (const [entity, data] of sortedEntities) {
            const amountStr = `${data.currency}${data.total.toFixed(0)}`;
            const link = data.url ? `[${entity}](${data.url})` : entity;
            console.log(`* ${amountStr} to ${link}`);
        }
        console.log(''); // spacer

    } catch (err) {
        console.error("\nRun failed:", err);
        process.exit(1);
    }
}

main();