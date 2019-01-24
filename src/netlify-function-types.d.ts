import { APIGatewayProxyEvent } from "aws-lambda";

declare interface NetlifyEvent extends APIGatewayProxyEvent {
    clientContext: {
        identity: { url: string, token: string };
        user?: Object;
    };
}