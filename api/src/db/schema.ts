import { Generated } from 'kysely';
import { AppMetadata } from '../user-data-facade.ts';

export interface Database {
    users: {
        id: Generated<number>;
        auth0_user_id: string;
        email: string;
        app_metadata: AppMetadata;

        last_ip: string | null;
        last_login: Date | null;
        logins_count: Generated<number>;
        created_at: Generated<Date>;
    };
    refresh_tokens: {
        value: string;
        user_id: number;
        created_at: Generated<Date>;
        last_used: Generated<Date>;
    };
    access_tokens: {
        value: string;
        refresh_token: string;
        created_at: Generated<Date>;
        expires_at: Date;
    };
}