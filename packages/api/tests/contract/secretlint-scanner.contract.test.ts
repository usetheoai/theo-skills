import { createSecretlintScanner } from '@usetheo/skills/validators';
import { describe, expect, it } from 'vitest';


const scanner = createSecretlintScanner();

// A fake GitHub personal-access-token shape — reliably matched by the
// preset-recommend GitHub rule (NOT a real credential).
const FAKE_TOKEN = 'ghp_0123456789abcdefghij0123456789abcdAB';

describe('secretlint secret scanner', () => {
  it('flags content containing a token (>= 1 finding)', async () => {
    const findings = await scanner.scan([
      { path: 'scripts/deploy.sh', content: `export GH_TOKEN=${FAKE_TOKEN}\n` },
    ]);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0]?.file).toBe('scripts/deploy.sh');
    expect(typeof findings[0]?.type).toBe('string');
  });

  it('returns 0 findings for clean content', async () => {
    const findings = await scanner.scan([
      { path: 'SKILL.md', content: '---\nname: demo\ndescription: clean\n---\n# Hello\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('never carries the raw secret value (only file + type)', async () => {
    const findings = await scanner.scan([{ path: 'a.txt', content: `token=${FAKE_TOKEN}` }]);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    for (const f of findings) {
      expect(Object.keys(f).sort()).toEqual(['file', 'type']);
      expect(JSON.stringify(f)).not.toContain(FAKE_TOKEN);
    }
  });
});
