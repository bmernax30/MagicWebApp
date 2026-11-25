import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {applyTestSchema} from './schema-fixture';
import {openDatabase} from '../src/db/client';
import {importMagic} from '../src/db/import';
import {migrateCommanderHistory,mergeResolvedCommander} from '../src/db/commander-history';
import {completeCommanderMetadata} from '../src/lib/commander-defaults';
import {commanderDeckId} from '../src/lib/commander-decks';
import {gameService} from '../src/server/game-service';
import {registerCommander} from '../src/server/commander-cache';
import type {CardDetails} from '../src/lib/card-search';
import type {Game,Player} from '../src/lib/types';
const settings={number_of_players:2,starting_life_total:40,game_type:'Commander' as const,planechase_enabled:false};
function fixture(){const dir=fs.mkdtempSync(path.join(tmpdir(),'magic-history-')),file=path.join(dir,'test.sqlite');const db=new Database(file);applyTestSchema(db);importMagic(db,path.resolve('seed-data/res'));db.close();const store=openDatabase(file);return{store,service:gameService(store),close(){store.sqlite.close();fs.rmSync(dir,{recursive:true,force:true});}};}
function card(name:string):CardDetails{return{name,url:'https://scryfall.com/card/example',manaValue:3,set:'Test',number:'1',rarity:'rare',released:'2026-01-01',legalities:{commander:'legal'},faces:[{name,image:'https://cards.scryfall.io/normal/card.jpg',manaCost:'{2}{U}',colors:['U'],type:'Legendary Creature — Fish Wizard',text:'Rules for '+name,power:'*',toughness:'3',loyalty:'',defense:'',flavor:'',artist:'Test Artist'}]};}
async function register(f:ReturnType<typeof fixture>,names:string[]){return(await registerCommander({names},{store:f.store,lookup:async(input)=>({card:card((input as {name:string}).name)})})).commander;}
function joined(f:ReturnType<typeof fixture>,id:string,hidden=false){let g=f.service.create({settings});for(let i=0;i<2;i++)g=f.service.act(g.code,{id:randomUUID(),type:'join',player:i+1,name:f.service.catalog().profiles[i].name,commander:id,hidden:i===0&&hidden,round:g.round,revision:g.revision});return g;}
function act(f:ReturnType<typeof fixture>,g:Game,body:Record<string,unknown>){return f.service.act(g.code,{id:randomUUID(),round:g.round,revision:g.revision,...body});}

test('Scryfall-backed pair identity ignores order, returns temporary details, and does not create assignments or plays',async()=>{const f=fixture();try{
 const a=await register(f,['Fish Wizard','House Background']);const b=await register(f,['House Background','Fish Wizard']);
 assert.equal(a.id,b.id);assert.equal(a.cards.length,2);assert.equal(a.cards[0].faces[0].power,'*');assert.equal(a.cards[0].faces[0].type,'Legendary Creature — Fish Wizard');assert.equal(a.metadata.image_path,'https://cards.scryfall.io/normal/card.jpg');assert.equal(a.plays,0);
 assert.equal(commanderDeckId(['A','B']),commanderDeckId(['B','A']));
 assert.ok(!f.store.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='profile_commanders'").get());
 assert.ok(f.service.catalog().profiles.every(p=>p.history.length===0));
 await assert.rejects(registerCommander({names:['A'],cards:[card('forged')]},{store:f.store,lookup:async()=>({card:card('A')})}));
}finally{f.close();}});

test('Finish counts player appearances, hidden selections and pairs exactly once; singles do not inherit pair wins',async()=>{const f=fixture();try{
 const single=await register(f,['Fish Wizard']),pair=await register(f,['Fish Wizard','House Background']);let g=joined(f,pair.id,true);
 assert.equal(f.service.catalog().commanders.find(c=>c.id===pair.id)!.plays,0);
 g=act(f,g,{type:'counter',player:2,counter:'life',delta:-40});const finish={id:randomUUID(),type:'finish',round:g.round,revision:g.revision};const result=f.service.act(g.code,finish);f.service.act(g.code,finish);
 const catalog=f.service.catalog(),stats=catalog.commanders.find(c=>c.id===pair.id)!;
 assert.equal(stats.plays,2);assert.equal(stats.wins,1);assert.equal(catalog.commanders.find(c=>c.id===single.id)!.plays,0);assert.equal(catalog.commanders.find(c=>c.id===single.id)!.wins,0);
 assert.equal(result.players[0].hidden,true);for(const p of g.players){const h=catalog.profiles.find(v=>v.name===p.name)!.history.find(h=>h.deckId===pair.id)!;assert.equal(h.plays,1);assert.equal(h.wins,p.number===1?1:0);}
 assert.throws(()=>act(f,result,{type:'finish'}),/finished/);assert.equal((f.store.sqlite.prepare('SELECT COUNT(*) AS n FROM game_appearances').get() as {n:number}).n,2);
 const next=f.service.get(result.nextGameCode!);assert.ok(next.players.every(p=>p.deckId===pair.id));assert.equal(f.service.catalog().commanders.find(c=>c.id===pair.id)!.plays,2);
}finally{f.close();}});

test('only the final commander setup receives plays and wins; reveal preserves selection and scores',async()=>{const f=fixture();try{
 const old=await register(f,['Old Fish']),final=await register(f,['New Fish']);let g=joined(f,old.id,true);const scores=structuredClone(g.players[0]);
 g=act(f,g,{type:'reveal',player:1});assert.equal(g.players[0].hidden,false);assert.deepEqual({...g.players[0],hidden:true},scores);
 g=act(f,g,{type:'change-commander',player:1,commander:final.id,hidden:true});assert.equal(g.players[0].deckId,final.id);g=act(f,g,{type:'counter',player:2,counter:'poison',delta:10});act(f,g,{type:'finish'});
 const c=f.service.catalog();assert.equal(c.commanders.find(c=>c.id===old.id)!.plays,1);assert.equal(c.commanders.find(c=>c.id===old.id)!.wins,0);assert.equal(c.commanders.find(c=>c.id===final.id)!.plays,1);assert.equal(c.commanders.find(c=>c.id===final.id)!.wins,1);
}finally{f.close();}});

test('Exit, Restart, registration and reconnection do not count plays; completed draws do',async()=>{const f=fixture();try{
 const deck=await register(f,['Draw Fish']);let g=joined(f,deck.id);f.service.get(g.code);g=act(f,g,{type:'restart'});act(f,g,{type:'exit'});assert.equal(f.service.catalog().commanders.find(c=>c.id===deck.id)!.plays,0);
 g=joined(f,deck.id);act(f,g,{type:'finish'});const stats=f.service.catalog().commanders.find(c=>c.id===deck.id)!;assert.equal(stats.plays,2);assert.equal(stats.wins,0);
}finally{f.close();}});

test('a failed appearance insert rolls back win credit, finish, log and successor creation',async()=>{const f=fixture();try{
 const deck=await register(f,['Rollback Fish']);let g=joined(f,deck.id);g=act(f,g,{type:'counter',player:2,counter:'life',delta:-40});const before=f.service.catalog();const games=f.store.sqlite.prepare('SELECT COUNT(*) AS n FROM games').get();const log=f.service.log(g.code);
 f.store.sqlite.exec("CREATE TRIGGER fail_history BEFORE INSERT ON game_appearances BEGIN SELECT RAISE(ABORT,'history unavailable'); END;");assert.throws(()=>act(f,g,{type:'finish'}),/history unavailable/);assert.deepEqual(f.service.get(g.code),g);assert.deepEqual(f.service.catalog(),before);assert.deepEqual(f.service.log(g.code),log);assert.deepEqual(f.store.sqlite.prepare('SELECT COUNT(*) AS n FROM games').get(),games);
}finally{f.close();}});

function oldStore(){const dir=fs.mkdtempSync(path.join(tmpdir(),'magic-legacy-history-')),file=path.join(dir,'legacy.sqlite'),db=new Database(file);db.pragma('foreign_keys=ON');db.exec(fs.readFileSync('drizzle/0000_magic.sql','utf8'));db.exec(fs.readFileSync('drizzle/0002_game_log.sql','utf8'));return{db,file,close(){db.close();fs.rmSync(dir,{recursive:true,force:true});}};}
test('legacy reconstruction recovers historical rounds without double-counting existing wins or inventing player attribution',()=>{const f=oldStore();try{
 for(const [name,wins]of [['Alice',5],['Bob',2]] as const)f.db.prepare('INSERT INTO profiles VALUES (?,?)').run(name,wins);
 for(const [name,wins]of [['A',5],['B',2]] as const)f.db.prepare('INSERT INTO commanders VALUES (?,?,?,?)').run(name,wins,JSON.stringify(completeCommanderMetadata({primary_name:name})),'rules');
 f.db.prepare('INSERT INTO profile_commanders VALUES (?,?)').run('Alice','A');f.db.prepare('INSERT INTO settings VALUES (?,?)').run('defaults',JSON.stringify(settings));
 const players:Player[]=['Alice','Bob'].map((name,i)=>({number:i+1,joined:true,name,commander:i?'B':'A',life:i?0:40,poison:0,damage:[0,0],hidden:false}));
 const g:Game={code:'ABC234',round:1,revision:1,status:'finished',players,winner:1,settings,createdAt:'then',endedAt:'then',previousGameCode:null,nextGameCode:null,emotes:[],planeHistory:[],planeIndex:-1};
 f.db.prepare('INSERT INTO games VALUES (?,?,?,?)').run(g.code,JSON.stringify(g),1,'then');
 const second={...g,code:'DEF567',status:'active',round:2,winner:null,players:players.map(p=>({...p,commander:'B',life:40}))};f.db.prepare('INSERT INTO games VALUES (?,?,?,?)').run(second.code,JSON.stringify(second),6,'then');
 const events=[{type:'join',player:1,name:'Alice',commander:'A',round:1},{type:'join',player:2,name:'Bob',commander:'B',round:1},{type:'counter',player:2,counter:'life',delta:-40,round:1},{type:'finish',round:1},{type:'restart',round:1},{type:'change-commander',player:1,commander:'B',round:2}];
 events.forEach((a,i)=>f.db.prepare('INSERT INTO actions(game,id,payload,revision) VALUES (?,?,?,?)').run(second.code,randomUUID(),JSON.stringify(a),i+1));
 const before=f.db.prepare('SELECT * FROM games ORDER BY code').all();f.db.transaction(()=>{f.db.exec(fs.readFileSync('drizzle/0006_commander_history.sql','utf8'));migrateCommanderHistory(f.db);})();
 const appearances=f.db.prepare('SELECT * FROM game_appearances').all() as {profile:string;deck_id:string;won:number}[];assert.equal(appearances.length,4);assert.ok(appearances.filter(a=>a.profile==='Alice').every(a=>a.deck_id===commanderDeckId(['A'])&&a.won===1));
 const a=f.db.prepare('SELECT * FROM commander_decks WHERE id=?').get(commanderDeckId(['A'])) as {baseline_wins:number;baseline_plays:number};assert.equal(a.baseline_wins,3);assert.equal(a.baseline_plays,3);
 const b=f.db.prepare('SELECT * FROM commander_decks WHERE id=?').get(commanderDeckId(['B'])) as {baseline_wins:number};assert.equal(b.baseline_wins,2);
 assert.deepEqual(f.db.prepare('SELECT * FROM games ORDER BY code').all(),before);const snapshot=f.db.prepare('SELECT * FROM commander_decks ORDER BY id').all();migrateCommanderHistory(f.db);assert.deepEqual(f.db.prepare('SELECT * FROM commander_decks ORDER BY id').all(),snapshot);
 assert.equal((f.db.prepare('SELECT wins FROM profiles WHERE name=?').get('Alice') as {wins:number}).wins,5);assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
}finally{f.close();}});

test('migration failure restores the original catalog and assignments transactionally',()=>{const f=oldStore();try{
 f.db.prepare('INSERT INTO commanders VALUES (?,?,?,?)').run('Bad',1,'invalid JSON','');assert.throws(()=>f.db.transaction(()=>{f.db.exec(fs.readFileSync('drizzle/0006_commander_history.sql','utf8'));migrateCommanderHistory(f.db);})());assert.ok(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='profile_commanders'").get());assert.ok(f.db.prepare("SELECT 1 FROM commanders WHERE name='Bad'").get());assert.ok(!f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='commander_decks'").get());
}finally{f.close();}});


test('exact-name alias reconciliation merges floors and appearances while old active game IDs remain usable',async()=>{
 const f=fixture();try{
  const old=await register(f,['Legacy punctuation']),canonical=await register(f,['Canonical punctuation']);let g=joined(f,old.id);
  const raw=f.store.sqlite.prepare('SELECT state FROM games WHERE code=?').get(g.code);
  f.store.sqlite.prepare('UPDATE commander_decks SET baseline_wins=4,baseline_plays=4 WHERE id=?').run(old.id);
  mergeResolvedCommander(f.store.sqlite,old.id,canonical.id);
  assert.deepEqual(f.store.sqlite.prepare('SELECT state FROM games WHERE code=?').get(g.code),raw);
  g=f.service.get(g.code);assert.ok(g.players.every(p=>p.deckId===canonical.id));act(f,g,{type:'finish'});
  const stats=f.service.catalog().commanders.find(c=>c.id===canonical.id)!;assert.equal(stats.wins,0);assert.equal(stats.plays,2);
  assert.equal((f.store.sqlite.prepare('SELECT baseline_wins FROM commander_decks WHERE id=?').get(canonical.id) as {baseline_wins:number}).baseline_wins,4);
  assert.ok(!f.service.catalog().commanders.some(c=>c.id===old.id));
 }finally{f.close();}
});

test('legacy wins without any game history become minimum plays and remain unassigned to players',()=>{
 const f=oldStore();try{
  f.db.prepare('INSERT INTO profiles VALUES (?,?)').run('Alice',5);f.db.prepare('INSERT INTO commanders VALUES (?,?,?,?)').run('A',5,JSON.stringify(completeCommanderMetadata({primary_name:'A'})),'rules');
  f.db.transaction(()=>{f.db.exec(fs.readFileSync('drizzle/0006_commander_history.sql','utf8'));migrateCommanderHistory(f.db);})();
  const row=f.db.prepare('SELECT baseline_wins,baseline_plays FROM commander_decks').get();assert.deepEqual(row,{baseline_wins:5,baseline_plays:5});assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM game_appearances').get() as {n:number}).n,0);
 }finally{f.close();}
});


test('approved spelling corrections carry wins forward; placeholders are removed without deleting recorded player appearances',()=>{
 const f=oldStore();try{
  for(const name of ['Alice','Bob'])f.db.prepare('INSERT INTO profiles VALUES (?,?)').run(name,name==='Bob'?5:0);
  for(const [name,wins]of [["Caeser, Legion's Emperor",5],['New Commander',0],['Ben New Commander',0],['Strobel new commander.',0]] as const)f.db.prepare('INSERT INTO commanders VALUES (?,?,?,?)').run(name,wins,JSON.stringify(completeCommanderMetadata({primary_name:name})),'rules');
  const players:Player[]=[{number:1,joined:true,name:'Alice',commander:'New Commander',life:0,poison:0,damage:[0,0],hidden:false},{number:2,joined:true,name:'Bob',commander:"Caeser, Legion's Emperor",life:40,poison:0,damage:[0,0],hidden:false}];
  const game:Game={code:'ABC234',round:1,revision:0,status:'finished',players,winner:2,settings,createdAt:'then',endedAt:'then',previousGameCode:null,nextGameCode:null,emotes:[],planeHistory:[],planeIndex:-1};
  f.db.prepare('INSERT INTO games VALUES (?,?,?,?)').run(game.code,JSON.stringify(game),0,'then');
  f.db.transaction(()=>{f.db.exec(fs.readFileSync('drizzle/0006_commander_history.sql','utf8'));migrateCommanderHistory(f.db);})();
  const rows=f.db.prepare('SELECT id,baseline_wins FROM commander_decks').all() as {id:string;baseline_wins:number}[];assert.equal(rows.length,1);assert.equal(rows[0].id,commanderDeckId(["Caesar, Legion's Emperor"]));assert.equal(rows[0].baseline_wins,4);
  assert.deepEqual(f.db.prepare('SELECT profile,deck_id,won FROM game_appearances ORDER BY seat').all(),[{profile:'Alice',deck_id:null,won:0},{profile:'Bob',deck_id:rows[0].id,won:1}]);
 }finally{f.close();}
});


test('Oracle identity unifies alternate names/printings and updates cached data without splitting statistics',async()=>{
 const f=fixture();try{
  const oracleId='11111111-1111-4111-8111-111111111111';
  const first=(await registerCommander({names:['Original name']},{store:f.store,lookup:async()=>({card:{...card('Original name'),oracleId}})})).commander;
  let g=joined(f,first.id);act(f,g,{type:'finish'});
  const second=(await registerCommander({names:['Alternate printing name']},{store:f.store,lookup:async()=>({card:{...card('Alternate printing name'),oracleId}})})).commander;
  assert.equal(second.id,first.id);assert.equal(second.plays,2);assert.equal(second.cards[0].name,'Alternate printing name');
  g=f.service.get(g.code);assert.equal(g.players[0].deckId,second.id);
 }finally{f.close();}
});

test('verified Scryfall Oracle IDs upgrade name-based legacy setups atomically without losing active seats or win floors',async()=>{
 const f=fixture();try{
  const legacy=await register(f,['Oracle upgrade']);let g=joined(f,legacy.id);f.store.sqlite.prepare('UPDATE commander_decks SET baseline_wins=3,baseline_plays=3 WHERE id=?').run(legacy.id);
  const resolved=(await registerCommander({names:['Oracle upgrade']},{store:f.store,lookup:async()=>({card:{...card('Oracle upgrade'),oracleId:'22222222-2222-4222-8222-222222222222'}})})).commander;
  assert.notEqual(resolved.id,legacy.id);assert.equal(resolved.wins,0);assert.equal(resolved.plays,0);g=f.service.get(g.code);assert.ok(g.players.every(p=>p.deckId===resolved.id));act(f,g,{type:'finish'});assert.equal(f.service.catalog().commanders.find(c=>c.id===resolved.id)!.plays,2);
 }finally{f.close();}
});

test('Scryfall details never persist; clearing temporary data keeps history and allows refetch',async()=>{const f=fixture();try{
 const setup=await register(f,['Transient card']);let g=joined(f,setup.id);g=act(f,g,{type:'counter',counter:'life',player:2,delta:-40});act(f,g,{type:'finish'});
 const saved=f.store.sqlite.prepare('SELECT cards,legacy_metadata,legacy_rules FROM commander_decks WHERE id=?').get(setup.id) as {cards:string;legacy_metadata:string;legacy_rules:string};
 assert.equal(saved.cards,'[]');assert.equal(saved.legacy_rules,'');assert.ok(!JSON.stringify(saved).includes('cards.scryfall.io'));assert.ok(!JSON.stringify(saved).includes('Rules for'));
 const shared=globalThis as typeof globalThis & {magicTemporaryCommanders:Map<string,unknown>};shared.magicTemporaryCommanders.clear();
 const restored=f.service.catalog().commanders.find(c=>c.id===setup.id)!;assert.equal(restored.cards.length,0);assert.equal(restored.plays,2);assert.equal(restored.wins,1);
 const refetched=await register(f,['Transient card']);assert.equal(refetched.id,setup.id);assert.equal(refetched.cards.length,1);assert.equal(refetched.wins,1);
}finally{f.close();}});

test('temporary-data migration clears old Scryfall responses without changing identity or statistics',async()=>{const f=fixture();try{
 const setup=await register(f,['Old snapshot']);let g=joined(f,setup.id);g=act(f,g,{type:'counter',counter:'life',player:2,delta:-40});act(f,g,{type:'finish'});
 const history=f.store.sqlite.prepare('SELECT * FROM game_appearances ORDER BY game,round,seat').all();
 f.store.sqlite.prepare('UPDATE commander_decks SET cards=?,legacy_rules=?,legacy_metadata=? WHERE id=?').run(JSON.stringify([card('Old snapshot')]),'Rules for Old snapshot',JSON.stringify({...setup.metadata,image_path:'https://cards.scryfall.io/old.jpg'}),setup.id);
 f.store.sqlite.exec(fs.readFileSync('drizzle/0007_temporary_scryfall.sql','utf8'));
 const saved=f.store.sqlite.prepare('SELECT cards,legacy_rules,legacy_metadata FROM commander_decks WHERE id=?').get(setup.id) as {cards:string;legacy_rules:string;legacy_metadata:string};
 assert.equal(saved.cards,'[]');assert.equal(saved.legacy_rules,'');assert.ok(!saved.legacy_metadata.includes('scryfall.io'));assert.equal(JSON.parse(saved.legacy_metadata).primary_name,'Old snapshot');
 assert.deepEqual(f.store.sqlite.prepare('SELECT * FROM game_appearances ORDER BY game,round,seat').all(),history);
 assert.equal(f.service.catalog().commanders.find(c=>c.id===setup.id)!.wins,1);
}finally{f.close();}});
