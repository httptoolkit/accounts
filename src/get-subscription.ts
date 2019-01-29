import { Handler } from 'aws-lambda';

export const handler: Handler = async (event, context) => {
    console.log('Received get subscription request', event, context, process.env);
    return { statusCode: 200, body: event.body };
}