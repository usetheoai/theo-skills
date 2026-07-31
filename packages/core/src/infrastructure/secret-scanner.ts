import { extname } from 'node:path';

import { lintSource } from '@secretlint/core';
import { rules as presetRecommendRules } from '@secretlint/secretlint-rule-preset-recommend';
import type { SecretLintCoreConfig } from '@secretlint/types';

import {
  type PayloadFile,
  type SecretFinding,
  type SecretScanner,
} from '../index.js';

// @secretlint/core expects flat rule descriptors `{ id, rule: <creator> }` in
// config.rules (preset expansion is the config-loader's job, which we bypass).
// The preset exposes its rule creators in `rules`; wrap each as a descriptor.
// One contained cast (not `any`) — the structure is correct at runtime.
const presetRules = presetRecommendRules as readonly { meta: { id: string } }[];
const config = {
  rules: presetRules.map((rule) => ({ id: rule.meta.id, rule })),
} as unknown as SecretLintCoreConfig;

/**
 * secretlint-backed SecretScanner. Scans each extracted text file in-memory
 * (no disk write, no physical file path) using the curated preset-recommend
 * ruleset. Returns only the rule id + file — the raw secret value is never
 * carried (security + Unbreakable Rule 8). `maskSecrets` is on as defence in depth.
 */
export function createSecretlintScanner(): SecretScanner {
  return {
    async scan(files: readonly PayloadFile[]): Promise<readonly SecretFinding[]> {
      const findings: SecretFinding[] = [];
      for (const file of files) {
        const result = await lintSource({
          source: {
            filePath: file.path,
            content: file.content,
            ext: extname(file.path),
            contentType: 'text',
          },
          options: { config, maskSecrets: true, noPhysicFilePath: true },
        });
        for (const message of result.messages) {
          findings.push({ file: file.path, type: message.ruleId });
        }
      }
      return findings;
    },
  };
}
