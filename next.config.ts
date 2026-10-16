import type { NextConfig } from 'next';

const config: NextConfig = {
    serverExternalPackages: ['better-sqlite3'],
    // Opt in for environments that allow worker threads but prohibit child processes.
    // Type checking remains enabled through the TypeScript compiler API.
    experimental: process.env.MAGIC_RESTRICTED_BUILD === '1' ? {
        useTypeScriptCli: false,
        webpackBuildWorker: false,
        workerThreads: true,
        cpus: 2,
    } : undefined,
};
export default config;
