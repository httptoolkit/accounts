import {
    expect,
    expectRejection,
    FIXTURE_NOW,
    getServer,
    readStoredState,
    seedTokens
} from './setup/harness.js';

import { AuthRejectedError, loginWithCode, logOut, sendAuthCode } from '../src/auth.js';

describe('sendAuthCode', () => {
    it('POSTs email + source to /auth/send-code on success', async () => {
        const endpoint = await getServer().forPost('/auth/send-code').thenReply(200);

        await sendAuthCode('user@example.invalid', 'web');

        const requests = await endpoint.getSeenRequests();
        expect(requests).to.have.lengthOf(1);
        const body = await requests[0].body.getJson() as { email: string; source: string };
        expect(body).to.deep.equal({ email: 'user@example.invalid', source: 'web' });
        expect(requests[0].headers['content-type']).to.equal('application/json');
    });

    it('wraps non-2xx responses with the body in the error message', async () => {
        await getServer().forPost('/auth/send-code').thenReply(429, 'rate limited');

        const err = await expectRejection(sendAuthCode('user@example.invalid', 'web'));
        expect((err as Error).message).to.include('Failed to send auth code');
        expect((err as Error).message).to.include('429');
        expect((err as Error).message).to.include('rate limited');
    });
});

describe('loginWithCode', () => {
    it('persists returned tokens to storage on success', async () => {
        const expiresAt = FIXTURE_NOW + 60 * 60 * 1000;
        await getServer().forPost('/auth/login').thenJson(200, {
            accessToken: 'access-tok',
            refreshToken: 'refresh-tok',
            expiresAt
        });

        await loginWithCode('user@example.invalid', '123456');

        expect(readStoredState().tokens).to.deep.equal({
            accessToken: 'access-tok',
            refreshToken: 'refresh-tok',
            accessTokenExpiry: expiresAt
        });
    });

    it('throws AuthRejectedError on 403, leaving no tokens behind', async () => {
        await getServer().forPost('/auth/login').thenReply(403, 'no');

        await expectRejection(loginWithCode('user@example.invalid', 'wrong'), AuthRejectedError);
        expect(readStoredState().tokens).to.equal(null);
    });

    it('wraps other non-2xx responses', async () => {
        await getServer().forPost('/auth/login').thenReply(500, 'oops');

        const err = await expectRejection(loginWithCode('user@example.invalid', '123456'));
        expect(err.constructor.name).to.equal('Error');
        expect(err.message).to.include('Failed to login with code');
        expect(err.message).to.include('500');
    });
});

describe('logOut', () => {
    it('clears persisted tokens', async () => {
        seedTokens({
            accessToken: 'access',
            refreshToken: 'refresh',
            accessTokenExpiry: FIXTURE_NOW + 60_000
        });
        expect(readStoredState().tokens).to.not.equal(null);

        await logOut();

        expect(readStoredState().tokens).to.equal(null);
    });
});
