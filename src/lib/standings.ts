import type {SeasonResults} from './types';
export function compareStandings(a:{name:string;wins:number;plays:number},b:{name:string;wins:number;plays:number}) {
    return b.wins-a.wins||a.plays-b.plays||a.name.localeCompare(b.name);
}
export function seasonAwards(results:SeasonResults) {
    const players=[...results.players].sort(compareStandings),commanders=[...results.commanders].sort(compareStandings);
    return {
        winners:players.filter(p=>p.wins>0&&p.wins===players[0]?.wins),
        bestCommanders:commanders.filter(c=>c.wins>0&&c.wins===commanders[0]?.wins&&c.plays===commanders[0]?.plays),
    };
}
