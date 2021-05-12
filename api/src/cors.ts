import { APIGatewayProxyEvent } from "aws-lambda";

const ONE_DAY_IN_SECONDS = 60 * 60 * 24;

export function getCorsResponseHeaders(event: APIGatewayProxyEvent) {
    const corsHeaders: { [key: string]: string } = {
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': ONE_DAY_IN_SECONDS.toString(), // Chrome will cache for 10 mins max anyway
    };

    if (event.httpMethod === 'OPTIONS') {
        // The OPTIONS result is effectively constant - cache for 24h:
        corsHeaders['Cache-Control'] = 'public, max-age=' + ONE_DAY_IN_SECONDS
        corsHeaders['Vary'] = 'Authorization, Origin';
    } else {
        // Be explicit that CORS responses vary on origin. Authorization may be
        // unnecessary here (as long as cache-control public isn't set later),
        // but there's no real downside.
        corsHeaders['Vary'] = 'Authorization, Origin';
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