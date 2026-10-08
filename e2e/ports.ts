/**
 * Where the E2E suite serves the client and runs its room server. The defaults suit a single run;
 * set E2E_SERVER_PORT and E2E_CLIENT_PORT to run a second suite at the same time (another worktree).
 */
export const E2E_SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 3101);
export const E2E_CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT ?? 5174);
export const E2E_SERVER_URL = `ws://127.0.0.1:${E2E_SERVER_PORT}`;
export const E2E_CLIENT_URL = `http://127.0.0.1:${E2E_CLIENT_PORT}`;
