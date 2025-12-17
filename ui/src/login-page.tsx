import * as React from 'react';

import { AccountStore } from './account-store';
import { LoginModal } from './login-modal';

export const LoginPage = (props: {
    accountStore: AccountStore
}) => {
    const { accountStore } = props;
    return <LoginModal accountStore={accountStore} />;
};