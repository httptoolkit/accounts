import * as http from 'http';
import express = require('express');
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getCorsResponseHeaders } from './cors';

const app = express();

app.use(express.text({ type: '*/*' }));
app.set('trust proxy', 'loopback');

const apiRouter = express.Router();
app.use('/api', apiRouter);

// For historical reasons, most of the API is designed as serverless functions, but we now
// run everything as a simple single server. This converts between the two. Eventually
// we should just migrate each endpoint to normal (req, res) format, but not right now.
function lambdaWrapper(lambdaName: string) {
    const lambdaPromise = import(`./functions/${lambdaName}.ts`) as Promise<{
        handler: (event: APIGatewayProxyEvent, context: {}) => Promise<APIGatewayProxyResult>
    }>;

    return async (req: express.Request, res: express.Response) => {
        try {
            const { handler } = await lambdaPromise;

            const result = await handler(convertReqToLambdaEvent(req), {});

            res
            .status(result.statusCode ?? 200)
            .set(result.headers)
            .send(result.body);
        } catch (error: any) {
            res.status(500).send({ error: error.message });
        }
    }
}

const convertReqToLambdaEvent = (req: express.Request) => ({
    httpMethod: req.method,
    path: req.path,
    headers: req.headers as { [name: string]: string },
    queryStringParameters: req.query as { [name: string]: string },
    // ^ Bit of a simplication, but enough for our purposes
    body: req.body,
    requestContext: { identity: { sourceIp: req.ip } } as any
}) as APIGatewayProxyEvent;

apiRouter.options('*', (req, res) => {
    const event = convertReqToLambdaEvent(req);

    if (req.path === '/api/get-prices') {
        // Pricing data is CORS-accessible anywhere:
        const headers = getCorsResponseHeaders(event, /.*/);
        return res.status(204).set(headers).send();
    } else if ([
        '/get-app-data',
        '/get-billing-data',
        '/update-team',
        '/cancel-subscription'
    ].includes(req.path)) {
        // Account APIs are limited to our own hosts:
        const headers = getCorsResponseHeaders(event);
        return res.status(204).set(headers).send();
    } else {
        // Anything else doesn't support CORS requests (it's either for navigation,
        // as a redirect endpoint, or it's server-side only like a webhook).
        res.status(403).send({
            error: 'Cross-origin requests not supported'
        });
    }
});

apiRouter.get('/get-prices', lambdaWrapper('get-prices'));
apiRouter.get('/get-app-data', lambdaWrapper('get-app-data'));
apiRouter.get('/get-billing-data', lambdaWrapper('get-billing-data'));

apiRouter.post('/paddle-webhook', lambdaWrapper('paddle-webhook'));
apiRouter.post('/paypro-webhook', lambdaWrapper('paypro-webhook'));

apiRouter.get('/redirect-to-checkout', lambdaWrapper('redirect-to-checkout'));
apiRouter.get('/redirect-paypro-to-thank-you', lambdaWrapper('redirect-paypro-to-thank-you'));

apiRouter.post('/update-team', lambdaWrapper('update-team'));
apiRouter.post('/cancel-subscription', lambdaWrapper('cancel-subscription'));

export function startApiServer() {
    const server = app.listen(process.env.PORT ?? 3000, () => {
        console.log(`Server listening on port ${(server.address() as any).port}`);
    });

    return new Promise<http.Server>((resolve) =>
        server.on('listening', () => resolve(server))
    );
}

// Start the server if run directly (this is how things work normally). When run
// in tests, this is imported and the server is started & stopped manually instead.
if (require.main === module) {
    startApiServer();
}