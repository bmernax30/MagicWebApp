import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { applyTestSchema } from './schema-fixture';
import { importMagic } from '../src/db/import';
import { readSeed,syncSeed } from '../src/db/seed-sync';
function fixture(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');applyTestSchema(db);importMagic(db,path.resolve('seed-data/res'));return db;}
test('seed sync preserves web decks and games, reconciles legacy deltas once, and never recreates assignments',()=>{
 const db=fixture();try{
  const baseline=readSeed('seed-data/res/settings.json'),next=structuredClone(baseline);
  const player=Object.keys(baseline.player_profiles)[0],name=Object.keys(baseline.commander_profiles)[0];
  const alias=db.prepare('SELECT deck_id FROM commander_aliases WHERE name=?').get(name) as {deck_id:string};
  const before=db.prepare('SELECT baseline_wins FROM commander_decks WHERE id=?').get(alias.deck_id) as {baseline_wins:number};
  next.player_profile_wins[player]+=3;next.commander_profiles[name].total_wins=Number(next.commander_profiles[name].total_wins)+2;
  next.commander_profiles[name].attack_power=77;next.commander_profiles.New={...next.commander_profiles[name],primary_name:'New',total_wins:0};next.player_profiles[player]=['New'];
  db.prepare('INSERT INTO commander_decks(id,name,cards,legacy_metadata,baseline_wins,baseline_plays) VALUES (?,?,?,?,?,?)').run('web','Web only','[]','{}',7,7);
  db.prepare('INSERT INTO games VALUES (?,?,?,?)').run('ABC234','{"unchanged":true}',25,'before');
  const report=syncSeed(db,next);assert.ok(report.addedCommanders.includes('New'));assert.equal(report.addedLinks,0);assert.equal(report.removedLinks,0);
  assert.equal((db.prepare('SELECT baseline_wins FROM commander_decks WHERE id=?').get(alias.deck_id) as {baseline_wins:number}).baseline_wins,before.baseline_wins+2);
  assert.ok(db.prepare("SELECT 1 FROM commander_decks WHERE id='web'").get());
  assert.equal((db.prepare('SELECT state FROM games').get() as {state:string}).state,'{"unchanged":true}');
  assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='profile_commanders'").get());
  assert.equal(syncSeed(db,next).winDelta,0);
 }finally{db.close();}
});
test('first seed sync requires an explicit prior baseline',()=>{const db=fixture();try{const baseline=readSeed('seed-data/res/settings.json');db.prepare("DELETE FROM settings WHERE key='seed_sync_baseline'").run();assert.throws(()=>syncSeed(db,baseline),/requires/);assert.equal(syncSeed(db,baseline,baseline).winDelta,0);}finally{db.close();}});
test('unsafe legacy win reductions roll back both archive and history floors',()=>{
 const db=fixture();try{const baseline=readSeed('seed-data/res/settings.json'),next=structuredClone(baseline);const name=Object.keys(baseline.commander_profiles)[0];const snapshot=db.prepare('SELECT * FROM commander_decks ORDER BY id').all();next.commander_profiles[name].total_wins=-1000;assert.throws(()=>syncSeed(db,next),/Unsafe win/);assert.deepEqual(db.prepare('SELECT * FROM commander_decks ORDER BY id').all(),snapshot);assert.equal(syncSeed(db,baseline).winDelta,0);}finally{db.close();}
});
