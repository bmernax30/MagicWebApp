import 'server-only';
import type { CardDetails } from '../lib/card-search';
import { legacyMetadata } from '../db/commander-history';
const shared=globalThis as typeof globalThis & { magicTemporaryCommanders?:Map<string,{until:number;cards:CardDetails[]}> };
const cache=shared.magicTemporaryCommanders??=new Map();
export function rememberCommander(id:string,cards:CardDetails[]) {
    if(cache.size>=100)cache.delete(cache.keys().next().value!);
    cache.set(id,{until:Date.now()+15*60*1000,cards});
}
export function temporaryCommander(id:string) {
    const entry=cache.get(id);
    if(entry&&entry.until>Date.now())return entry.cards;
    cache.delete(id);return [];
}
export function commanderPresentation(names:string[],cards:CardDetails[]) {
    const metadata=legacyMetadata(names);
    cards.forEach((card,i)=>{const target=i===0?metadata:metadata.second_commander;target.image_path=card.faces[0]?.image??'';});
    return {cards,metadata,rules:cards.flatMap(c=>c.faces.map(f=>f.text)).join('\n\n')};
}
