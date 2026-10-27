import test from 'node:test';
import assert from 'node:assert/strict';
import { collectActivity, discoverRepositories } from './update-activity.mjs';
const now = new Date('2026-10-26T15:00:00Z');
const repo = (name, isPrivate = true) => ({ full_name: `owner/${name}`, private: isPrivate });
const commit = (sha, date = '2026-10-26T10:00:00Z') => ({ sha, commit: { committer: { date }, message: 'PRIVATE_MESSAGE' } });
const ok = items => ({ ok: true, json: async () => items });
test('discovers with both tokens, paginates repositories, excludes public repos, deduplicates overlap', async () => {
  const calls = [];
  const repos = await discoverRepositories(['FIRST', 'SECOND'], async (url, options) => {
    const token = options.headers.Authorization;
    const page = url.searchParams.get('page');
    calls.push([token, page]);
    assert.equal(url.pathname, '/user/repos');
    assert.equal(url.searchParams.get('visibility'), 'private');
    if (token === 'Bearer FIRST' && page === '1') return ok(Array.from({ length: 100 }, (_, i) => repo(`r${i}`)));
    if (token === 'Bearer FIRST') return ok([repo('public', false)]);
    return ok([repo('r0'), repo('second')]);
  });
  assert.equal(repos.length, 101);
  assert.deepEqual(calls, [['Bearer FIRST', '1'], ['Bearer FIRST', '2'], ['Bearer SECOND', '1']]);
  assert.equal(repos.find(x => x.repo === 'owner/second').token, 'SECOND');
});
test('aggregates both tokens, paginates commits, deduplicates shared hashes, keeps data private', async () => {
  const commitRequests = [];
  const data = await collectActivity({ tokens: ['FIRST', 'SECOND'], now, fetcher: async (url, options) => {
    const token = options.headers.Authorization;
    if (url.pathname === '/user/repos') return ok(token === 'Bearer FIRST' ? [repo('one')] : [repo('one'), repo('two'), repo('public', false)]);
    commitRequests.push([url.pathname, url.searchParams.get('page'), token]);
    if (url.pathname.endsWith('/one/commits')) return ok(url.searchParams.get('page') === '1' ? Array.from({length:100}, (_,i) => commit(String(i))) : [commit('old','2020-01-01T00:00:00Z')]);
    assert.equal(token, 'Bearer SECOND');
    return ok([commit('0'), commit('new','2026-10-25T23:30:00-04:00')]);
  } });
  assert.equal(commitRequests.length, 3);
  assert.equal(data.counts['2026-10-26'], 101);
  assert.equal(Object.keys(data.counts).length, 365);
  for (const value of ['FIRST', 'SECOND', 'PRIVATE_MESSAGE', 'owner', 'sha']) assert.ok(!JSON.stringify(data).includes(value));
});
test('either token alone works and empty repositories contribute zero', async () => {
  const data = await collectActivity({tokens:['SECOND'], now, fetcher: async url => url.pathname === '/user/repos' ? ok([repo('empty')]) : {ok:false,status:409,json:async()=>({message:'Git Repository is empty.'})}});
  assert.equal(data.available, true);
  assert.equal(Object.values(data.counts).reduce((a,b)=>a+b,0), 0);
});
test('invalid second token fails the whole refresh', async () => {
  await assert.rejects(collectActivity({tokens:['FIRST','BAD'],now,fetcher:async (_url, options)=>options.headers.Authorization==='Bearer BAD'?{ok:false,status:401}:ok([])}), /HTTP 401/);
});
test('commit permission errors and nonempty conflicts stop refresh', async () => {
  for(const status of [403,409]) await assert.rejects(collectActivity({tokens:['FIRST'],now,fetcher:async url=>url.pathname==='/user/repos'?ok([repo('one')]):{ok:false,status,json:async()=>({message:'Other conflict'})}}), new RegExp(`HTTP ${status}`));
});
