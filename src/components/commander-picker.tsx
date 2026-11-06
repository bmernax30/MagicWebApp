'use client';
import { useState } from 'react';
import type { Catalog, Player } from '@/lib/types';

export function CommanderPicker({ player, catalog, disabled, required, onChange }: {
    player: Player; catalog: Catalog; disabled: boolean; required: boolean;
    onChange: (commander: string) => Promise<void>;
}) {
    const [commander, setCommander] = useState(player.commander);
    const profile = catalog.profiles.find(p => p.name === player.name);
    const choices = profile?.commanders ?? [];
    return <details className="commander-picker"><summary>Change commander</summary>
        <p>Choose another commander for {player.name}. Life, poison, and recorded damage stay the same.</p>
        <form onSubmit={async e => { e.preventDefault(); await onChange(commander); }}>
            <label>Commander<select disabled={disabled} required={required} value={commander} onChange={e => setCommander(e.target.value)}>
                <option value="">{required ? 'Choose a commander' : 'No commander'}</option>
                {player.commander && !choices.includes(player.commander) && <option value={player.commander}>Current: {player.commander}</option>}
                {choices.map(name => <option key={name}>{name}</option>)}
            </select></label>
            {!choices.length && <p>No commanders are assigned to this player profile. Add one in the profile library.</p>}
            <button className="primary" disabled={disabled || commander === player.commander || (required && !commander)}>Use this commander</button>
        </form>
    </details>;
}
