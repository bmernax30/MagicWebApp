'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useId, useRef, useState } from 'react';
import { api } from './client-api';
import type { CardDetails } from '@/lib/card-search';

export function CardSearch({ onSelect, onClear, label = 'Card name' }: { onSelect?: (card: CardDetails) => void; onClear?:()=>void; label?: string } = {}) {
    const id = useId();
    const onSelectRef=useRef(onSelect);
    useEffect(()=>{onSelectRef.current=onSelect;},[onSelect]);
    const [query, setQuery] = useState(''), [suggestions, setSuggestions] = useState<string[]>([]);
    const [card, setCard] = useState<CardDetails | null>(null), [error, setError] = useState('');
    const [searching, setSearching] = useState(false), [loading, setLoading] = useState(false);
    const selection = useRef<AbortController | null>(null);
    const heading = useRef<HTMLHeadingElement | null>(null);
    useEffect(() => () => selection.current?.abort(), []);
    useEffect(() => {
        const controller = new AbortController();
        if (query.trim().length < 2) return () => controller.abort();
        const timer = setTimeout(() => {
            setSearching(true);
            void api<{ suggestions: string[] }>(`/api/cards?q=${encodeURIComponent(query.trim())}`, undefined, controller.signal)
                .then(data => { if (!controller.signal.aborted) setSuggestions(data.suggestions); })
                .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); })
                .finally(() => { if (!controller.signal.aborted) setSearching(false); });
        }, 350);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [query]);
    async function choose(name: string) {
        selection.current?.abort(); onClear?.();
        const controller = new AbortController(); selection.current = controller;
        setLoading(true); setError(''); setCard(null);
        try {
            const data = await api<{ card: CardDetails }>(`/api/cards?name=${encodeURIComponent(name)}`, undefined, controller.signal);
            if (!controller.signal.aborted) { setCard(data.card); onSelectRef.current?.(data.card); requestAnimationFrame(() => heading.current?.focus()); }
        } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
        finally { if (!controller.signal.aborted) setLoading(false); }
    }
    return <details open className="panel card-search"><summary>Search Magic cards</summary><div className="card-search-content">
        <label htmlFor={id}>{label}</label><input id={id} type="search" maxLength={120} autoComplete="off" placeholder="Start typing a card name…" value={query} onChange={e => {
            selection.current?.abort(); onClear?.(); setLoading(false); setCard(null); setError(''); setSuggestions([]); setSearching(false); setQuery(e.target.value);
        }}/>
        <p className="muted">Enter at least two characters, then select a suggestion. {onSelect?'Your selected card is used when you join or save your commander.':'Card lookup does not change your game.'}</p>
        {searching && <p role="status">Searching Scryfall…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {suggestions.length > 0 && <ul className="card-suggestions" aria-label="Card suggestions">{suggestions.map(name => <li key={name}><button onClick={() => void choose(name)}>{name}</button></li>)}</ul>}
        {!searching && !error && query.trim().length >= 2 && suggestions.length === 0 && <p role="status">No suggestions yet. Try more of the card name.</p>}
        {loading && <p role="status">Loading card details…</p>}
        {card && <section className="card-details" aria-label="Selected card"><h2 ref={heading} tabIndex={-1}>{card.name}</h2>

            <p>Mana value: {card.manaValue} · {card.set} · #{card.number} · {card.rarity}{card.released && ` · Released ${card.released}`}</p>
            <div className="card-faces">{card.faces.map((face, i) => <article key={i}>
                {face.image && <img src={face.image} alt={face.name} loading="lazy"/>}<div><h3>{face.name}</h3>
                <p><strong>Mana cost:</strong> {face.manaCost || 'No mana cost'}</p><p><strong>Type:</strong> {face.type || 'Not provided'}</p>
                <p className="rules">{face.text || 'No rules text.'}</p>
                {(face.power || face.toughness) && <p>Power / toughness: {face.power} / {face.toughness}</p>}
                {face.loyalty && <p>Loyalty: {face.loyalty}</p>}{face.defense && <p>Defense: {face.defense}</p>}
                {face.flavor && <p className="rules"><em>{face.flavor}</em></p>}{face.artist && <p>Artist: {face.artist}</p>}</div>
            </article>)}</div>
            <details><summary>Format legality</summary><dl className="card-legalities">{Object.entries(card.legalities).map(([format, status]) => <div key={format}><dt>{format}</dt><dd>{status.replaceAll('_', ' ')}</dd></div>)}</dl></details>
            {card.url && <p><a href={card.url} target="_blank" rel="noreferrer">View full card details and rulings on Scryfall ↗</a></p>}
        </section>}
        <p className="muted">Card data and images from <a href="https://scryfall.com" target="_blank" rel="noreferrer">Scryfall</a>. Magic: The Gathering © Wizards of the Coast. Internet connection required.</p>
    </div></details>;
}
