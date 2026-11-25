'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Catalog } from '@/lib/types';
import { CommanderSelection, resolveCommander, type CommanderChoice } from './commander-selection';
export function SeatSetup({number,catalog,disabled,commanderRequired,onJoin}:{number:number;catalog:Catalog;disabled:boolean;commanderRequired:boolean;onJoin:(name:string,commander:string,hidden:boolean)=>Promise<void>}) {
    const [name,setName]=useState(''),[commander,setCommander]=useState<CommanderChoice>({id:''}),[hidden,setHidden]=useState(false);
    const [saving,setSaving]=useState(false),[error,setError]=useState('');
    const locked=disabled||saving;
    return <section className="controller panel"><p className="eyebrow">SEAT {number} · OPEN</p><h2>Take your place at the table</h2>
        <label>Your player profile<select disabled={locked} value={name} onChange={e=>{setName(e.target.value);setCommander({id:''});setHidden(false);}}><option value="">Choose your profile</option>{catalog.profiles.map(p=><option key={p.name}>{p.name}</option>)}</select></label>
        {name&&<CommanderSelection key={name} catalog={catalog} profileName={name} value={commander} onChange={setCommander} disabled={locked}/>}
        <label className="check"><input type="checkbox" disabled={locked||!(commander.id||commander.names)} checked={hidden} onChange={e=>setHidden(e.target.checked)}/> Hide my commander until I reveal it</label>
        <button className="primary wide" disabled={locked||!name||(commanderRequired&&!(commander.id||commander.names))} onClick={async()=>{setSaving(true);setError('');try{await onJoin(name,await resolveCommander(commander),hidden);}catch(e){setError((e as Error).message);}finally{setSaving(false);}}}>Join seat {number} →</button>{error&&<p className="error" role="alert">{error}</p>}
        <p className="muted">Hidden commanders still count toward play and win statistics.</p><p className="muted"><Link href="/">Manage player profiles in the lobby</Link></p>
    </section>;
}
