'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react';
import { EMOTES, serverNow, emoteCooldownSeconds } from '@/lib/emotes';
import type { EmoteKind, GameEmote, ServerClock } from '@/lib/emotes';
import type { Player } from '@/lib/types';

function useNow(clock: ServerClock | null) {
    const [now, setNow] = useState<number | null>(null);
    useEffect(() => {
        const tick = () => setNow(clock ? serverNow(clock, performance.now()) : null);
        tick();
        const timer = setInterval(tick, 250);
        return () => clearInterval(timer);
    }, [clock]);
    return now;
}
export function PlayerEmotes({ players, sender, emotes, clock, disabled, onSend }: {
    players: Player[]; sender: Player; emotes: GameEmote[]; clock: ServerClock | null; disabled: boolean;
    onSend: (target: number, emote: EmoteKind) => Promise<boolean>;
}) {
    const [target, setTarget] = useState<number | null>(null);
    const now = useNow(clock);
    const latest = emotes.find(e => e.sender === sender.number);
    const seconds = emoteCooldownSeconds(latest?.sentAt, now);
    return <div className="mini-scores">{players.map(p => <div className="emote-player" key={p.number}
        onKeyDown={e => { if (e.key === 'Escape') setTarget(null); }}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setTarget(null); }}>
        <small>P{p.number} · {p.name}</small><strong>{p.joined ? p.life : '—'}</strong>
        {p.joined && <button className="emote-trigger" aria-expanded={target === p.number} aria-controls={`emote-picker-${p.number}`}
            disabled={disabled || seconds > 0} onClick={() => setTarget(target === p.number ? null : p.number)}>{seconds > 0 ? `Emote (${seconds}s)` : 'Emote'}</button>}
        {target === p.number && <section id={`emote-picker-${p.number}`} className="emote-picker" aria-label={`Send an emote to ${p.name}`}>
            <div className="emote-picker-heading"><small>To {p.name}</small><button aria-label="Close emotes" onClick={() => setTarget(null)}>×</button></div>
            <div className="emote-options">{EMOTES.map(emote => <button key={emote.id} disabled={disabled || seconds > 0} onClick={async () => {
                if (await onSend(p.number, emote.id)) setTarget(null);
            }}><img src={emote.image} alt=""/><span>{emote.label}</span></button>)}</div>
        </section>}
    </div>)}</div>;
}
export function ScoreEmotes({ emotes, target, clock }: { emotes: GameEmote[]; target: number; clock: ServerClock | null }) {
    const now = useNow(clock);
    const active = emotes.filter(e => e.target === target && now !== null && e.expiresAt > now && now > 0);
    if (!active.length) return null;
    return <div className="score-emotes" aria-live="polite">{active.map(event => {
        const emote = EMOTES.find(e => e.id === event.kind);
        return emote && <div className="score-emote" key={event.id}><img src={emote.image} alt={emote.label}/><span>From {event.senderName} · P{event.sender}</span></div>;
    })}</div>;
}
