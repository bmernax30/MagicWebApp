import 'server-only';
import { ZodError } from 'zod';
import { database } from '../db/client';
import { GameError, gameService } from './game-service';
export const service = () => gameService(database());
export function checkOrigin(request: Request) {
    const origin = request.headers.get('origin');
    // Non-browser callers may omit Origin; JSON validation still applies.
    if (origin === null) return;

    let expectedOrigin: string | undefined;
    try {
        const url = new URL(request.url);
        // Next can construct request.url using the bind address (0.0.0.0),
        // even when the browser connected through a LAN IP or localhost.
        // Host carries that browser-facing authority, including its port.
        // Do not trust arbitrary X-Forwarded-Host headers as an alternative.
        const host = request.headers.get('host') ?? url.host;
        const target = new URL(`${url.protocol}//${host}`);
        if ((target.protocol === 'http:' || target.protocol === 'https:') &&
            !target.username && !target.password && target.pathname === '/' &&
            !target.search && !target.hash) {
            expectedOrigin = target.origin;
        }
    } catch {
        // Invalid authorities fail closed with the same useful 403 response.
    }
    if (origin !== expectedOrigin)
        throw new GameError('Cross-origin changes are not allowed.', 403);
}
export async function readJson(request: Request) {
    if (!request.headers.get('content-type')?.includes('application/json'))
        throw new GameError('JSON input is required.', 415);
    const body = await request.text();
    if (body.length > 100000)
        throw new GameError('Request too large.', 413);
    try {
        return JSON.parse(body) as unknown;
    }
    catch {
        throw new GameError('Invalid JSON.');
    }
}
export async function respond(work: () => unknown | Promise<unknown>) {
    try {
        return Response.json(await work(), { headers: { 'Cache-Control': 'no-store' } });
    }
    catch (error) {
        if (error instanceof ZodError)
            return Response.json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
        if (error instanceof GameError)
            return Response.json({ error: error.message }, { status: error.status });
        console.error(error);
        return Response.json({ error: 'Game service unavailable. Check database setup and server logs.' }, { status: 503 });
    }
}
