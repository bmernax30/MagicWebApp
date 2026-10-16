'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Catalog } from '@/lib/types';

export function SeatSetup({ number, catalog, disabled, commanderRequired, onJoin }: {
    number: number; catalog: Catalog; disabled: boolean; commanderRequired: boolean;
    onJoin: (name: string, commander: string) => Promise<void>;
}) {
    const [name, setName] = useState('');
    const [commander, setCommander] = useState('');
    const profile = catalog.profiles.find(p => p.name === name);
    return <section className="controller panel">
        <p className="eyebrow">SEAT {number} · OPEN</p>
        <h2>Take your place at the table</h2>
        <form onSubmit={async event => { event.preventDefault(); await onJoin(name, commander); }}>
            <label>Your player profile<select required value={name} onChange={event => {
                const chosen = catalog.profiles.find(p => p.name === event.target.value);
                setName(event.target.value); setCommander(chosen?.commanders[0] ?? '');
            }}><option value="">Choose your profile</option>{catalog.profiles.map(p => <option key={p.name}>{p.name}</option>)}</select></label>
            <label>Your commander<select required={commanderRequired} value={commander} onChange={event => setCommander(event.target.value)} disabled={!profile}>
                <option value="">Choose a commander</option>{profile?.commanders.map(c => <option key={c}>{c}</option>)}
            </select></label>
            {profile && !profile.commanders.length && <p>This profile has no commanders yet. Add one in the profile library before joining a Commander game.</p>}
            <button className="primary wide" disabled={disabled || !profile || (commanderRequired && !commander)}>Join seat {number} →</button>
        </form>
        <p className="muted"><Link href="/">Manage profiles and commanders in the lobby</Link></p>
    </section>;
}
