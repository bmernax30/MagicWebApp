import { respond } from '@/server/http';
import { scryfall } from '@/server/scryfall';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
    return respond(() => scryfall.lookup(Object.fromEntries(new URL(request.url).searchParams)));
}
