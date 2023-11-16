import * as React from 'react';

import { observer } from 'mobx-react-lite';

import { theme, ThemeProvider, GlobalStyles } from './styles';

import { AccountStore } from './account-store';
import { LoginPage } from './login-page';
import { AccountPage, PlaceholderAccountPage } from './account-page';

export const App = observer((props: {
    accountStore: AccountStore
}) =>
    <ThemeProvider theme={theme}>
        <GlobalStyles />
        {
            props.accountStore.isLoggedIn
                ? <AccountPage accountStore={props.accountStore} />
            : (props.accountStore.isMaybeLoggedIn)
                ? <PlaceholderAccountPage accountStore={props.accountStore} />
            : <LoginPage accountStore={props.accountStore} />
        }
    </ThemeProvider>
);