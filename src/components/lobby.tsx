'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { Catalog, Game, Settings } from '@/lib/types';
import { api } from './client-api';
import { APP_VERSION } from '@/lib/version';
import { CardSearch } from './card-search';
import { Leaderboards } from './leaderboards';
import { ProfileManager } from './profile-manager';
const sections = [['play', 'Game Creation'], ['players', 'Player Profile'], ['leaders', 'Leaderboard'], ['cards', 'Card Search']] as const;
type LobbyTab = typeof sections[number][0];
const defaults: Settings = { number_of_players: 4, starting_life_total: 40, game_type: 'Commander', planechase_enabled: false };
export function Lobby() {
    const router = useRouter();
    const [catalog, setCatalog] = useState<Catalog | null>(null), [settings, setSettings] = useState(defaults);
    const [notice, setNotice] = useState('');
    const [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tab, setTab] = useState<LobbyTab>('play');
    const load = useCallback(async () => { try {
        const c = await api<Catalog>('/api/catalog');
        setCatalog(c);
        setSettings(c.settings);
        setError('');
    }
    catch (e) {
        setError((e as Error).message);
    } }, []);
    useEffect(() => {
        const controller = new AbortController();
        api<Catalog>('/api/catalog', undefined, controller.signal).then(c => {
            setCatalog(c);
            setSettings(c.settings);
            const reason = new URLSearchParams(window.location.search).get('notice');
            setNotice(reason === 'seat-left' ? 'You left the table or were removed. Your seat is now open.' : reason === 'game-ended' ? 'You were disconnected because the game session ended.' : '');
        }).catch((error: Error) => {
            if (!controller.signal.aborted) setError(error.message);
        });
        return () => controller.abort();
    }, []);
    async function create() { setBusy(true); setError(''); try {
        const game = await api<Game>('/api/games', { settings });
        router.push(`/game/${game.code}`);
    }
    catch (e) {
        setError((e as Error).message);
        setBusy(false);
    } }
    return <main className="lobby"><header className="masthead"><Link className="brand" href="/">✦ MAGIC MERNA <span>THE SHARED GAME TABLE</span></Link><span className="badge">WEB EDITION · {APP_VERSION}</span></header>
    {notice && <div className="panel session-notice" role="status">{notice}<button className="quiet" onClick={() => setNotice('')}>Dismiss</button></div>}
    <section className="intro"><p className="eyebrow">GATHER YOUR PLAYGROUP</p><h1>One table.<br /><em>Every player connected.</em></h1><p>Create your game, share the code, and let every player keep score from their phone.</p></section>
    <nav className="tabs lobby-tabs" role="tablist" aria-label="Lobby sections" onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const current = sections.findIndex(([id]) => id === tab);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? sections.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
        setTab(sections[next][0]);
        e.currentTarget.querySelector<HTMLButtonElement>(`#lobby-tab-${sections[next][0]}`)?.focus();
    }}>{sections.map(([id, label]) => <button key={id} id={`lobby-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`lobby-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {error && <div role="alert" className="error">{error}<button onClick={() => void load()}>Retry connection</button></div>}
    {!catalog && !error && <p role="status">Connecting to your game library…</p>}
    <section className="lobby-section" id="lobby-panel-play" role="tabpanel" aria-labelledby="lobby-tab-play" hidden={tab !== 'play'}><div className="lobby-grid"><section className="panel"><div className="section-title"><div><p className="eyebrow">START SOMETHING GOOD</p><h2>New game</h2></div><span className="rune">✧</span></div>
      <div className="fields"><label>Format<select value={settings.game_type} onChange={e => setSettings({ ...settings, game_type: e.target.value as Settings['game_type'] })}><option>Commander</option><option>Standard</option></select></label>
      <label>Players<div className="stepper"><button aria-label="Fewer players" disabled={settings.number_of_players <= 2} onClick={() => setSettings({ ...settings, number_of_players: settings.number_of_players - 1 })}>−</button><output>{settings.number_of_players}</output><button aria-label="More players" disabled={settings.number_of_players >= 6} onClick={() => setSettings({ ...settings, number_of_players: settings.number_of_players + 1 })}>+</button></div></label>
      <label>Starting life<input type="number" min={1} max={999} value={settings.starting_life_total} onChange={e => setSettings({ ...settings, starting_life_total: Number(e.target.value) })}/></label>
      <label className="check"><input type="checkbox" checked={settings.planechase_enabled} onChange={e => setSettings({ ...settings, planechase_enabled: e.target.checked })}/> Enable Planechase</label></div>
      <div className="seat-preview"><h3>{settings.number_of_players} seats at your table</h3><p>Share the game code. Each player picks an open seat, their profile, and their commander on their own phone.</p><div className="actions">{Array.from({ length: settings.number_of_players }, (_, i) => <span className="badge" key={i}>Seat {i + 1} · Open</span>)}</div></div>
      <button className="primary wide" disabled={busy || !catalog} onClick={() => void create()}>{busy ? 'Creating game…' : 'Create game →'}</button>
      <button className="quiet wide" disabled={!catalog || busy} onClick={async () => { setBusy(true); try {
            setCatalog(await api<Catalog>('/api/catalog', { type: 'settings', settings }));
            setError('');
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        } }}>Save setup as defaults</button>
    </section><aside><section className="panel join-panel"><p className="eyebrow">THERE’S A SEAT FOR YOU</p><h2>Join a game</h2><p>Enter the scoreboard’s code. Join an open seat, or take over your existing seat to reconnect without changing your profile, commander, or scores.</p><form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try {
            const g = await api<Game>(`/api/games/${code}`);
            router.push(`/game/${g.code}?view=select`);
        }
        catch (e) {
            setError((e as Error).message);
            setBusy(false);
        } }}><label>Game code<input className="code-input" maxLength={6} minLength={6} required autoCapitalize="characters" autoComplete="off" spellCheck={false} value={code} placeholder="ABC234" onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))}/></label><button className="wide" disabled={busy || code.length !== 6}>Join the table →</button></form></section><section className="how-it-works"><span>01</span><p><strong>Create & share</strong>One code brings the whole table together.</p><span>02</span><p><strong>Choose your seat</strong>Every phone gets its own player controls.</p><span>03</span><p><strong>Keep the game moving</strong>Life, poison, and commander damage stay in sync.</p></section></aside></div></section>
    <section className="lobby-section" id="lobby-panel-players" role="tabpanel" aria-labelledby="lobby-tab-players" hidden={tab !== 'players'}>{catalog && <ProfileManager catalog={catalog} onSaved={setCatalog} onError={setError}/>}</section>

    <section className="lobby-section" id="lobby-panel-leaders" role="tabpanel" aria-labelledby="lobby-tab-leaders" hidden={tab !== 'leaders'}>{catalog && <Leaderboards catalog={catalog}/>}</section>
    <section className="lobby-section" id="lobby-panel-cards" role="tabpanel" aria-labelledby="lobby-tab-cards" hidden={tab !== 'cards'}><CardSearch/></section>
    <footer>Magic Merna v{APP_VERSION} · Built for your playgroup <span>Scores saved in SQLite</span></footer>
  </main>;
}
