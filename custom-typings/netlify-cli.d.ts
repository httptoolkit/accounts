declare module '@httptoolkit/netlify-cli/src/utils/serve-functions' {
    import * as http from 'http';

    export function serveFunctions(options: {
        functionsDir: string,
        port: number,
        quiet?: boolean,
        watch?: boolean
    }): {
        port: number,
        server: http.Server
    };
}