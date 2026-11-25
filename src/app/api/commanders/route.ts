import type { CardDetails } from '@/lib/card-search';
import { checkOrigin, readJson, respond } from '@/server/http';
import { registerCommander } from '@/server/commander-cache';
export const runtime='nodejs';
export async function POST(request:Request) {return respond(async()=>{checkOrigin(request);return registerCommander(await readJson(request));});}

export async function GET(request:Request) { return respond(async()=>{
    const {service}=await import('@/server/http');
    const {scryfall}=await import('@/server/scryfall');
    const {temporaryCommander,rememberCommander,commanderPresentation}=await import('@/server/temporary-commanders');
    const id=new URL(request.url).searchParams.get('id');
    const commander=service().catalog().commanders.find(c=>c.id===id);
    if(!commander){const {GameError}=await import('@/server/game-service');throw new GameError('Commander setup not found.',404);}
    let cards:CardDetails[]=temporaryCommander(commander.id);
    if(!cards.length){
        const names=[commander.metadata.primary_name,...(commander.metadata.second_commander.enabled?[commander.metadata.second_commander.name]:[])];
        cards=[];
        for(const name of names){const result=await scryfall.lookup({name});if('card' in result)cards.push(result.card);}
        rememberCommander(commander.id,cards);
    }
    return {commander:{...commander,...commanderPresentation(cards.map(c=>c.name),cards)}};
});}
