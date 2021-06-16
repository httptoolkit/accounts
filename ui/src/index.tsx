import { initSentry } from './errors';
initSentry();

import * as React from 'react';
import * as ReactDOM from 'react-dom';

import { AccountStore } from './account-store';

import { App } from './app';

const isSSR = (self as {
    PRERENDER?: true
}).PRERENDER;

const accountStore = new AccountStore(isSSR);

ReactDOM.render(
    <App accountStore={accountStore} isSSR={isSSR} />,
    document.querySelector('#app')
);