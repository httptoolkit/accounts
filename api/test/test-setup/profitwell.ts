import * as path from 'path';
import { getLocal } from 'mockttp';

export const PROFITWELL_API_PORT = 9094;
process.env.PROFITWELL_API_BASE_URL = `http://localhost:${PROFITWELL_API_PORT}`;

export const profitwellApiServer = getLocal({
    https: {
        keyPath: path.join(__dirname, '..', 'fixtures', 'test-ca.key'),
        certPath: path.join(__dirname, '..', 'fixtures', 'test-ca.pem'),
        keyLength: 2048
    }
});

beforeEach(async () => {
    // Weneed to make sure the Profitwell API responds, or incidental requests
    // in tests will retry for hours, stopping the tests exiting:
    await profitwellApiServer.start(PROFITWELL_API_PORT);
    await profitwellApiServer.forUnmatchedRequest().thenReply(200);
});

afterEach(async () => {
    await profitwellApiServer.stop();
});