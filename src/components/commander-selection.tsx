'use client';
import { useState } from 'react';
import type { Catalog } from '@/lib/types';
import type { CardDetails } from '@/lib/card-search';
import { CardSearch } from './card-search';
import { CommanderInfo } from './commander-info';
import { api } from './client-api';
export type CommanderChoice = {id:string;names?:string[]};
export async function resolveCommander(choice:CommanderChoice) {
    if(!choice.names)return choice.id;
    const result=await api<{commander:{id:string}}>('/api/commanders',{names:choice.names});
    return result.commander.id;
}
export function CommanderSelection({catalog,profileName,value,onChange,disabled}:{catalog:Catalog;profileName:string;value:CommanderChoice;onChange:(choice:CommanderChoice)=>void;disabled:boolean}) {
    const profile=catalog.profiles.find(p=>p.name===profileName);
    const [mode,setMode]=useState<'history'|'search'>(profile?.history.length?'history':'search');
    const [primary,setPrimary]=useState<CardDetails|null>(null),[secondary,setSecondary]=useState<CardDetails|null>(null),[paired,setPaired]=useState(false);
    function selectCards(first:CardDetails|null,second:CardDetails|null,pair:boolean){
        onChange(first&&(!pair||second)?{id:'',names:[first.name,...(pair&&second?[second.name]:[])]}:{id:''});
    }
    const selected=value.names?.join(' + ')??catalog.commanders.find(c=>c.id===value.id)?.name;
    return <div className="commander-selection"><nav className="tabs" aria-label="Choose commander source"><button type="button" disabled={disabled} aria-pressed={mode==='history'} onClick={()=>{setMode('history');onChange({id:''});}}>Previously used</button><button type="button" disabled={disabled} aria-pressed={mode==='search'} onClick={()=>{setMode('search');selectCards(primary,secondary,paired);}}>Search Scryfall</button></nav>
        {selected&&<p className="commander-selected" role="status">Selected: <strong>{selected}</strong></p>}
        {mode==='history'&&<fieldset disabled={disabled}><legend>Previously used by {profileName} · most wins first</legend>
            {profile?.history.map(h=>{const commander=catalog.commanders.find(c=>c.id===h.deckId);return <div className="commander-history-row commander-option" key={h.deckId}><button type="button" className="commander-option-select" aria-label={`Select ${h.name}: ${h.wins} wins, ${h.plays} plays`} aria-pressed={value.id===h.deckId} onClick={()=>onChange({id:h.deckId})}/><div className="commander-option-content">{commander?<CommanderInfo commander={commander}/>:<strong>{h.name}</strong>}<p>{h.wins} wins · {h.plays} plays</p>{value.id===h.deckId&&<span className="commander-option-selected">✓ Selected</span>}</div></div>;})}
            {!profile?.history.length&&<p>No completed commander history yet. Search Scryfall to choose any card.</p>}
        </fieldset>}
        {mode==='search'&&<fieldset disabled={disabled}><legend>Commander cards</legend>
            <p>Select a card from the search results. House rules allow any Scryfall card.</p><CardSearch label="Primary commander card" onClear={()=>{setPrimary(null);onChange({id:''});}} onSelect={card=>{setPrimary(card);selectCards(card,secondary,paired);}}/>
            <label className="check"><input type="checkbox" checked={paired} onChange={e=>{setPaired(e.target.checked);selectCards(primary,secondary,e.target.checked);}}/> Add a partner or background</label>
            {paired&&<CardSearch label="Partner or background card" onClear={()=>{setSecondary(null);onChange({id:''});}} onSelect={card=>{setSecondary(card);selectCards(primary,card,paired);}}/>}
        </fieldset>}
    </div>;
}
