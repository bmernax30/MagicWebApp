'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react';
import { EMOTES, EMOTE_COOLDOWN_MS } from '@/lib/emotes';
import type { EmoteKind, GameEmote } from '@/lib/emotes';
import type { Player } from '@/lib/types';

function useNow() {
    const [now, setNow] = useState(0);
    useEffect(() => {
        const tick = () => setNow(Date.now());
        tick();
        const timer = setInterval(tick, 250);
        return () => clearInterval(timer);
    }, []);
    return now;
}
export function PlayerEmotes({ players, sender, emotes, disabled, onSend }: {
    players: Player[]; sender: Player; emotes: GameEmote[]; disabled: boolean;
    onSend: (target: number, emote: EmoteKind) => Promise<boolean>;
}) {
    const [target, setTarget] = useState<number | null>(null);
    const now = useNow();
    const latest = emotes.find(e => e.sender === sender.number);
    const seconds = latest ? Math.max(0, Math.ceil((latest.sentAt + EMOTE_COOLDOWN_MS - now) / 1000)) : 0;
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
export function ScoreEmotes({ emotes, target }: { emotes: GameEmote[]; target: number }) {
    const now = useNow();
    const active = emotes.filter(e => e.target === target && e.expiresAt > now && now > 0);
    if (!active.length) return null;
    return <div className="score-emotes" aria-live="polite">{active.map(event => {
        const emote = EMOTES.find(e => e.id === event.kind);
        return emote && <div className="score-emote" key={event.id}><img src={emote.image} alt={emote.label}/><span>From {event.senderName} · P{event.sender}</span></div>;
    })}</div>;
}
