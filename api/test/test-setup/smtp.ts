import { GenericContainer, Wait } from 'testcontainers';

const SMTP_INTERNAL_PORT = 1025;
const API_INTERNAL_PORT = 8025;

console.log('Starting test SMTP...');

const smtpContainer = await new GenericContainer('axllent/mailpit')
    .withExposedPorts(SMTP_INTERNAL_PORT, API_INTERNAL_PORT)
    .withWaitStrategy(Wait.forLogMessage(/accessible via/))
    .withEnvironment({
        MP_SMTP_DISABLE_RDNS: 'true' // Significant boost given slow DNS
    })
    .start()
    .then((startedContainer) => {
        console.log('SMTP started');
        return startedContainer;
    })
    .catch((err) => {
        console.error('Failed to start test SMTP container:', err);
        process.exit(1);
    });

// Inject env vars
process.env.SMTP_HOST = smtpContainer.getHost();
process.env.SMTP_PORT = smtpContainer.getMappedPort(SMTP_INTERNAL_PORT).toString();
process.env.SMTP_USERNAME = 'user'; // Mailpit accepts any auth by default
process.env.SMTP_PASSWORD = 'pwd';
process.env.SMTP_IS_SECURE = 'false';

const apiUrl = `http://${smtpContainer.getHost()}:${smtpContainer.getMappedPort(API_INTERNAL_PORT)}/api/v1`;

export async function getReceivedEmails() {
    const res = await fetch(`${apiUrl}/messages`);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch emails: ${res.status} ${res.statusText} - ${text}`);
    }
    const data = await res.json() as { messages: any[] };
    return data.messages || [];
}

export async function getEmail(id: string) {
    const res = await fetch(`${apiUrl}/message/${id}`);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch email: ${res.status} ${res.statusText} - ${text}`);
    }
    return await res.json();
}

after(async () => {
    await smtpContainer.stop();
});

export async function deleteAllEmails() {
    const res = await fetch(`${apiUrl}/messages`, { method: 'DELETE' });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to clear emails: ${res.status} ${res.statusText} - ${text}`);
    }
}

beforeEach(async () => await deleteAllEmails());