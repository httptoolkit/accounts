# HTTP Toolkit Accounts

This repo contains the different components that power HTTP Toolkit account management (purchases, password reset, etc).

The code here isn't really relevant to most users of HTTP Toolkit, and runs separately to the downloaded application. It's effectively internal back-office logic. It's open anyway, because it's always interesting to see how a business's internals really work, enjoy!

The components defined here are:

* An API, defined as Netlify serverless functions to load user data, subscription plan details & handle Paddle webhooks.
* A tiny SPA site, to which users can log in to manage their subscriptions.
* A JS module used to handle authentication logic common to the accounts SPA, the main website, and HTTP Toolkit itself.