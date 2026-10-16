import type { Catalog, Player } from '@/lib/types';
import { CommanderInfo } from './commander-info';

export function TableCommanders({ players, selectedNumber, catalog }: {
    players: Player[]; selectedNumber: number; catalog: Catalog | null;
}) {
    const opponents = players.filter(player => player.joined && player.number !== selectedNumber);
    return <section className="table-commanders" aria-label="Other players’ commanders">
        <h3>Other players’ commanders</h3>
        {!opponents.length && <p>Other players will appear here when they join the table.</p>}
        {opponents.map(player => {
            const commander = catalog?.commanders.find(card => card.name === player.commander);
            return <article className="opponent-commander" key={player.number}>
                <div className="opponent-heading">
                    <span className="player-number">{player.number}</span>
                    <div><strong>{player.name}</strong><p>{player.hidden ? 'Commander hidden' : player.commander || 'No commander selected'}</p></div>
                    <span className="opponent-life">{player.life}<small>life</small></span>
                </div>
                {!player.hidden && player.commander && (commander
                    ? <CommanderInfo commander={commander}/>
                    : <p className="muted">{catalog ? 'Commander info is unavailable.' : 'Loading commander info…'}</p>)}
            </article>;
        })}
    </section>;
}
