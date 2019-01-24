import { Handler } from 'aws-lambda';

export const handler: Handler = (event, context, callback) => {
    callback(null, {
        statusCode: 200,
        body: 'Hello world'
    });
}