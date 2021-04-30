import * as React from 'react';
import * as ReactDOM from 'react-dom';

import { AccountStore } from './account-store';

import { App } from './app';

const accountStore = new AccountStore();

ReactDOM.render(
    <App accountStore={accountStore} />,
    document.querySelector('#app')
);