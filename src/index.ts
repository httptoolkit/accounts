import { Handler } from 'aws-lambda';

export const handler: Handler = async (event, context) => {
    console.log('Received request', event);
    return { statusCode: 200, body: 'Hello world' };
}