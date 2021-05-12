import * as _ from 'lodash';
import * as net from 'net';
import fetch from 'node-fetch';
import stoppable from 'stoppable';

import { expect } from 'chai';

import {
    startServer,
    auth0Server,
    AUTH0_PORT,
    freshAuthToken,
    paddleServer,
    PADDLE_PORT,
    givenNoUsers,
    givenUser,
    givenNoUser,
    givenTeam,
    watchUserCreation,
    watchUserUpdates
} from './test-util';
import { PayingUserMetadata, TeamMemberMetadata } from '../src/auth0';

const updateTeam = (server: net.Server, authToken: string | undefined, team: {
    idsToRemove?: string[],
    emailsToAdd?: string[]
}) => fetch(
    `http://localhost:${(server.address() as net.AddressInfo).port}/update-team`,
    {
        method: 'POST',
        headers: {
            ...(authToken
                ? { Authorization: `Bearer ${authToken}` }
                : {}
            ),
            'content-type': 'application/json'
        },
        body: JSON.stringify(team)
    }
);

describe('/update-team', () => {

    let functionServer: stoppable.StoppableServer;

    beforeEach(async () => {
        functionServer = await startServer();

        await auth0Server.start(AUTH0_PORT);
        await auth0Server.post('/oauth/token').thenReply(200);

        await paddleServer.start(PADDLE_PORT);
    });

    afterEach(async () => {
        await new Promise((resolve) => functionServer.stop(resolve));
        await auth0Server.stop();
        await paddleServer.stop();
    });

    describe("for unauthed users", () => {
        it("returns 401", async () => {
            const response = await updateTeam(functionServer, undefined, {
                emailsToAdd: ['a@b.com']
            });
            expect(response.status).to.equal(401);
        });
    });

    describe("for free users", () => {
        it("returns 403", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';

            await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: userId });
            await auth0Server.get('/api/v2/users/' + userId).thenJson(200, {
                email: userEmail,
                app_metadata: { }
            });
            await auth0Server.get('/api/v2/users').thenJson(200, []);

            const response = await updateTeam(functionServer, authToken, {
                emailsToAdd: ['a@b.com']
            });
            expect(response.status).to.equal(403);
        });
    });

    describe("for Pro users", () => {
        it("returns 403", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';
            const subExpiry = Date.now();

            await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: userId });
            await auth0Server.get('/api/v2/users/' + userId)
                .thenJson(200, {
                    email: userEmail,
                    app_metadata: {
                        subscription_expiry: subExpiry,
                        subscription_id: 2,
                        subscription_plan_id: 550380,
                        subscription_status: "active"
                    }
                });
            await auth0Server.get('/api/v2/users').thenJson(200, []);

            const response = await updateTeam(functionServer, authToken, {
                emailsToAdd: ['a@b.com']
            });
            expect(response.status).to.equal(403);
        });
    });

    describe("for Team users", () => {
        it("allows removing a user by id", async () => {
            const team = _.range(4).map((i) => ({
                id: i.toString(),
                email: `member${i}@example.com`
            }));

            const { ownerId, ownerAuthToken } = await givenTeam(team);

            const getUserUpdates = await watchUserUpdates();

            const response = await updateTeam(functionServer, ownerAuthToken, {
                idsToRemove: [team[0].id, team[3].id]
            });

            expect(response.status).to.equal(200);

            const updates = await getUserUpdates();
            expect(updates).to.deep.equal([
                {
                    url: `/api/v2/users/${team[0].id}`,
                    body: {
                        app_metadata: {
                            subscription_owner_id: null,
                            joined_team_at: null
                        }
                    }
                },
                {
                    url: `/api/v2/users/${team[3].id}`,
                    body: {
                        app_metadata: {
                            subscription_owner_id: null,
                            joined_team_at: null
                        }
                    }
                },
                {
                    url: `/api/v2/users/${ownerId}`,
                    body: {
                        app_metadata: {
                            team_member_ids: [
                                team[1].id,
                                team[2].id
                            ]
                        }
                    }
                }
            ]);
        });

        it("allows adding a new user by email", async () => {
            const team = [
                { id: 'id-1', email: `member1@example.com` },
                undefined // 1 empty space
            ] as const;

            const { ownerId, ownerAuthToken } = await givenTeam(team);

            await givenNoUsers();
            const getNewUsers = await watchUserCreation();
            const getUserUpdates = await watchUserUpdates();

            const response = await updateTeam(functionServer, ownerAuthToken, {
                emailsToAdd: ['test@example.com']
            });

            expect(response.status).to.equal(200);

            const newUsers = await getNewUsers();
            expect(newUsers.length).to.equal(1);
            expect(newUsers[0].url).to.equal('/api/v2/users');
            expect(newUsers[0].body.email).to.equal('test@example.com');
            expect(newUsers[0].body.email_verified).to.equal(true);

            const newUserMetadata = newUsers[0].body.app_metadata;
            expect(newUserMetadata.subscription_owner_id).to.equal(
                ownerId
            );
            // Can't deep match because of this timestamp:
            expect(newUserMetadata.joined_team_at).to.match(
                /202\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ/
            );

            const updates = await getUserUpdates();
            expect(updates).to.deep.equal([
                {
                    url: `/api/v2/users/${ownerId}`,
                    body: {
                        app_metadata: {
                            team_member_ids: [
                                team[0].id,
                                'new-user-0'
                            ]
                        }
                    }
                }
            ]);
        });

        it("allows adding an existing user by email", async () => {
            const team = [
                { id: 'id-1', email: `member1@example.com` },
                undefined // 1 empty space
            ] as const;

            const { ownerId, ownerAuthToken } = await givenTeam(team);

            const existingUserId = 'existing-user';
            const existingUserEmail = 'existing@example.com';

            await givenUser(existingUserId, existingUserEmail);
            const getNewUsers = await watchUserCreation();
            const getUserUpdates = await watchUserUpdates();

            const response = await updateTeam(functionServer, ownerAuthToken, {
                emailsToAdd: [existingUserEmail]
            });

            expect(response.status).to.equal(200);

            const newUsers = await getNewUsers();
            expect(newUsers.length).to.equal(0);

            const updates = await getUserUpdates();
            expect(updates.length).to.equal(2);

            const memberUpdate = updates[0];
            expect(memberUpdate.url).to.equal(`/api/v2/users/${existingUserId}`);
            const updatedMemberMetadata = memberUpdate.body!.app_metadata;
            expect(updatedMemberMetadata.subscription_owner_id).to.equal(ownerId);
            // Can't deep match because of this timestamp:
            expect(updatedMemberMetadata.joined_team_at).to.match(
                /202\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ/
            );

            const ownerUpdate = updates[1];
            expect(ownerUpdate).to.deep.equal({
                url: `/api/v2/users/${ownerId}`,
                body: {
                    app_metadata: {
                        team_member_ids: [
                            team[0].id,
                            existingUserId
                        ]
                    }
                }
            });
        });

        it("allows adding and removing many team members all in one go", async () => {
            const team = [
                { id: 'id-1', email: `member1@example.com` },
                { id: 'id-2', email: `member2@example.com` },
                // No empty spaces!
            ] as const;

            const { ownerId, ownerAuthToken } = await givenTeam(team);

            const existingUserId = 'existing-user';
            const existingUserEmail = 'existing@example.com';
            const newUserEmail = 'new@example.com';

            await givenNoUser(newUserEmail);
            await givenUser(existingUserId, existingUserEmail);
            const getNewUsers = await watchUserCreation();
            const getUserUpdates = await watchUserUpdates();

            const response = await updateTeam(functionServer, ownerAuthToken, {
                idsToRemove: team.map(m => m.id),
                emailsToAdd: [newUserEmail, existingUserEmail]
            });

            expect(response.status).to.equal(200);

            // Creates 1 new user on the team:
            const newUsers = await getNewUsers();
            expect(newUsers.length).to.equal(1);
            expect(newUsers[0].url).to.equal('/api/v2/users');
            expect(newUsers[0].body.email).to.equal(newUserEmail);
            expect(newUsers[0].body.email_verified).to.equal(true);

            const newUserMetadata = newUsers[0].body.app_metadata;
            expect(newUserMetadata.subscription_owner_id).to.equal(
                ownerId
            );
            // Can't deep match because of this timestamp:
            expect(newUserMetadata.joined_team_at).to.match(
                /202\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ/
            );


            const updates = await getUserUpdates();
            expect(updates.length).to.equal(4);

            // Removes the 2 existing team members:
            expect(updates.slice(0, 2)).to.deep.equal([
                {
                    url: `/api/v2/users/${team[0].id}`,
                    body: {
                        app_metadata: {
                            subscription_owner_id: null,
                            joined_team_at: null
                        }
                    }
                },
                {
                    url: `/api/v2/users/${team[1].id}`,
                    body: {
                        app_metadata: {
                            subscription_owner_id: null,
                            joined_team_at: null
                        }
                    }
                }
            ]);

            // Updates the existing user who's joining:
            const memberUpdate = updates[2];
            expect(memberUpdate.url).to.equal(`/api/v2/users/${existingUserId}`);
            const updatedMemberMetadata = memberUpdate.body!.app_metadata;
            expect(updatedMemberMetadata.subscription_owner_id).to.equal(ownerId);
            // Can't deep match because of this timestamp:
            expect(updatedMemberMetadata.joined_team_at).to.match(
                /202\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ/
            );

            const ownerUpdate = updates[3];
            expect(ownerUpdate).to.deep.equal({
                url: `/api/v2/users/${ownerId}`,
                body: {
                    app_metadata: {
                        team_member_ids: [
                            'new-user-0',
                            existingUserId
                        ]
                    }
                }
            });
        });

        it("does not allow adding team members beyond the subscribed quantity", async () => {
            const team = [
                { id: 'id-1', email: `member1@example.com` },
                // No empty spaces!
            ] as const;

            const { ownerAuthToken } = await givenTeam(team);

            await givenNoUsers();
            const getUserUpdates = await watchUserUpdates();

            const response = await updateTeam(functionServer, ownerAuthToken, {
                emailsToAdd: ['test@example.com']
            });

            expect(response.status).to.equal(403);
            expect((await getUserUpdates()).length).to.equal(0);
        });

        it("does not allow adding team members who are already in the team", async () => {
            const team = [
                { id: 'id-1', email: 'member1@example.com' },
                undefined // One empty space
            ] as const;

            const { ownerAuthToken } = await givenTeam(team);

            await givenNoUsers();
            const getUserUpdates = await watchUserUpdates();

            const response = await updateTeam(functionServer, ownerAuthToken, {
                emailsToAdd: ['member1@example.com']
            });

            expect(response.status).to.equal(409);
            expect((await getUserUpdates()).length).to.equal(0);
        });

        it("does not allow adding duplicate team members", async () => {
            const team = [
                undefined,
                undefined // Two empty spaces
            ] as const;

            const { ownerAuthToken } = await givenTeam(team);

            await givenNoUsers();
            const getUserUpdates = await watchUserUpdates();

            const response = await updateTeam(functionServer, ownerAuthToken, {
                emailsToAdd: ['member1@example.com', 'member1@example.com']
            });

            expect(response.status).to.equal(400);
            expect((await getUserUpdates()).length).to.equal(0);
        });

        it("does not allow adding team members who are independently subscribed", async () => {
            const team = [
                { id: 'id-1', email: `member1@example.com` },
                undefined // 1 empty space
            ] as const;

            const { ownerAuthToken } = await givenTeam(team);

            const existingUserId = 'existing-user';
            const existingUserEmail = 'existing@example.com';

            await givenUser(existingUserId, existingUserEmail, {
                paddle_user_id: 123,
                subscription_id: 234,
                subscription_quantity: 1,
                subscription_plan_id: 550380,
                update_url: 'uu',
                cancel_url: 'cu',
                subscription_status: 'active',
                subscription_expiry: Date.now() + 1000
            } as PayingUserMetadata);
            const getUserUpdates = await watchUserUpdates();

            const response = await updateTeam(functionServer, ownerAuthToken, {
                emailsToAdd: [existingUserEmail]
            });

            expect(response.status).to.equal(409);
            expect((await getUserUpdates()).length).to.equal(0);
        });

        it("does allow adding team members who recently cancelled", async () => {
            const team = [
                { id: 'id-1', email: `member1@example.com` },
                undefined // 1 empty space
            ] as const;

            const { ownerAuthToken } = await givenTeam(team);

            const existingUserId = 'existing-user';
            const existingUserEmail = 'existing@example.com';

            await givenUser(existingUserId, existingUserEmail, {
                paddle_user_id: 123,
                subscription_id: 234,
                subscription_quantity: 1,
                subscription_plan_id: 550380,
                update_url: 'uu',
                cancel_url: 'cu',
                subscription_status: 'deleted', // <-- Recently unsubscribed
                subscription_expiry: Date.now() + 1000
            } as PayingUserMetadata);
            const getUserUpdates = await watchUserUpdates();
            const response = await updateTeam(functionServer, ownerAuthToken, {
                emailsToAdd: [existingUserEmail]
            });

            expect(response.status).to.equal(200);
            expect((await getUserUpdates()).length).to.equal(2);
        });

        it("does not allow adding team members who are already in another team", async () => {
            const team = [
                { id: 'id-1', email: `member1@example.com` },
                undefined // 1 empty space
            ] as const;

            const { ownerAuthToken } = await givenTeam(team);

            const existingUserId = 'existing-user';
            const existingUserEmail = 'existing@example.com';

            await givenUser(existingUserId, existingUserEmail, {
                subscription_owner_id: 'another-owner-321'
            } as TeamMemberMetadata);
            const getUserUpdates = await watchUserUpdates();

            const response = await updateTeam(functionServer, ownerAuthToken, {
                emailsToAdd: [existingUserEmail]
            });

            expect(response.status).to.equal(409);
            expect((await getUserUpdates()).length).to.equal(0);
        });

        it("does not allow duplicate team members removals", async () => {
            const team = [
                { id: 'id-1', email: 'member1@example.com' },
                undefined // One empty space
            ] as const;

            const { ownerAuthToken } = await givenTeam(team);

            await givenNoUsers();
            const getUserUpdates = await watchUserUpdates();

            const response = await updateTeam(functionServer, ownerAuthToken, {
                idsToRemove: [team[0].id, team[0].id]
            });

            expect(response.status).to.equal(400);
            expect((await getUserUpdates()).length).to.equal(0);
        });

        it("does not allow removing team members who are not in this team", async () => {
            const team = [
                { id: 'id-1', email: `member1@example.com` }
            ] as const;

            const { ownerAuthToken } = await givenTeam(team);

            const existingUserId = 'existing-user';
            const existingUserEmail = 'existing@example.com';

            await givenUser(existingUserId, existingUserEmail, {
                subscription_owner_id: 'another-owner-321'
            } as TeamMemberMetadata);
            const getUserUpdates = await watchUserUpdates();

            const response = await updateTeam(functionServer, ownerAuthToken, {
                idsToRemove: ['unrelated-id']
            });

            expect(response.status).to.equal(409);
            expect((await getUserUpdates()).length).to.equal(0);
        });
    });
});