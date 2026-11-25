'use client';
/* eslint-disable @next/next/no-img-element */
import { useId, useState } from 'react';
import { api } from './client-api';
import { type Commander } from '@/lib/types';

function CommanderDetails({ commander }: { commander: Commander }) {
    return <div className="commander-info-content">
        {commander.cards.map(card=><section key={card.name}><h4>{card.name}</h4><p>Mana value: {card.manaValue} · {card.set} · {card.rarity}</p>
            <div className="commander-info-cards">{card.faces.map((face,i)=><figure key={i}>{face.image&&<img loading="lazy" src={face.image} alt={face.name}/>}<figcaption><h4>{face.name}</h4><p>Mana cost: {face.manaCost||'No mana cost'}</p><p>{face.type}</p><p>Colors: {face.colors.join(', ')||'Colorless'}</p><p className="rules">{face.text||'No rules text.'}</p>{(face.power||face.toughness)&&<p>Power / toughness: {face.power} / {face.toughness}</p>}{face.loyalty&&<p>Loyalty: {face.loyalty}</p>}{face.defense&&<p>Defense: {face.defense}</p>}{face.artist&&<p>Artist: {face.artist}</p>}</figcaption></figure>)}</div><a href={card.url} target="_blank" rel="noreferrer">Card details on Scryfall ↗</a></section>)}
        <p>{commander.wins} wins · {commander.plays} plays this season for this setup</p><p className="muted">Card data and images from Scryfall. Magic: The Gathering © Wizards of the Coast.</p>
    </div>;
}

export function CommanderInfo({commander}:{commander:Commander}) {
    const [loaded,setLoaded]=useState<Commander|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
    const id=useId();
    const details=loaded?.id===commander.id?loaded:commander;
    return <div className="commander-info"><a href={`#${id}`} aria-expanded={open} aria-controls={id} onClick={async event=>{
        event.preventDefault();setOpen(!open);
        if(open||busy||details.cards.length)return;
        setBusy(true);setError('');try{const result=await api<{commander:Commander}>(`/api/commanders?id=${encodeURIComponent(commander.id)}`);setLoaded(result.commander);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
    }}>{commander.name}</a>{open&&<div id={id}>{busy&&<p role="status">Loading commander…</p>}{error&&<p role="alert">{error} Close and reopen the commander link to retry.</p>}{details.cards.length>0&&<CommanderDetails commander={details}/>}</div>}</div>;
}
