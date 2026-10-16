export type CommanderMetadata = {
    primary_name: string;
    image_path: string;
    text_path?: string;
    attack_power: number;
    defense_power: number;
    colors: string[];
    color_cost: Record<string, number>;
    second_commander: {
        enabled: boolean;
        name: string;
        image_path: string;
        text_path?: string;
        attack_power: number;
        defense_power: number;
        colors: string[];
        color_cost: Record<string, number>;
    };
};
export type Commander = {
    name: string;
    wins: number;
    metadata: CommanderMetadata;
    rules: string;
};
export type Profile = {
    name: string;
    wins: number;
    commanders: string[];
};
export type Settings = {
    number_of_players: number;
    starting_life_total: number;
    game_type: 'Commander' | 'Standard';
    planechase_enabled: boolean;
};
export type Plane = {
    name: string;
    image: string;
    rules: string;
};
export type Catalog = {
    profiles: Profile[];
    commanders: Commander[];
    planes: Plane[];
    settings: Settings;
};
export type Player = {
    number: number;
    joined: boolean;
    name: string;
    commander: string;
    life: number;
    poison: number;
    damage: number[];
    hidden: boolean;
};
export type Game = {
    code: string;
    revision: number;
    round: number;
    status: 'active' | 'finished' | 'exited';
    settings: Settings;
    players: Player[];
    winner: number | null;
    planeHistory: string[];
    planeIndex: number;
    createdAt: string;
};
export function isAlive(player: Player) { return player.joined && player.life > 0 && player.poison < 10 && !player.damage.some(n => n >= 21); }
export function winnerOf(players: Player[]) {
    const joined = players.filter(p => p.joined);
    if (joined.length < 2) return null;
    const alive = joined.filter(isAlive);
    return alive.length === 1 ? alive[0].number : null;
}
export function assetUrl(path: string) { return path.startsWith('res/') && !path.includes('..') ? '/' + path : ''; }
