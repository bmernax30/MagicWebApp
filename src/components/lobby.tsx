'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { Catalog, Game, Settings } from '@/lib/types';
import { api } from './client-api';
import { ProfileManager } from './profile-manager';
const defaults: Settings = { number_of_players: 4, starting_life_total: 40, game_type: 'Commander', planechase_enabled: false };
export function Lobby() {
    const router = useRouter();
    const [catalog, setCatalog] = useState<Catalog | null>(null), [settings, setSettings] = useState(defaults);
    const [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tab, setTab] = useState('play');
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
    return <main className="lobby"><header className="masthead"><Link className="brand" href="/">✦ MAGIC MERNA <span>THE SHARED GAME TABLE</span></Link><span className="badge">WEB EDITION · 01</span></header>
    <section className="intro"><p className="eyebrow">GATHER YOUR PLAYGROUP</p><h1>One table.<br /><em>Every player connected.</em></h1><p>Create your game, share the code, and let every player keep score from their phone.</p></section>
    <nav className="tabs" aria-label="Lobby sections">{[['play', 'Play'], ['profiles', 'Profiles & commanders'], ['leaders', 'Leaderboards']].map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {error && <div role="alert" className="error">{error}<button onClick={() => void load()}>Retry connection</button></div>}
    {!catalog && !error && <p role="status">Connecting to your game library…</p>}
    {tab === 'play' && <div className="lobby-grid"><section className="panel"><div className="section-title"><div><p className="eyebrow">START SOMETHING GOOD</p><h2>New game</h2></div><span className="rune">✧</span></div>
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
    </section><aside><section className="panel join-panel"><p className="eyebrow">THERE’S A SEAT FOR YOU</p><h2>Join a game</h2><p>Enter the code on the scoreboard, then choose a seat, your profile, and your commander.</p><form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try {
            const g = await api<Game>(`/api/games/${code}`);
            router.push(`/game/${g.code}?view=select`);
        }
        catch (e) {
            setError((e as Error).message);
            setBusy(false);
        } }}><label>Game code<input className="code-input" maxLength={6} minLength={6} required autoCapitalize="characters" autoComplete="off" spellCheck={false} value={code} placeholder="ABC234" onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))}/></label><button className="wide" disabled={busy || code.length !== 6}>Join the table →</button></form></section><section className="how-it-works"><span>01</span><p><strong>Create & share</strong>One code brings the whole table together.</p><span>02</span><p><strong>Choose your seat</strong>Every phone gets its own player controls.</p><span>03</span><p><strong>Keep the game moving</strong>Life, poison, and commander damage stay in sync.</p></section></aside></div>}
    {tab === 'profiles' && catalog && <ProfileManager catalog={catalog} onSaved={setCatalog} onError={setError}/>}
    {tab === 'leaders' && catalog && <div className="lobby-grid">{[['Players', catalog.profiles], ['Commanders', catalog.commanders]].map(([title, entries]) => <section className="panel" key={title as string}><p className="eyebrow">THE HALL OF FAME</p><h2>{title as string}</h2>{[...(entries as {
            name: string;
            wins: number;
        }[])].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name)).map((p, i) => <div className="leader" key={p.name}><span>{i + 1}</span><strong>{p.name}</strong><span>{p.wins} wins</span></div>)}</section>)}</div>}
    <footer>Magic Merna · Built for your playgroup <span>Scores saved in SQLite</span></footer>
  </main>;
}
