import { createRemoteSkillsManager } from '@usetheo/skills-sdk';
const m = createRemoteSkillsManager({
  client: { retrieve: async () => { throw new Error('ECONNREFUSED'); } },
  localFallback: [{ name: 'local', description: 'do disco', instructions: 'x' }],
});
const t0 = Date.now();
const r = await m.resolve('qualquer intencao', 5);
console.log(JSON.stringify({ ms: Date.now()-t0, usedFallback: m.usedFallback, n: r.length, nome: r[0]?.name }));
