import { Handler } from 'aws-lambda';
import { NetlifyEvent } from '../custom-typings/netlify-function-types';

export const handler: Handler = async (event: NetlifyEvent, context) => {
    console.log('Received identity-validate webhook', event);
    return { statusCode: 200, body: event.body };
}