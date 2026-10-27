import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function request(url, token, fetcher) {
  return fetcher(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30000), redirect: 'error',
  });
}

export async function discoverRepositories(tokens, fetcher = fetch) {
  const repositories = new Map();
  for (const token of new Set(tokens.filter(Boolean))) {
    for (let page = 1; ; page++) {
      const url = new URL('https://api.github.com/user/repos');
      url.search = new URLSearchParams({ visibility: 'private', per_page: '100', page: String(page), sort: 'full_name', direction: 'asc' });
      const response = await request(url, token, fetcher);
      if (!response.ok) throw new Error(`Repository discovery failed (HTTP ${response.status}).`);
      const repos = await response.json();
      if (!Array.isArray(repos)) throw new Error('Invalid repository response.');
      for (const repo of repos) {
        // Fine-grained tokens also read public repositories; deliberately exclude them.
        if (repo.private !== true) continue;
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.full_name)) throw new Error('Invalid repository data.');
        const key = repo.full_name.toLowerCase();
        if (!repositories.has(key)) repositories.set(key, { repo: repo.full_name, token });
      }
      if (repos.length < 100) break;
    }
  }
  return [...repositories.values()];
}

export async function collectActivity({ tokens, now = new Date(), fetcher = fetch }) {
  const repositories = await discoverRepositories(tokens, fetcher);
  const end = new Date(now);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - 364);
  const counts = {};
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) counts[d.toISOString().slice(0, 10)] = 0;
  const seen = new Set();
  for (const { repo, token } of repositories) {
    for (let page = 1; ; page++) {
      const url = new URL(`https://api.github.com/repos/${repo}/commits`);
      url.search = new URLSearchParams({ since: start.toISOString(), until: end.toISOString(), per_page: '100', page: String(page) });
      const response = await request(url, token, fetcher);
      if (response.status === 409) {
        const body = await response.json();
        if (body.message === 'Git Repository is empty.') break;
      }
      if (!response.ok) throw new Error(`Activity request failed (HTTP ${response.status}). Check the activity secrets and repository permissions.`);
      const commits = await response.json();
      if (!Array.isArray(commits)) throw new Error('Invalid activity response.');
      for (const commit of commits) {
        const date = commit.commit?.committer?.date;
        if (!date || !commit.sha || !Number.isFinite(Date.parse(date))) throw new Error('Invalid activity commit data.');
        const day = new Date(date).toISOString().slice(0, 10);
        if (Object.hasOwn(counts, day) && !seen.has(commit.sha)) {
          counts[day]++;
          seen.add(commit.sha);
        }
      }
      if (commits.length < 100) break;
    }
  }
  return { available: true, updatedAt: end.toISOString(), counts };
}

async function main() {
  const tokens = [process.env.ACTIVITY_TOKEN, process.env.ACTIVITY_TOKEN_2].map(value => value?.trim()).filter(Boolean);
  const output = new URL('../src/data/activity.json', import.meta.url);
  if (!tokens.length) {
    await writeFile(output, JSON.stringify({ available: false, updatedAt: null, counts: {} }) + '\n');
    console.log('Activity is not configured; showing the unavailable state.');
    return;
  }
  const result = await collectActivity({ tokens });
  await writeFile(output, JSON.stringify(result) + '\n');
  console.log('Updated aggregate activity counts.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('Activity update failed. Check ACTIVITY_TOKEN, ACTIVITY_TOKEN_2, and GitHub access. No private response data was logged.');
  process.exitCode = 1;
});
