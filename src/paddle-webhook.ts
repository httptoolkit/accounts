import { Handler } from 'aws-lambda';
import { NetlifyEvent } from './netlify-function-types';

export const handler: Handler = async (event: NetlifyEvent, context) => {
    console.log('Received Paddle webhook', event);
    return { statusCode: 200, body: event.body };
}