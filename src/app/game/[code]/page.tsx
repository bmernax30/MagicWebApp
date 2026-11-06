import { GameTable } from '@/components/game-table';
export default async function GamePage({ params, searchParams }: {
    params: Promise<{ code: string }>;
    searchParams: Promise<{ view?: string | string[]; archive?: string | string[] }>;
}) {
    const [{ code }, query] = await Promise.all([params, searchParams]);
    const view = typeof query.view === 'string' && /^(scoreboard|compact|select|log|[1-6])$/.test(query.view) ? query.view : 'scoreboard';
    return <GameTable key={code.toUpperCase()} code={code.toUpperCase()} initialView={view} archive={query.archive === '1'}/>;
}
