import { APIGatewayProxyEvent } from "aws-lambda";

const ONE_DAY_IN_SECONDS = 60 * 60 * 24;

export function getCorsResponseHeaders(event: APIGatewayProxyEvent) {
    const corsHeaders: { [key: string]: string } = {
        'Access-Control-Allow-Headers': 'Authorization',
        'Access-Control-Max-Age': ONE_DAY_IN_SECONDS.toString(), // Chrome will cache for 10 mins max anyway
    };

    if (event.httpMethod === 'OPTIONS') {
        // The OPTIONS result is effectively constant - cache for 24h:
        corsHeaders['Cache-Control'] = 'public, max-age=' + ONE_DAY_IN_SECONDS
        corsHeaders['Vary'] = 'Authorization';
    }

    // Check the origin, include CORS if it's *.httptoolkit.tech
    const { origin } = event.headers;
    let allowedOrigin = /^https?:\/\/(.*\.)?httptoolkit.tech(:\d+)?$/.test(origin) ?
        origin : undefined;

    if (allowedOrigin) {
        corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
    } else if (origin) {
        console.warn('CORS request from invalid origin!', origin);
    }

    return corsHeaders;
}