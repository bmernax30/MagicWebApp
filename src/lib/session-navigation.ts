import type { Game } from './types';

export function sessionDestination(game: Pick<Game, 'status' | 'nextGameCode'> | null, view: string, archive: boolean): string | null {
    if (!game || archive || game.status === 'active') return null;
    if (game.status === 'finished' && game.nextGameCode) {
        return `/game/${game.nextGameCode}?view=${encodeURIComponent(view)}`;
    }
    return '/?notice=game-ended';
}
