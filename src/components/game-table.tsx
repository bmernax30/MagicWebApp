'use client';
/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SeatSetup } from './seat-setup';
import { TableCommanders } from './table-commanders';
import { CommanderInfo } from './commander-info';
import { useCallback, useEffect, useRef, useState } from 'react';
import { assetUrl, isAlive, type Catalog, type Game, type Player } from '@/lib/types';
import type { GameAction } from '@/lib/validation';
import { actionId, api } from './client-api';
type ActionInput = GameAction extends infer T ? T extends GameAction ? Omit<T, 'id' | 'round' | 'revision'> : never : never;
export function GameTable({ code }: {
    code: string;
}) {
    const router = useRouter();
    const [game, setGame] = useState<Game | null>(null), [catalog, setCatalog] = useState<Catalog | null>(null);
    const gameStatus = game?.status, gameRound = game?.round;
    const [view, setView] = useState('scoreboard'), [error, setError] = useState(''), [connected, setConnected] = useState(false), [busy, setBusy] = useState(false);
    const [mode, setMode] = useState<'life' | 'poison' | 'commander'>('life'), [source, setSource] = useState(1), [confirm, setConfirm] = useState<'finish' | 'restart' | 'exit' | null>(null), [copied, setCopied] = useState(false);
    const current = useRef<Game | null>(null), sending = useRef(false), confirmedAt = useRef<{
        round: number;
        revision: number;
    } | null>(null);
    const accept = useCallback((g: Game) => { if (!current.current || g.revision >= current.current.revision) {
        current.current = g;
        setGame(g);
    } }, []);
    useEffect(() => { queueMicrotask(() => { const v = new URLSearchParams(window.location.search).get('view'); if (v)
        setView(v); }); }, []);
    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const controller = new AbortController();
        async function poll() { try {
            const g = await api<Game>(`/api/games/${code}`, undefined, controller.signal);
            if (!stopped) {
                accept(g);
                setConnected(true);
            }
        }
        catch (e) {
            if (!stopped) {
                setConnected(false);
                setError((e as Error).message);
            }
        }
        finally {
            if (!stopped)
                timer = setTimeout(poll, 750);
        } }
        void poll();
        return () => { stopped = true; clearTimeout(timer); controller.abort(); };
    }, [code, accept]);
    // Refresh historical totals on finish/restart, including changes from another device.
    useEffect(() => {
        if (!gameStatus) return;
        const controller = new AbortController();
        void api<Catalog>('/api/catalog', undefined, controller.signal).then(c => {
            if (!controller.signal.aborted) setCatalog(c);
        }).catch((error: Error) => {
            if (!controller.signal.aborted) setError(error.message);
        });
        return () => controller.abort();
    }, [code, gameStatus, gameRound]);
    function select(v: string) { setView(v); setMode('life'); const url = new URL(window.location.href); url.searchParams.set('view', v); window.history.replaceState(null, '', url); }
    async function act(input: ActionInput) {
        const g = current.current;
        if (!g || sending.current)
            return;
        sending.current = true;
        setBusy(true);
        setError('');
        const version = (input.type === 'finish' || input.type === 'restart' || input.type === 'exit') && confirmedAt.current ? confirmedAt.current : g;
        try {
            accept(await api<Game>(`/api/games/${code}`, { ...input, id: actionId(), round: version.round, revision: version.revision }));
            setConnected(true);
            setConfirm(null);
            if (input.type === 'exit') router.push('/');
        }
        catch (e) {
            setError((e as Error).message + ' Check the current score before trying again.');
            setConfirm(null);
        }
        finally {
            sending.current = false;
            setBusy(false);
        }
    }
    if (!game)
        return <main className="lobby"><Link className="brand" href="/">✦ MAGIC MERNA</Link><section className="panel"><h1>{error ? 'Unable to open game' : 'Opening the table…'}</h1>{error && <p role="alert">{error}</p>}<Link href="/">Back to lobby</Link></section></main>;
    const selected = game.players.find(p => String(p.number) === view);
    const plane = catalog?.planes.find(p => p.name === game.planeHistory[game.planeIndex]);
    const sourceNumber = game.players.some(p => p.joined && p.number === source && p.number !== selected?.number) ? source : game.players.find(p => p.joined && p.number !== selected?.number)?.number ?? 1;
    const disabled = busy || !connected || game.status !== 'active';
    function score(p: Player) { return mode === 'poison' ? p.poison : mode === 'commander' ? p.damage[sourceNumber - 1] : p.life; }
    return <main className="table-page"><header className="table-header"><Link href="/" className="brand">✦ MAGIC MERNA<span>{game.settings.game_type.toUpperCase()} · ROUND {game.round}</span></Link><div className="game-code"><small>GAME CODE</small><strong>{code}</strong><button onClick={async () => { try {
        await navigator.clipboard.writeText(`${window.location.origin}/game/${code}?view=select`);
        setCopied(true);
    }
    catch {
        setError('Copy this address from your browser to share the game.');
    } }}>{copied ? 'Copied' : 'Copy link'}</button></div><span className={`connection ${connected ? 'online' : ''}`} role="status">{connected ? '● Connected' : '● Reconnecting…'}<small>Update {game.revision}</small></span></header>
    <div className="table-toolbar"><nav className="tabs" aria-label="Game view"><button aria-pressed={view === 'scoreboard'} onClick={() => select('scoreboard')}>Scoreboard</button><button aria-pressed={view === 'select' || !!selected} onClick={() => select('select')}>Player controls</button><button aria-pressed={view === 'compact'} onClick={() => select('compact')}>Compact view</button></nav><span className="badge">{game.status === 'exited' ? 'SESSION ENDED' : game.status === 'finished' ? 'GAME FINISHED' : game.winner ? `PLAYER ${game.winner} WINS` : `${game.players.filter(p => p.joined).length} / ${game.players.length} SEATS JOINED`}</span></div>
    {error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {game.status === 'exited' && <section className="panel" role="status"><h2>This game session has ended</h2><p>No scores or wins were recorded when this session was exited.</p><Link href="/">Return to the lobby →</Link></section>}
    {view === 'select' && <section className="panel seat-picker"><p className="eyebrow">CHOOSE YOUR SEAT</p><h1>Your game. Your controls.</h1><p>Pick an open seat, then choose your profile and commander.</p><div className="seat-grid">{game.players.map(p => <button key={p.number} disabled={game.status === 'exited' || (!p.joined && game.status !== 'active')} onClick={() => select(String(p.number))}><span className="player-number">{p.number}</span><strong>{p.name}</strong><small>{p.joined ? `${p.commander || 'No commander'} · Open controls` : 'Open seat · Join here'}</small></button>)}</div><p className="muted">This is a trusted playgroup: player views are shared controls, not private accounts.</p></section>}
    {selected && !selected.joined && game.status === 'active' && (catalog ? <SeatSetup key={selected.number} number={selected.number} catalog={catalog} commanderRequired={game.settings.game_type === 'Commander'} disabled={disabled} onJoin={(name, commander) => act({ type: 'join', player: selected.number, name, commander })}/> : <p role="status">Loading player profiles…</p>)}
    {selected?.joined ? <section className="controller panel"><p className="eyebrow">PLAYER {selected.number} · {selected.name}</p><h2>{selected.hidden ? 'Unknown commander' : selected.commander || 'Your life total'}</h2><nav className="tabs" aria-label="Counter mode">{(['life', 'poison', ...(game.settings.game_type === 'Commander' ? ['commander'] : [])] as ('life' | 'poison' | 'commander')[]).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'commander' ? 'Commander damage' : m === 'poison' ? 'Poison' : 'Life'}</button>)}</nav>
      {mode === 'commander' && <label>Damage received from<select value={sourceNumber} onChange={e => setSource(Number(e.target.value))}>{game.players.filter(p => p.joined && p.number !== selected.number).map(p => <option key={p.number} value={p.number}>Player {p.number} · {p.name}{p.hidden ? '' : ` · ${p.commander}`}</option>)}</select></label>}
      <div className={`counter-value ${mode}`} aria-live="polite">{score(selected)}</div><p>{mode === 'commander' ? 'Commander damage also changes your life.' : mode === 'poison' ? '10 poison counters eliminates a player.' : 'LIFE TOTAL'}</p>
      <div className="counter-buttons">{[-5, -1, 1, 5].map(delta => <button key={delta} disabled={disabled || (mode === 'commander' && !game.players.some(p => p.joined && p.number !== selected.number))} aria-label={`${delta > 0 ? 'Add' : 'Remove'} ${Math.abs(delta)} ${mode}`} onClick={() => void act({ type: 'counter', player: selected.number, counter: mode, source: mode === 'commander' ? sourceNumber : undefined, delta: delta as -5 | -1 | 1 | 5 })}>{delta > 0 ? '+' : ''}{delta}</button>)}</div>
      <p className="status-line">{game.winner === selected.number ? '✦ Winner' : !isAlive(selected) ? 'Eliminated' : `Life ${selected.life} · Poison ${selected.poison}`}</p><button className="quiet" disabled={disabled} onClick={() => void act({ type: 'visibility', player: selected.number })}>{selected.hidden ? 'Show commander on scoreboard' : 'Hide commander on scoreboard'}</button>
      <div className="mini-scores">{game.players.map(p => <div key={p.number}><small>P{p.number} · {p.name}</small><strong>{p.joined ? p.life : '—'}</strong></div>)}</div><TableCommanders players={game.players} selectedNumber={selected.number} catalog={catalog}/></section> : view !== 'select' && !selected && <div className={`score-grid ${view === 'compact' ? 'compact' : ''}`}>{game.players.map(p => {
                const commander = catalog?.commanders.find(c => c.name === p.commander);
                const profile = catalog?.profiles.find(profile => profile.name === p.name);
                const image = !p.hidden && commander ? assetUrl(commander.metadata.image_path) : '';
                return <article key={p.number} className={`score-card ${p.joined && !isAlive(p) ? 'eliminated' : ''} ${game.winner === p.number ? 'winner' : ''}`}>
        {image && <img src={image} alt="" className="card-art"/>}<div className="card-content"><div className="card-heading"><span className="player-number">{p.number}</span><span>{p.name}</span><small>{!p.joined ? 'OPEN SEAT' : game.winner === p.number ? '✦ WINNER' : !isAlive(p) ? 'ELIMINATED' : `PLAYER ${p.number}`}</small></div><h2>{p.hidden ? 'Unknown commander' : p.commander || (p.joined ? 'Ready to play' : 'Waiting for a player')}</h2>{p.joined && <div className="win-totals" aria-label="Total wins"><span>Player wins <strong>{catalog ? profile?.wins ?? 0 : '—'}</strong></span><span>Commander wins <strong>{p.hidden ? 'Hidden' : p.commander && catalog ? commander?.wins ?? 0 : '—'}</strong></span></div>}<div className="life-score" aria-label={`${p.name} life ${p.life}`}>{p.joined ? p.life : '—'}</div><div className="card-counters"><span>Poison <strong>{p.poison}</strong></span><span>Commander <strong>{Math.max(...p.damage)}</strong></span></div>{game.settings.game_type === 'Commander' && <div className="damage-summary">{game.players.filter(s => s.joined && s.number !== p.number).map(s => <span key={s.number}>P{s.number}: {p.damage[s.number - 1]}</span>)}</div>}<button className="quiet" onClick={() => select(String(p.number))}>{p.joined ? 'Open player controls →' : 'Join this seat →'}</button>{!p.hidden && commander && <CommanderInfo commander={commander}/>}</div></article>;
            })}</div>}
    {game.settings.planechase_enabled && <section className="panel plane-panel"><div>{plane && assetUrl(plane.image) && <img src={assetUrl(plane.image)} alt={plane.name}/>}</div><div><p className="eyebrow">PLANECHASE · SHARED PLANE</p><h2>{plane?.name ?? 'Loading plane…'}</h2><p className="rules">{plane?.rules}</p><div className="actions"><button disabled={disabled || game.planeIndex <= 0} onClick={() => void act({ type: 'plane', direction: 'previous' })}>← Previous plane</button><button disabled={disabled} onClick={() => void act({ type: 'plane', direction: 'next' })}>Planeswalk →</button></div></div></section>}
    {!selected && view !== 'select' && game.status !== 'exited' && <section className="game-controls panel"><div><h3>Table controls</h3><p>{game.status === 'finished' ? (game.winner ? 'Winner recorded in the leaderboards.' : 'Game finished without a winner.') : 'Finish records the winner. Exit ends the session without recording a win. Restart resets the scores.'}</p></div><div className="actions"><button disabled={busy || !connected || game.status === 'finished'} onClick={() => { confirmedAt.current = { round: game.round, revision: game.revision }; setConfirm('finish'); }}>Finish game</button><button disabled={busy || !connected} onClick={() => { confirmedAt.current = { round: game.round, revision: game.revision }; setConfirm('restart'); }}>Restart game</button><button disabled={disabled} onClick={() => { confirmedAt.current = { round: game.round, revision: game.revision }; setConfirm('exit'); }}>Exit game</button></div></section>}
    {confirm && <div className="modal-backdrop"><section className="panel modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{confirm === 'exit' ? 'Exit without recording scores?' : confirm === 'restart' ? 'Restart this game?' : 'Finish this game?'}</h2><p>{confirm === 'exit' ? 'This ends the session for every device and returns you to the lobby. No wins will be added to player or commander totals.' : confirm === 'restart' ? 'All life, poison, commander damage, and Planechase history will reset for every device.' : game.winner ? `Record a win for ${game.players[game.winner - 1].name} and lock the scores?` : 'There is no sole surviving player. Finish without recording a win?'}</p><div className="actions"><button autoFocus disabled={busy} onClick={() => setConfirm(null)}>Cancel</button><button className="primary" disabled={busy} onClick={() => void act({ type: confirm })}>{busy ? 'Saving…' : confirm === 'exit' ? 'Exit without recording' : confirm === 'restart' ? 'Restart for everyone' : 'Finish game'}</button></div></section></div>}
    <footer>Share code {code} with your playgroup <span>Scores synchronize approximately every second</span></footer>
  </main>;
}
