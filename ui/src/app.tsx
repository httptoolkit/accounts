import * as React from 'react';

import { observer } from 'mobx-react-lite';

import { theme, ThemeProvider, GlobalStyles } from './styles';

import { AccountStore } from './account-store';
import { LoginPage } from './login-page';
import { AccountPage, PlaceholderAccountPage } from './account-page';

export const App = observer((props: {
    isSSR?: true,
    accountStore: AccountStore
}) =>
    <ThemeProvider theme={theme}>
        <GlobalStyles />
        {
            props.accountStore.isLoggedIn
                ? <AccountPage accountStore={props.accountStore} />
            : (props.accountStore.isMaybeLoggedIn || props.isSSR)
                ? <PlaceholderAccountPage accountStore={props.accountStore} />
            : <LoginPage accountStore={props.accountStore} />
        }
    </ThemeProvider>
);