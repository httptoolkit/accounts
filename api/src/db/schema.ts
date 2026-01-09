import { Generated } from 'kysely';
import { AppMetadata } from '../user-data-facade.ts';

export interface Database {
    users: {
        id: Generated<number>;
        auth0_user_id: string | null;
        email: string;
        app_metadata: AppMetadata;

        last_ip: string | null;
        last_login: Date | null;
        logins_count: Generated<number>;
        created_at: Generated<Date>;
    };
}