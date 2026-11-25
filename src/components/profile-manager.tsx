'use client';
import { useState } from 'react';
import type { Catalog } from '@/lib/types';
import { api } from './client-api';
import { CommanderInfo } from './commander-info';
export function ProfileManager({catalog,onSaved,onError}:{catalog:Catalog;onSaved:(c:Catalog)=>void;onError:(e:string)=>void}) {
    const [name,setName]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
    const profile=catalog.profiles.find(p=>p.name===name);
    async function save(data:unknown) {setBusy(true);setMessage('');onError('');try{onSaved(await api<Catalog>('/api/catalog',data));setMessage('Saved to your library.');}catch(e){onError((e as Error).message);}finally{setBusy(false);}}
    return <div className="profile-editor"><section className="panel"><p className="eyebrow">YOUR PLAYGROUP</p><h2>Player profiles</h2>
        <label>Load a profile<select disabled={busy} value={profile?name:''} onChange={e=>{setName(e.target.value);setMessage('');}}><option value="">New player profile</option>{catalog.profiles.map(p=><option key={p.name}>{p.name}</option>)}</select></label>
        <label>Player name<input disabled={busy} value={name} maxLength={120} onChange={e=>setName(e.target.value)}/></label>
        <div className="actions"><button className="primary" disabled={busy||!name.trim()} onClick={()=>void save({type:'profile',name})}>Save player</button><button disabled={busy||!profile} onClick={()=>{if(window.confirm(`Delete ${name}?`))void save({type:'deleteProfile',name});}}>Delete player</button></div>
        {message&&<p role="status">{message}</p>}
        {profile&&<><h3>Commander history</h3><p>{catalog.season.name}: {profile.wins} wins · {profile.plays} plays</p>
            {!profile.history.length&&<p>No completed commander games recorded yet. Choose cards from Scryfall when you join a game.</p>}
            {profile.history.map(h=>{const deck=catalog.commanders.find(c=>c.id===h.deckId);return <article className="commander-history-row" key={h.deckId}>{deck?<CommanderInfo commander={deck}/>:<h4>{h.name}</h4>}<p>{h.wins} wins · {h.plays} plays</p></article>;})}
        </>}
    </section></div>;
}
