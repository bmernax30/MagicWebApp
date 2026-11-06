import { GameError } from '@/server/game-service';
import { respond, service } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
    return respond(async () => {
        const raw = new URL(request.url).searchParams.get('before');
        const before = raw === null ? undefined : Number(raw);
        if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new GameError('Invalid log cursor.');
        return service().log((await context.params).code.toUpperCase(), before);
    });
}
