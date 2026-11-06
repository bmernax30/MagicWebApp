'use client';
import { useEffect, useState } from 'react';
import type { Game, GameLog as Log } from '@/lib/types';
import { api } from './client-api';

export function GameLogScreen({ game, busy, onUndo }: { game: Game; busy: boolean; onUndo: (id: string, revision: number) => Promise<void> }) {
    const [log, setLog] = useState<Log | null>(null), [error, setError] = useState(''), [loadingMore, setLoadingMore] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        void api<Log>(`/api/games/${game.code}/log`, undefined, controller.signal).then(value => {
            if (!controller.signal.aborted) { setLog(value); setError(''); }
        }).catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); });
        return () => controller.abort();
    }, [game.code, game.revision]);
    async function older() {
        if (!log?.nextCursor) return;
        setLoadingMore(true);
        try {
            const next = await api<Log>(`/api/games/${game.code}/log?before=${log.nextCursor}`);
            setLog(current => current && current.revision === next.revision ? { ...current, entries: [...current.entries, ...next.entries], nextCursor: next.nextCursor } : current);
        } catch (e) { setError((e as Error).message); }
        finally { setLoadingMore(false); }
    }
    return <section className="panel game-log"><p className="eyebrow">TABLE HISTORY · NEWEST FIRST</p><h2>Game log</h2>
        <p>Undo walks backward through applied score changes in the current round. It restores both commander damage and its life change. Finished and exited games are locked.</p>
        {error && <p role="alert" className="error">{error}</p>}
        {!log && !error && <p role="status">Loading game log…</p>}
        {log && !log.entries.length && <p>No events recorded yet. Applied changes will appear here.</p>}
        <ol className="game-log-entries">{log?.entries.map(entry => <li key={entry.id} className={entry.undoneBy ? 'undone-event' : ''}>
            <div><small>Round {entry.round} · Update {entry.revision} · {entry.at ? new Date(entry.at).toLocaleString() : 'Earlier session'}</small>
                <p>{entry.message}</p>{entry.undoneBy && <span className="badge">Undone</span>}</div>
            {entry.canUndo && <button disabled={busy || game.status !== 'active' || log.revision !== game.revision} onClick={() => void onUndo(entry.id, log.revision)}>Undo</button>}
        </li>)}</ol>
        {log?.nextCursor && <button disabled={loadingMore} onClick={() => void older()}>{loadingMore ? 'Loading…' : 'Earlier events'}</button>}
    </section>;
}
