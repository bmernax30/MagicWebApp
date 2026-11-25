'use client';
import { useState } from 'react';
import type { Catalog,Player } from '@/lib/types';
import { CommanderSelection, resolveCommander, type CommanderChoice } from './commander-selection';
export function CommanderPicker({player,catalog,disabled,required,onChange}:{player:Player;catalog:Catalog;disabled:boolean;required:boolean;onChange:(commander:string,hidden:boolean)=>Promise<void>}) {
    const [commander,setCommander]=useState<CommanderChoice>({id:player.deckId??''}),[hidden,setHidden]=useState(player.hidden);
    const [saving,setSaving]=useState(false),[error,setError]=useState('');
    const locked=disabled||saving;
    return <details className="commander-picker"><summary>Change commander</summary><p>Choose a previously used setup or new Scryfall cards. Scores stay unchanged; the final setup at Finish receives this game’s play and any win.</p>
        <CommanderSelection catalog={catalog} profileName={player.name} value={commander} onChange={setCommander} disabled={locked}/>
        <label className="check"><input type="checkbox" checked={hidden} disabled={locked||!(commander.id||commander.names)} onChange={e=>setHidden(e.target.checked)}/> Hide this commander until I reveal it</label>
        <button className="primary" disabled={locked||(required&&!(commander.id||commander.names))||((!commander.names&&commander.id===(player.deckId??''))&&hidden===player.hidden)} onClick={async()=>{setSaving(true);setError('');try{await onChange(await resolveCommander(commander),hidden);}catch(e){setError((e as Error).message);}finally{setSaving(false);}}}>Save commander</button>{error&&<p className="error" role="alert">{error}</p>}
    </details>;
}
