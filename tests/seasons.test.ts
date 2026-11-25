import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema';
import {initializeSeasons} from '../src/db/seasons';
import {applyTestSchema} from './schema-fixture';
import {openDatabase} from '../src/db/client';
import {importMagic} from '../src/db/import';
import {gameService} from '../src/server/game-service';
import {completeCommanderMetadata} from '../src/lib/commander-defaults';
import {seasonAwards,compareStandings} from '../src/lib/standings';
import {mergeResolvedCommander} from '../src/db/commander-history';
import type {Game,SeasonResults} from '../src/lib/types';
const sql=fs.readFileSync('drizzle/0008_seasons.sql','utf8');
function oldDatabase(){
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');
 for(const n of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')&&n<'0008').sort())db.exec(fs.readFileSync('drizzle/'+n,'utf8'));
 db.prepare('INSERT INTO settings VALUES (?,?)').run('defaults',JSON.stringify({number_of_players:2,starting_life_total:40,game_type:'Commander',planechase_enabled:false}));
 for(const [name,wins]of [['Alice',7],['Bob',2]])db.prepare('INSERT INTO profiles VALUES (?,?)').run(name,wins);
 for(const [name,wins]of [['A',4],['B',2],['C',5]])db.prepare('INSERT INTO commander_decks(id,name,legacy_metadata,baseline_wins,baseline_plays) VALUES (?,?,?,?,?)').run(name,name,JSON.stringify(completeCommanderMetadata({primary_name:String(name)})),wins,wins);
 for(let i=0;i<3;i++){
  const code=['ABC234','DEF567','GHI789'][i];db.prepare('INSERT INTO games VALUES (?,?,?,?)').run(code,JSON.stringify({preserved:i}),i,'before');
  db.prepare('INSERT INTO game_appearances VALUES (?,?,?,?,?,?,?,?)').run(code,1,1,'Alice','A',i===0?1:0,'before','live');
 }
 return db;
}
function migrate(db:Database.Database){db.transaction(()=>{db.exec(sql);initializeSeasons(db);}).immediate();}
function snapshot(db:Database.Database){return {players:db.prepare('SELECT * FROM season_player_results ORDER BY name').all(),commanders:db.prepare('SELECT * FROM season_commander_results ORDER BY commander_id').all()};}
function fixture(){const directory=fs.mkdtempSync(path.join(tmpdir(),'magic-seasons-')),file=path.join(directory,'test.sqlite');const db=new Database(file);applyTestSchema(db);importMagic(db,path.resolve('seed-data/res'));db.close();const store=openDatabase(file),service=gameService(store);return{store,service,close(){store.sqlite.close();fs.rmSync(directory,{recursive:true,force:true});}};}
function change(f:ReturnType<typeof fixture>,game:Game,action:Record<string,unknown>){return f.service.act(game.code,{id:randomUUID(),round:game.round,revision:game.revision,...action});}
function joined(f:ReturnType<typeof fixture>){const catalog=f.service.catalog();let g=f.service.create({settings:catalog.settings});for(let i=0;i<2;i++)g=change(f,g,{type:'join',player:i+1,name:catalog.profiles[i].name,commander:catalog.commanders[i].id});return g;}

test('season migration freezes existing totals once, zeros current stats and preserves old games and appearances',()=>{
 const db=oldDatabase();try{
  const games=db.prepare('SELECT * FROM games ORDER BY code').all(),appearances=db.prepare('SELECT * FROM game_appearances ORDER BY game').all();migrate(db);
  assert.deepEqual(db.prepare('SELECT * FROM games ORDER BY code').all(),games);
  assert.deepEqual(db.prepare('SELECT game,round,seat,profile,deck_id,won,finished_at,source FROM game_appearances ORDER BY game').all(),appearances);
  assert.deepEqual(db.prepare('SELECT * FROM season_player_results ORDER BY name').all(),[{season_id:0,name:'Alice',wins:7,plays:9},{season_id:0,name:'Bob',wins:2,plays:2}]);
  assert.deepEqual(db.prepare('SELECT commander_id,wins,plays FROM season_commander_results ORDER BY commander_id').all(),[{commander_id:'A',wins:5,plays:7},{commander_id:'B',wins:2,plays:2},{commander_id:'C',wins:5,plays:5}]);
  assert.deepEqual(db.prepare('SELECT wins FROM profiles').all(),[{wins:0},{wins:0}]);assert.ok((db.prepare('SELECT baseline_wins,baseline_plays FROM commander_decks').all() as {baseline_wins:number;baseline_plays:number}[]).every(d=>d.baseline_wins===0&&d.baseline_plays===0));
  assert.deepEqual(db.prepare('SELECT start_date FROM seasons WHERE id=1').get(),{start_date:'2026-11-25'});assert.equal((db.prepare('SELECT COUNT(*) AS n FROM game_appearances WHERE season_id=0').get() as {n:number}).n,3);
  const archived=snapshot(db);initializeSeasons(db);assert.deepEqual(snapshot(db),archived);assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{db.close();}
});

test('failure while archiving rolls back the entire season migration and reset',()=>{
 const db=oldDatabase();try{const before=db.prepare('SELECT * FROM profiles').all();assert.throws(()=>db.transaction(()=>{db.exec(sql);db.exec("CREATE TRIGGER fail_archive BEFORE INSERT ON season_commander_results BEGIN SELECT RAISE(ABORT,'archive failed'); END;");initializeSeasons(db);})(),/archive failed/);assert.deepEqual(db.prepare('SELECT * FROM profiles').all(),before);assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='seasons'").get());assert.equal((db.prepare("SELECT baseline_wins FROM commander_decks WHERE id='A'").get() as {baseline_wins:number}).baseline_wins,4);}finally{db.close();}
});

test('only new Finish appearances count in Season 1; duplicate Finish and initializer never reset progress',()=>{
 const f=fixture();try{
  const initial=f.service.catalog(),archive=initial.seasonResults;assert.ok(initial.profiles.every(p=>p.wins===0&&p.plays===0));assert.ok(initial.commanders.every(c=>c.wins===0&&c.plays===0));
  let g=joined(f);g=change(f,g,{type:'counter',player:2,counter:'life',delta:-g.settings.starting_life_total});const finish={id:randomUUID(),round:g.round,revision:g.revision,type:'finish'};f.service.act(g.code,finish);f.service.act(g.code,finish);initializeSeasons(f.store.sqlite);
  const after=f.service.catalog();assert.equal(after.profiles.find(p=>p.name===g.players[0].name)!.wins,1);assert.equal(after.profiles.find(p=>p.name===g.players[0].name)!.plays,1);assert.equal(after.commanders.find(c=>c.id===g.players[0].deckId)!.wins,1);assert.equal(after.commanders.reduce((sum,c)=>sum+c.plays,0),2);assert.deepEqual(after.seasonResults,archive);
  assert.equal((f.store.sqlite.prepare('SELECT COUNT(*) AS n FROM game_appearances WHERE season_id=1').get() as {n:number}).n,2);assert.ok(!('unattributedWins' in after.profiles[0]));
 }finally{f.close();}
});

test('historical commander choices remain available with zero current-season counts',()=>{
 const f=fixture();try{const g=joined(f);change(f,g,{type:'finish'});f.store.sqlite.prepare('UPDATE game_appearances SET season_id=0').run();f.store.sqlite.prepare('UPDATE profiles SET wins=0').run();const catalog=f.service.catalog(),p=catalog.profiles.find(p=>p.name===g.players[0].name)!;assert.equal(p.plays,0);assert.equal(p.history.length,1);assert.equal(p.history[0].deckId,g.players[0].deckId);assert.equal(p.history[0].plays,0);assert.equal(catalog.commanders.find(c=>c.id===g.players[0].deckId)!.plays,0);}finally{f.close();}
});

test('alias resolution changes current identities without rewriting frozen season results',()=>{
 const f=fixture();try{const before=f.service.catalog().seasonResults,[old,target]=f.service.catalog().commanders;mergeResolvedCommander(f.store.sqlite,old.id,target.id);assert.deepEqual(f.service.catalog().seasonResults,before);}finally{f.close();}
});

test('season awards rank by wins and fewer commander plays; unresolved ties share awards',()=>{
 const result:SeasonResults={id:0,name:'Season 0',startDate:null,endDate:'2026-11-25',players:[{name:'Alice',wins:7,plays:12},{name:'Bob',wins:7,plays:9}],commanders:[{commanderId:'A',name:'A',wins:5,plays:8},{commanderId:'B',name:'B',wins:5,plays:6},{commanderId:'C',name:'C',wins:5,plays:6},{commanderId:'D',name:'D',wins:4,plays:4}]};
 assert.deepEqual(seasonAwards(result).winners.map(p=>p.name).sort(),['Alice','Bob']);assert.deepEqual(seasonAwards(result).bestCommanders.map(c=>c.name),['B','C']);assert.equal([...result.commanders].sort(compareStandings)[0].name,'B');
 assert.deepEqual(seasonAwards({...result,players:[{name:'Zero',wins:0,plays:0}],commanders:[]}),{winners:[],bestCommanders:[]});
});


test('an active game surviving the migration credits its Finish to Season 1 only',()=>{
 const db=oldDatabase();try{
  const game:Game={code:'JKL234',round:1,revision:0,status:'active',settings:{number_of_players:2,starting_life_total:40,game_type:'Commander',planechase_enabled:false},players:['Alice','Bob'].map((name,i)=>({number:i+1,joined:true,name,commander:i?'B':'A',deckId:i?'B':'A',life:40,poison:0,damage:[0,0],hidden:false})),winner:null,createdAt:'before',endedAt:null,previousGameCode:null,nextGameCode:null,emotes:[],planeHistory:[],planeIndex:-1};
  db.prepare('INSERT INTO games VALUES (?,?,?,?)').run(game.code,JSON.stringify(game),0,'before');migrate(db);
  const service=gameService({sqlite:db,orm:drizzle(db,{schema})});const archive=service.catalog().seasonResults;
  let active=service.get(game.code);assert.deepEqual(active.players.map(p=>p.life),[40,40]);
  active=service.act(active.code,{id:randomUUID(),round:active.round,revision:active.revision,type:'counter',player:2,counter:'life',delta:-40});
  service.act(active.code,{id:randomUUID(),round:active.round,revision:active.revision,type:'finish'});
  assert.equal(service.catalog().profiles.find(p=>p.name==='Alice')!.wins,1);assert.equal(service.catalog().commanders.find(c=>c.id==='A')!.wins,1);assert.deepEqual(service.catalog().seasonResults,archive);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM game_appearances WHERE season_id=1').get() as {n:number}).n,2);
 }finally{db.close();}
});

test('Standard Finish counts player wins and plays without inventing commander usage',()=>{
 const f=fixture();try{const c=f.service.catalog();let g=f.service.create({settings:{...c.settings,number_of_players:2,game_type:'Standard'}});for(let i=0;i<2;i++)g=change(f,g,{type:'join',player:i+1,name:c.profiles[i].name,commander:''});g=change(f,g,{type:'counter',player:2,counter:'life',delta:-g.settings.starting_life_total});change(f,g,{type:'finish'});const after=f.service.catalog();assert.equal(after.profiles[0].wins,1);assert.equal(after.profiles[0].plays,1);assert.equal(after.commanders.reduce((n,c)=>n+c.plays,0),0);assert.equal(after.profiles[0].history.length,0);}finally{f.close();}
});
