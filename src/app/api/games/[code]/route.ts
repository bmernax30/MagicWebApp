import { checkOrigin, readJson, respond, service } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = {
    params: Promise<{
        code: string;
    }>;
};
export async function GET(_request: Request, context: Context) { return respond(async () => service().get((await context.params).code.toUpperCase())); }
export async function POST(request: Request, context: Context) { return respond(async () => { checkOrigin(request); return service().act((await context.params).code.toUpperCase(), await readJson(request)); }); }
