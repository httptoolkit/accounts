import { initSentry, catchErrors } from '../errors.ts';
initSentry();

/*
Paddle calls this when an order for a lifetime license completes, and emails whatever we
return (as Markdown) to the customer with their receipt. The license itself is activated
separately, by the payment_succeeded event sent to our main Paddle webhook, so there's
nothing to do here but respond.
*/
export const handler = catchErrors(async () => {
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/none' },
        body: ''
    };
});
