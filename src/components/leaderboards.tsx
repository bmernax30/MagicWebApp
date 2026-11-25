'use client';
import {useState} from 'react';
import type {Catalog} from '@/lib/types';
import {compareStandings,seasonAwards} from '@/lib/standings';
function Standings({players,commanders}:{players:{name:string;wins:number;plays:number}[];commanders:{name:string;wins:number;plays:number}[]}) {
    return <div className="lobby-grid">{[{title:'Players',entries:[...players].sort(compareStandings)},{title:'Top 10 commanders',entries:[...commanders].sort(compareStandings).slice(0,10)}].map(({title,entries})=><section className="panel" key={title} aria-label={title}><h3>{title}</h3>{entries.map((p,i)=><div className="leader" key={p.name}><span>{i+1}</span><strong>{p.name}</strong><span>{p.wins} wins · {p.plays} plays</span></div>)}{!entries.length&&<p>No results yet.</p>}</section>)}</div>;
}
export function Leaderboards({catalog}:{catalog:Catalog}) {
    const [tab,setTab]=useState<'current'|'results'>('current'),[seasonId,setSeasonId]=useState(catalog.seasonResults[0]?.id??0);
    const result=catalog.seasonResults.find(s=>s.id===seasonId),awards=result?seasonAwards(result):null;
    return <div className="season-leaderboards"><nav role="tablist" aria-label="Leaderboard views" className="tabs lobby-tabs" onKeyDown={e=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
        e.preventDefault();const next=e.key==='Home'?'current':e.key==='End'?'results':tab==='current'?'results':'current';setTab(next);e.currentTarget.querySelector<HTMLButtonElement>(`#leaderboard-tab-${next}`)?.focus();
    }}>{(['current','results'] as const).map(id=><button key={id} role="tab" id={`leaderboard-tab-${id}`} aria-controls={`leaderboard-panel-${id}`} aria-selected={tab===id} tabIndex={tab===id?0:-1} onClick={()=>setTab(id)}>{id==='current'?'Current season':'Season results'}</button>)}</nav>
        <section role="tabpanel" id="leaderboard-panel-current" aria-labelledby="leaderboard-tab-current" hidden={tab!=='current'}><h2>{catalog.season.name}</h2><p>Started {catalog.season.startDate}</p><Standings players={catalog.profiles} commanders={catalog.commanders}/></section>
        <section role="tabpanel" id="leaderboard-panel-results" aria-labelledby="leaderboard-tab-results" hidden={tab!=='results'}>
            <label>Completed season<select value={seasonId} onChange={e=>setSeasonId(Number(e.target.value))}>{catalog.seasonResults.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            {result&&awards?<><h2>{result.name} results</h2><p>{result.startDate?`Started ${result.startDate} · `:''}Ended {result.endDate}</p><div className="season-awards panel"><h3>{result.name} winner</h3><p>{awards.winners.map(p=>p.name).join(' · ')||'No winner'}{awards.winners.length>0&&` · ${awards.winners[0].wins} wins`}</p><h3>{result.name} Best Commander</h3><p>{awards.bestCommanders.map(c=>c.name).join(' · ')||'No winner'}{awards.bestCommanders.length>0&&` · ${awards.bestCommanders[0].wins} wins · ${awards.bestCommanders[0].plays} plays`}</p><p className="muted">Best Commander ranks by wins, then fewer plays. Remaining ties share the award.</p></div><Standings players={result.players} commanders={result.commanders}/></>:<p>No completed seasons yet.</p>}
        </section>
    </div>;
}
