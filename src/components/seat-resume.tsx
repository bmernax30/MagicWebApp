'use client';
import { useEffect, useId, useRef } from 'react';
import type { Player } from '@/lib/types';

export function SeatResume({ number, player, available, disabled, onCancel, onResume }: {
    number: number; player: Player | undefined; available: boolean; disabled: boolean;
    onCancel: () => void; onResume: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const title = useId(), description = useId();
    useEffect(() => {
        const element = dialog.current;
        element?.showModal();
        return () => element?.close();
    }, []);
    return <dialog ref={dialog} className="seat-resume-dialog" aria-labelledby={title} aria-describedby={description} onCancel={onCancel}>
        <section className="panel modal"><p className="eyebrow">RECONNECT TO SEAT {number}</p><h2 id={title}>Take over this seat?</h2>
            <p id={description}>Use the existing player profile and commander. Taking over keeps all current scores and game progress unchanged.</p>
            {available && player ? <>
                <dl className="seat-resume-setup"><div><dt>Player profile</dt><dd>{player.name}</dd></div>
                    <div><dt>Commander</dt><dd>{player.hidden ? 'Hidden commander (unchanged)' : player.commander || 'No commander'}</dd></div>
                    <div><dt>Life</dt><dd>{player.life}</dd></div><div><dt>Poison</dt><dd>{player.poison}</dd></div></dl>
                <p>Commander damage received: {player.damage.map((value, i) => `P${i + 1}: ${value}`).join(' · ')}</p>
            </> : <p role="alert">This seat is no longer occupied by the same player. Close this window and choose a seat again.</p>}
            <p className="muted">Any phone with this game code can reconnect. Other connected devices can still use this seat’s controls.</p>
            <div className="actions"><button autoFocus onClick={onCancel}>Cancel</button><button className="primary" disabled={disabled || !available} onClick={onResume}>Take over seat {number} →</button></div>
        </section>
    </dialog>;
}
