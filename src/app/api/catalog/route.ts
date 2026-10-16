import { checkOrigin, readJson, respond, service } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { return respond(() => service().catalog()); }
export async function POST(request: Request) { return respond(async () => { checkOrigin(request); return service().saveCatalog(await readJson(request)); }); }
