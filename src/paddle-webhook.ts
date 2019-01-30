import { Handler, APIGatewayProxyEvent } from 'aws-lambda';

export const handler: Handler = async (event: APIGatewayProxyEvent) => {
    console.log('Received Paddle webhook', event);
    return { statusCode: 200, body: event.body };
}