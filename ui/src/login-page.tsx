import * as React from 'react';

import { AccountStore } from './account-store';

export const LoginPage = (props: {
    accountStore: AccountStore
}) => {
    const { accountStore } = props;

    React.useEffect(() => {
        if (!accountStore.isLoggedIn) {
            accountStore.showLoginDialog();
        }
    }, [accountStore]);

    // Don't actually render - the login dialog handles everything
    return null;
};