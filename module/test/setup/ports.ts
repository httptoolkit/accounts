// Fixed constants shared by the test infrastructure. Lives in its own module
// so the fixture generator, env preloader and harness all agree, and so
// importing this file never triggers auth.ts evaluation.

export const MOCKTTP_PORT = 48556;
export const MOCK_API_BASE = `http://localhost:${MOCKTTP_PORT}`;

// All tests run as if "now" were this instant. The fixture generator signs
// JWT fixtures with timestamps relative to this; the harness pins the test
// process's Date.now() to it via sinon fake timers.
export const FIXTURE_NOW = Date.UTC(2000, 0, 1, 0, 0, 0); // 2000-01-01T00:00:00Z
