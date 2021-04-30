import * as React from 'react';

import { observer } from 'mobx-react-lite';

import { theme, ThemeProvider, GlobalStyles } from './styles';

import { AccountStore } from './account-store';
import { LoginPage } from './login-page';
import { AccountPage } from './account-page';

export const App = observer((props: { accountStore: AccountStore }) =>
    <ThemeProvider theme={theme}>
        <GlobalStyles />
        {
            (!props.accountStore.isLoggedIn)
            ? <LoginPage accountStore={props.accountStore} />
            : <AccountPage accountStore={props.accountStore} />
        }
    </ThemeProvider>
);