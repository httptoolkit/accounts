import * as crypto from 'crypto';
import { PostHog } from 'posthog-node';

const POSTHOG_KEY = process.env.POSTHOG_KEY;

const posthog = !!POSTHOG_KEY
    ? new PostHog(POSTHOG_KEY, {
        host: 'https://events.httptoolkit.tech'
    })
    : false;

// Note that all metrics here are fully anonymous.
// No user information is tracked & no events are
// sent including anything personally identifiable.
// Session ids are not persistent, and are only passed
// through a single session, e.g. one checkout flow.

// 8 bytes = 64 bits = 1/hundreds of million odds that
// we'll ever see a duplicate, given the tiny number of
// sessions handled here.
// Moving to 16 (UUID) would be safer but needlessly long
// & awkward. Could do later if we add metrics for very
// common events, but seems unlikely.
export const generateSessionId = () => crypto.randomBytes(8).toString("hex");

/**
 * Tracks a single event in Posthog, associated with
 * the given session id.
 *
 * If this is called at least once in a handler, it must
 * await on flushMetrics later.
 */
export function trackEvent(
    sessionId: string,
    category: string,
    action: string,
    eventProperties: Record<string, any> = {}
) {
    if (!posthog) return;

    posthog.capture({
        distinctId: sessionId,
        event: `${category}:${action}`,
        properties: eventProperties
    });
};

/**
 * Due to the serverless setup, we need to make sure we
 * flush metrics before the handler ends. Any handler
 * that calls trackEvent must either await on this later.
 */
export async function flushMetrics() {
    if (!posthog) return;
    await posthog.flushAsync();
}