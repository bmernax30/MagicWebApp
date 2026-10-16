import { checkOrigin, readJson, respond, service } from '@/server/http';
export const runtime = 'nodejs';
export async function POST(request: Request) { return respond(async () => { checkOrigin(request); return service().create(await readJson(request)); }); }
