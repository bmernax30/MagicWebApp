'use client';
/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SeatResume } from './seat-resume';
import { SeatSetup } from './seat-setup';
import { TableCommanders } from './table-commanders';
import { CommanderInfo } from './commander-info';
import { GameLogScreen } from './game-log';
import { useCallback, useEffect, useRef, useState } from 'react';
import { assetUrl, isAlive, type Catalog, type Game, type Player } from '@/lib/types';
import type { GameAction } from '@/lib/validation';
import { actionId, api } from './client-api';
import { sessionDestination } from '@/lib/session-navigation';
import { CommanderPicker } from './commander-picker';
import { PlayerEmotes, ScoreEmotes } from './emotes';
import type { ServerClock } from '@/lib/emotes';
import { CardSearch } from './card-search';
import { APP_VERSION } from '@/lib/version';
type ActionInput = GameAction extends infer T ? T extends GameAction ? Omit<T, 'id' | 'round' | 'revision'> : never : never;
export function GameTable({ code, initialView = 'scoreboard', archive = false }: {
    code: string; initialView?: string; archive?: boolean;
}) {
    const router = useRouter();
    const counterDisplay = useRef<HTMLDivElement>(null);
    const [game, setGame] = useState<Game | null>(null), [catalog, setCatalog] = useState<Catalog | null>(null);
    const gameStatus = game?.status, gameRound = game?.round;
    const rosterDecks=game?.players.map(p=>p.deckId??p.commander).join('|');
    const [view, setView] = useState(initialView), [error, setError] = useState(''), [connected, setConnected] = useState(false), [busy, setBusy] = useState(false);
    const [mode, setMode] = useState<'life' | 'poison' | 'commander'>('life'), [source, setSource] = useState<{ number: number; seatVersion: number } | null>(null), [confirm, setConfirm] = useState<'finish' | 'restart' | 'exit' | null>(null), [copied, setCopied] = useState(false);
    const [pending, setPending] = useState<{ id: string; round: number; revision: number; player: number; counter: 'life' | 'poison' | 'commander'; source?: number; delta: number; seatVersion: number; sourceVersion?: number; submitted: boolean } | null>(null);
    const [clock, setClock] = useState<ServerClock | null>(null);
    const [resume, setResume] = useState<{ number: number; seatVersion: number } | null>(null);
    const [seatRemoved, setSeatRemoved] = useState(false);
    const watchedSeat = useRef<number | null>(/^[1-6]$/.test(initialView) ? Number(initialView) : null), claimedVersion = useRef<number | null>(null);
    const current = useRef<Game | null>(null), sending = useRef(false), confirmedAt = useRef<{
        round: number;
        revision: number;
    } | null>(null);
    const accept = useCallback((g: Game) => { if (!current.current || g.revision >= current.current.revision) {
        const watched = g.players.find(p => p.number === watchedSeat.current);
        if (watched && claimedVersion.current !== null && (!watched.joined || (watched.seatVersion ?? 0) !== claimedVersion.current)) setSeatRemoved(true);
        else if (watched?.joined && claimedVersion.current === null) claimedVersion.current = watched.seatVersion ?? 0;
        current.current = g;
        setGame(g);
    } }, []);
    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const controller = new AbortController();
        async function poll() { try {
            const g = await api<Game>(`/api/games/${code}`, undefined, controller.signal, setClock);
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
            if (!controller.signal.aborted) {
                setCatalog(c);
                const ids=new Set(current.current?.players.filter(p=>p.joined).map(p=>p.deckId));
                for(const commander of c.commanders.filter(c=>ids.has(c.id)&&!c.cards.length)) {
                    void api<{commander:Catalog['commanders'][number]}>(`/api/commanders?id=${encodeURIComponent(commander.id)}`,undefined,controller.signal).then(result=>{
                        if(!controller.signal.aborted)setCatalog(previous=>previous?{...previous,commanders:previous.commanders.map(c=>c.id===result.commander.id?result.commander:c)}:previous);
                    }).catch(()=>{/* Scoring remains available offline; commander info offers retry. */});
                }
            }
        }).catch((error: Error) => {
            if (!controller.signal.aborted) setError(error.message);
        });
        return () => controller.abort();
    }, [code, gameStatus, gameRound, rosterDecks]);
    const destination = seatRemoved && !archive ? '/?notice=seat-left' : sessionDestination(game, view, archive);
    useEffect(() => {
        if (destination) router.replace(destination);
    }, [destination, router]);
    function select(v: string) {
        if (pending && current.current?.round === pending.round && current.current?.status === 'active') { setError('Apply or cancel the pending change before switching views.'); return; }
        watchedSeat.current = /^[1-6]$/.test(v) ? Number(v) : null;
        const seat = current.current?.players.find(p => p.number === watchedSeat.current);
        claimedVersion.current = seat?.joined ? seat.seatVersion ?? 0 : null;
        setSeatRemoved(false);
        setPending(null); setView(v); setMode('life'); setSource(null);
        const url = new URL(window.location.href); url.searchParams.set('view', v); window.history.replaceState(null, '', url);
    }
    function requestSeat(player: Player) {
        if (player.joined && !archive) setResume({ number: player.number, seatVersion: player.seatVersion ?? 0 });
        else select(String(player.number));
    }
    function resumeSeat() {
        const g = current.current;
        const player = g?.players.find(p => p.number === resume?.number);
        if (!g || !resume || !connected || g.status !== 'active' || !player?.joined || (player.seatVersion ?? 0) !== resume.seatVersion) {
            setError('This seat changed or the connection was interrupted. Choose your seat again.'); return;
        }
        setResume(null);
        select(String(player.number));
    }
    function queue(delta: number, player: number, counter: 'life' | 'poison' | 'commander', source?: number) {
        const game = current.current;
        if (!game || pending?.submitted) return;
        setPending(old => {
            const change = (old?.delta ?? 0) + delta;
            if (!change) return null;
            return { id: old?.id ?? actionId(), round: old?.round ?? game.round, revision: old?.revision ?? game.revision,
                player, counter, source, seatVersion: old?.seatVersion ?? game.players[player - 1].seatVersion ?? 0, sourceVersion: old?.sourceVersion ?? (source ? game.players[source - 1].seatVersion ?? 0 : undefined), delta: Math.max(-999999, Math.min(999999, change)), submitted: false };
        });
    }
    async function act(input: ActionInput, fixedVersion?: { id?: string; round: number; revision: number }): Promise<boolean> {
        const g = current.current;
        if (!g || sending.current)
            return false;
        sending.current = true;
        setBusy(true);
        setError('');
        const version = fixedVersion ?? ((input.type === 'finish' || input.type === 'restart' || input.type === 'exit') && confirmedAt.current ? confirmedAt.current : g);
        try {
            accept(await api<Game>(`/api/games/${code}`, { ...input, ...('player' in input ? { seatVersion: input.seatVersion ?? g.players[input.player - 1]?.seatVersion ?? 0 } : {}), ...(input.type === 'counter' && input.source ? { sourceVersion: input.sourceVersion ?? g.players[input.source - 1]?.seatVersion ?? 0 } : {}), id: fixedVersion?.id ?? actionId(), round: version.round, revision: version.revision }, undefined, setClock));
            setConnected(true);
            setConfirm(null);
            return true;
        }
        catch (e) {
            setError((e as Error).message + ' Check the current score before trying again.');
            setConfirm(null);
            return false;
        }
        finally {
            sending.current = false;
            setBusy(false);
        }
    }
    async function removePlayer(player: Player, type: 'kick' | 'leave') {
        const g = current.current;
        if (!g || !window.confirm(type === 'kick' ? `Kick ${player.name} and open seat ${player.number}?` : 'Leave this game and open your seat? Your current seat scores will be cleared.')) return;
        await act({ type, player: player.number, seatVersion: player.seatVersion ?? 0 }, { round: g.round, revision: g.revision });
    }
    async function applyPending() {
        if (!pending) return;
        setPending({ ...pending, submitted: true });
        if (await act({ type: 'counter', player: pending.player, counter: pending.counter, source: pending.source, seatVersion: pending.seatVersion, sourceVersion: pending.sourceVersion, delta: pending.delta }, pending)) setPending(null);
    }
    if (!game)
        return <main className="lobby"><Link className="brand" href="/">✦ MAGIC MERNA</Link><section className="panel"><h1>{error ? 'Unable to open game' : 'Opening the table…'}</h1>{error && <p role="alert">{error}</p>}<Link href="/">Back to lobby</Link></section></main>;
    if (destination) return <main className="lobby"><section className="panel" role="status"><h2>{seatRemoved ? 'You left the table' : 'Game session ended'}</h2><p>{seatRemoved ? 'Your seat was opened. Returning to the main screen…' : game.nextGameCode ? 'Result recorded. Moving everyone to the next session…' : 'You have been disconnected from this game. Returning to the main screen…'}</p></section></main>;
    const selected = game.players.find(p => String(p.number) === view);
    const plane = catalog?.planes.find(p => p.name === game.planeHistory[game.planeIndex]);
    const sourceNumber = source?.number ?? 0;
    const sourcePlayer = game.players.find(p => p.joined && p.number === sourceNumber);
    const sourceValid = !!sourcePlayer && (sourcePlayer.seatVersion ?? 0) === source?.seatVersion;
    const disabled = busy || !connected || archive || game.status !== 'active';
    const scoringDisabled = disabled || (mode === 'commander' && !sourceValid);
    function score(p: Player) { return mode === 'poison' ? p.poison : mode === 'commander' ? (p.damage[sourceNumber - 1] ?? 0) : p.life; }
    const appliedPreview = selected && pending && pending.round === game.round && !pending.submitted
        ? Math.max(0, Math.min(999999, score(selected) + pending.delta)) - score(selected) : pending?.delta ?? 0;
    return <main className="table-page"><header className="table-header"><Link href="/" className="brand">✦ MAGIC MERNA<span>{game.settings.game_type.toUpperCase()} · ROUND {game.round}</span></Link><div className="game-code"><small>GAME CODE</small><strong>{code}</strong><button onClick={async () => { try {
        await navigator.clipboard.writeText(`${window.location.origin}/game/${code}?view=select`);
        setCopied(true);
    }
    catch {
        setError('Copy this address from your browser to share the game.');
    } }}>{copied ? 'Copied' : 'Copy link'}</button></div><span className={`connection ${connected ? 'online' : ''}`} role="status">{connected ? '● Connected' : '● Reconnecting…'}<small>Update {game.revision}</small></span></header>
    <div className="table-toolbar"><nav className="tabs" aria-label="Game view"><button aria-pressed={view === 'scoreboard'} onClick={() => select('scoreboard')}>Scoreboard</button><button aria-pressed={view === 'select' || !!selected} onClick={() => select('select')}>Player controls</button><button aria-pressed={view === 'log'} onClick={() => select('log')}>Game log</button><button aria-pressed={view === 'compact'} onClick={() => select('compact')}>Compact view</button></nav><span className="badge">{game.status === 'exited' ? 'SESSION ENDED' : game.status === 'finished' ? 'GAME FINISHED' : game.winner ? `PLAYER ${game.winner} WINS` : `${game.players.filter(p => p.joined).length} / ${game.players.length} SEATS JOINED`}</span></div>
    {error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {archive && <section className="panel session-archive"><p className="eyebrow">SAVED SESSION · READ ONLY</p><h2>Session {game.code}</h2><p>{game.winner ? `Player ${game.winner} won this session.` : 'No winner was recorded.'}</p>{game.nextGameCode && <Link href={`/game/${game.nextGameCode}?view=${encodeURIComponent(view)}`}>Open the next session →</Link>}</section>}
    {game.status === 'exited' && <section className="panel" role="status"><h2>This game session has ended</h2><p>No scores or wins were recorded when this session was exited.</p><Link href="/">Return to the lobby →</Link></section>}
    {view === 'log' && <GameLogScreen game={game} busy={busy || !connected || archive} onUndo={async (eventId, revision) => { await act({ type: 'undo', eventId }, { round: game.round, revision }); }}/>}
    {view === 'select' && <section className="panel seat-picker"><p className="eyebrow">CHOOSE YOUR SEAT</p><h1>Your game. Your controls.</h1><p>Choose an open seat to join, or take over your existing seat to reconnect with the same profile, commander, and scores.</p><div className="seat-grid">{game.players.map(p => <button key={p.number} disabled={game.status === 'exited' || (!p.joined && game.status !== 'active')} onClick={() => requestSeat(p)}><span className="player-number">{p.number}</span><strong>{p.name}</strong><small>{p.joined ? `${p.hidden ? 'Hidden commander' : p.commander || 'No commander'} · Take over seat` : 'Open seat · Join here'}</small></button>)}</div><p className="muted">This is a trusted playgroup: player views are shared controls, not private accounts.</p></section>}
    {selected && !selected.joined && !archive && game.status === 'active' && (catalog ? <SeatSetup key={selected.number} number={selected.number} catalog={catalog} commanderRequired={game.settings.game_type === 'Commander'} disabled={disabled} onJoin={async (name, commander, hidden) => { await act({ type: 'join', player: selected.number, name, commander, hidden }); }}/> : <p role="status">Loading player profiles…</p>)}
    {selected?.joined ? <section className="controller panel"><p className="eyebrow">PLAYER {selected.number} · {selected.name}</p><h2>{selected.commander || 'Your life total'}</h2>{selected.hidden && <p className="badge">Commander hidden from the scoreboard</p>}{selected.hidden && !archive && <button disabled={disabled} onClick={() => void act({type:'reveal',player:selected.number})}>Reveal commander</button>}{catalog && !archive && game.status === 'active' && <CommanderPicker key={`${selected.number}:${selected.deckId??selected.commander}:${selected.hidden}`} player={selected} catalog={catalog} disabled={disabled || !!pending} required={game.settings.game_type === 'Commander'} onChange={async (commander, hidden) => { await act({ type: 'change-commander', player: selected.number, commander, hidden }); }}/>}<nav className="tabs" aria-label="Counter mode">{(['life', 'poison'] as const).map(m => <button key={m} disabled={!!pending} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'poison' ? 'Poison' : 'Life'}</button>)}</nav>
      {mode === 'commander' && <p className="commander-source" role="status">{sourceValid && sourcePlayer ? <>Commander damage from <strong>{sourcePlayer.name} · {sourcePlayer.hidden ? 'Hidden commander' : sourcePlayer.commander || 'Commander'}</strong></> : 'That commander’s seat changed. Choose a Commander button again.'}</p>}
      <div ref={counterDisplay} className={`counter-value ${mode}`} aria-live="polite">{score(selected)}</div><p>{mode === 'commander' ? 'Commander damage also changes your life.' : mode === 'poison' ? '10 poison counters eliminates a player.' : 'LIFE TOTAL'}</p>
      <div className="counter-buttons">{[-5, -1, 1, 5].map(delta => <button key={delta} disabled={scoringDisabled || !!pending?.submitted || (!!pending && pending.round !== game.round)} aria-label={`${delta > 0 ? 'Add' : 'Remove'} ${Math.abs(delta)} ${mode}`} onClick={() => queue(delta, selected.number, mode, mode === 'commander' ? sourceNumber : undefined)}>{delta > 0 ? '+' : ''}{delta}</button>)}</div>
      {pending && <div className="pending-change" role="status"><p>Pending change</p><strong>{appliedPreview > 0 ? '+' : ''}{appliedPreview}</strong>
        {pending.round !== game.round && <p>This draft is from an earlier round. Cancel it before continuing.</p>}
        <div className="actions"><button className="primary" disabled={scoringDisabled || pending.round !== game.round || (!pending.submitted && appliedPreview === 0)} onClick={() => void applyPending()}>Apply</button><button disabled={busy} onClick={() => setPending(null)}>Cancel</button></div>
        {pending.submitted && <p className="muted">If interrupted, Apply safely retries this same change.</p>}
      </div>}
      <p className="status-line">{game.winner === selected.number ? '✦ Winner' : !isAlive(selected) ? 'Eliminated' : `Life ${selected.life} · Poison ${selected.poison}`}</p>
      <PlayerEmotes commanderEnabled={game.settings.game_type === 'Commander'} commanderDisabled={disabled || !!pending} activeCommander={mode === 'commander' && sourceValid ? sourceNumber : null} onCommander={player => {
          if (disabled || pending) return;
          setSource({ number: player.number, seatVersion: player.seatVersion ?? 0 }); setMode('commander');
          requestAnimationFrame(() => counterDisplay.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
        }} clock={clock} players={game.players} sender={selected} emotes={game.emotes} disabled={disabled} onSend={(target, emote) => act({ type: 'emote', player: selected.number, target, emote })}/><TableCommanders players={game.players} selectedNumber={selected.number} catalog={catalog}/></section> : view !== 'select' && view !== 'log' && !selected && <div className={`score-grid ${view === 'compact' ? 'compact' : ''}`}>{game.players.map(p => {
                const commander = catalog?.commanders.find(c => (c.id === p.deckId || c.name === p.commander));
                const profile = catalog?.profiles.find(profile => profile.name === p.name);
                const image = !p.hidden && commander ? assetUrl(commander.metadata.image_path) : '';
                return <article key={p.number} className={`score-card ${p.joined && !isAlive(p) ? 'eliminated' : ''} ${game.winner === p.number ? 'winner' : ''}`}>
        {!archive && <ScoreEmotes clock={clock} emotes={game.emotes} target={p.number}/>}{image && <img src={image} alt="" className="card-art"/>}<div className="card-content"><div className="card-heading"><span className="player-number">{p.number}</span><span>{p.name}</span><small>{!p.joined ? 'OPEN SEAT' : game.winner === p.number ? '✦ WINNER' : !isAlive(p) ? 'ELIMINATED' : `PLAYER ${p.number}`}</small></div><div className="commander-title">{!p.hidden&&commander?<CommanderInfo commander={commander}/>:p.hidden?'Unknown commander':p.commander||(p.joined?'Ready to play':'Waiting for a player')}</div>{p.joined && <div className="win-totals" aria-label="Current season totals"><span>Season player wins <strong>{catalog ? profile?.wins ?? 0 : '—'}</strong></span><span>Season commander wins <strong>{p.hidden ? 'Hidden' : p.commander && catalog ? commander?.wins ?? 0 : '—'}</strong></span><span>Season commander plays <strong>{p.hidden?'Hidden':catalog?commander?.plays??0:'—'}</strong></span></div>}<div className="life-score" aria-label={`${p.name} life ${p.life}`}>{p.joined ? p.life : '—'}</div><div className="card-counters"><span>Poison <strong>{p.poison}</strong></span><span>Commander <strong>{Math.max(...p.damage)}</strong></span></div>{game.settings.game_type === 'Commander' && <div className="damage-summary">{game.players.filter(s => s.joined).map(s => <span key={s.number}>P{s.number}: {p.damage[s.number - 1]}</span>)}</div>}<button className="quiet" onClick={() => requestSeat(p)}>{p.joined ? archive ? 'View player →' : 'Take over seat →' : 'Join this seat →'}</button>{p.joined && !archive && game.status === 'active' && <button className="quiet" disabled={disabled} onClick={() => void removePlayer(p, 'kick')}>Kick player</button>}</div></article>;
            })}</div>}
    {game.settings.planechase_enabled && view !== 'log' && <section className="panel plane-panel"><div>{plane && assetUrl(plane.image) && <img src={assetUrl(plane.image)} alt={plane.name}/>}</div><div><p className="eyebrow">PLANECHASE · SHARED PLANE</p><h2>{plane?.name ?? 'Loading plane…'}</h2><p className="rules">{plane?.rules}</p><div className="actions"><button disabled={disabled || game.planeIndex <= 0} onClick={() => void act({ type: 'plane', direction: 'previous' })}>← Previous plane</button><button disabled={disabled} onClick={() => void act({ type: 'plane', direction: 'next' })}>Planeswalk →</button></div></div></section>}
    {!selected && view !== 'select' && view !== 'log' && !archive && game.status === 'active' && <section className="game-controls panel"><div><h3>Table controls</h3><p>Finish records this session and starts a new one with the same players. Exit sends everyone to the main screen without recording a win. Restart resets this round.</p></div><div className="actions"><button disabled={disabled} onClick={() => { confirmedAt.current = { round: game.round, revision: game.revision }; setConfirm('finish'); }}>Finish game</button><button disabled={busy || !connected} onClick={() => { confirmedAt.current = { round: game.round, revision: game.revision }; setConfirm('restart'); }}>Restart game</button><button disabled={disabled} onClick={() => { confirmedAt.current = { round: game.round, revision: game.revision }; setConfirm('exit'); }}>Exit game</button></div></section>}
    {resume && <SeatResume number={resume.number} player={game.players.find(p => p.number === resume.number)} available={game.players.some(p => p.number === resume.number && p.joined && (p.seatVersion ?? 0) === resume.seatVersion)} disabled={disabled} onCancel={() => setResume(null)} onResume={resumeSeat}/>}
    {confirm && <div className="modal-backdrop"><section className="panel modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{confirm === 'exit' ? 'Exit without recording scores?' : confirm === 'restart' ? 'Restart this game?' : 'Finish this game?'}</h2><p>{confirm === 'exit' ? 'This disconnects every device and returns everyone to the main screen. No wins will be added to player or commander totals.' : confirm === 'restart' ? 'All life, poison, commander damage, and Planechase history will reset for every device.' : game.winner ? `Record a win for ${game.players[game.winner - 1].name} and move everyone into a new session with the same players?` : 'There is no sole surviving player. Save this session without a win and start a new one with the same players?'}</p><div className="actions"><button autoFocus disabled={busy} onClick={() => setConfirm(null)}>Cancel</button><button className="primary" disabled={busy} onClick={() => void act({ type: confirm })}>{busy ? 'Saving…' : confirm === 'exit' ? 'Exit without recording' : confirm === 'restart' ? 'Restart for everyone' : 'Finish game'}</button></div></section></div>}
    {(view === 'scoreboard' || view === 'compact') && <CardSearch/>}
    {selected?.joined && !archive && game.status === 'active' && <div className="player-leave"><button className="leave-game" disabled={disabled} onClick={() => void removePlayer(selected, 'leave')}>Leave game</button></div>}
    <footer>Magic Merna v{APP_VERSION} · Share code {code} with your playgroup <span>Scores synchronize approximately every second</span></footer>
  </main>;
}
