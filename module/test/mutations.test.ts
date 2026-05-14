import {
    expect,
    expectRejection,
    FIXTURE_NOW,
    getServer,
    seedTokens
} from './setup/harness.js';

import {
    cancelSubscription,
    updateTeamMembers,
    updateTeamSize
} from '../src/auth.js';

function seedWithValidTokens(): void {
    seedTokens({
        accessToken: 'live-access',
        refreshToken: 'live-refresh',
        accessTokenExpiry: FIXTURE_NOW + 60 * 60 * 1000
    });
}

describe('cancelSubscription', () => {
    it('POSTs to /cancel-subscription with the Authorization header', async () => {
        seedWithValidTokens();
        const endpoint = await getServer().forPost('/cancel-subscription').thenReply(200);

        await cancelSubscription();

        const seen = await endpoint.getSeenRequests();
        expect(seen).to.have.lengthOf(1);
        expect(seen[0].headers.authorization).to.equal('Bearer live-access');
    });
});

describe('updateTeamMembers', () => {
    it('POSTs the ids and emails with the auth token', async () => {
        seedWithValidTokens();
        const endpoint = await getServer().forPost('/update-team').thenReply(200);

        await updateTeamMembers(['old-id-1', 'old-id-2'], ['new@example.invalid']);

        const seen = await endpoint.getSeenRequests();
        expect(seen).to.have.lengthOf(1);
        expect(seen[0].headers.authorization).to.equal('Bearer live-access');
        expect(seen[0].headers['content-type']).to.equal('application/json');
        const body = await seen[0].body.getJson() as { idsToRemove: string[]; emailsToAdd: string[] };
        expect(body).to.deep.equal({
            idsToRemove: ['old-id-1', 'old-id-2'],
            emailsToAdd: ['new@example.invalid']
        });
    });

    // The same `if (!token) throw` guard exists on every mutation endpoint
    // (cancelSubscription, updateTeamMembers, updateTeamSize); tested once
    // here on behalf of the family.
    it('throws when there is no auth token', async () => {
        const err = await expectRejection(updateTeamMembers([], []));
        expect(err.message).to.include("Can't update team without an auth token");
    });

    it('surfaces the server response body in the error message', async () => {
        seedWithValidTokens();
        await getServer().forPost('/update-team').thenReply(400, 'invalid email: not-an-email');

        const err = await expectRejection(updateTeamMembers([], ['not-an-email']));
        expect(err.message).to.equal('invalid email: not-an-email');
    });

    it('falls back to a generic message when the server body is empty', async () => {
        seedWithValidTokens();
        await getServer().forPost('/update-team').thenReply(500, '');

        const err = await expectRejection(updateTeamMembers([], []));
        expect(err.message).to.equal('Failed to update team members');
    });
});

describe('updateTeamSize', () => {
    it('POSTs the new team size with the auth token', async () => {
        seedWithValidTokens();
        const endpoint = await getServer().forPost('/update-team-size').thenReply(200);

        await updateTeamSize(10);

        const seen = await endpoint.getSeenRequests();
        expect(seen).to.have.lengthOf(1);
        expect(seen[0].headers.authorization).to.equal('Bearer live-access');
        const body = await seen[0].body.getJson() as { newTeamSize: number };
        expect(body).to.deep.equal({ newTeamSize: 10 });
    });

    it('surfaces the server response body in the error message', async () => {
        seedWithValidTokens();
        await getServer().forPost('/update-team-size').thenReply(400, 'team size below minimum');

        const err = await expectRejection(updateTeamSize(1));
        expect(err.message).to.equal('team size below minimum');
    });
});
