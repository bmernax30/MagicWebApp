import 'server-only';
import { z } from 'zod';
import { scryfall } from './scryfall';
import { GameError, gameService } from './game-service';
import type { openDatabase } from '../db/client';
import { database } from '../db/client';
import { commanderDeckId,scryfallSetupId } from '../lib/commander-decks';
import { legacyMetadata,mergeResolvedCommander } from '../db/commander-history';
import { rememberCommander } from './temporary-commanders';
import type { CardDetails } from '../lib/card-search';
export async function registerCommander(input: unknown, context?: {store:ReturnType<typeof openDatabase>;lookup:typeof scryfall.lookup}) {
    const {names}=z.strictObject({names:z.array(z.string().trim().min(1).max(200)).min(1).max(2)}).parse(input);
    const cards:CardDetails[]=[];
    for(const name of names) { const result=await (context?.lookup??scryfall.lookup)({name});if('card' in result)cards.push(result.card);else throw new GameError('Scryfall returned unexpected card data.',502); }
    const id=scryfallSetupId(cards);
    const legacyId=commanderDeckId(cards.map(c=>c.name));
    const store=context?.store??database();
    const {sqlite}=store;
    return sqlite.transaction(()=>{
        // Persist identity only. Card text, images and face data live in memory.
        const metadata=legacyMetadata(cards.map(c=>c.name));
        sqlite.prepare(`INSERT INTO commander_decks(id,name,cards,legacy_metadata,legacy_rules) VALUES (?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name,cards='[]',legacy_metadata=excluded.legacy_metadata,legacy_rules=''`).run(id,cards.map(c=>c.name).join(' + '),'[]',JSON.stringify(metadata),'');
        if(legacyId!==id)mergeResolvedCommander(sqlite,legacyId,id);
        rememberCommander(id,cards);
        return {commander:gameService(store).catalog().commanders.find(c=>c.id===id)!};
    }).immediate();
}
