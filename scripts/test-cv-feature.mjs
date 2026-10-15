// Lightweight regression checks for CV-grounded scoring and the approval gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assessJob, ensureTailoredCv, selectCvVariant } from '../src/cv.js';

const profile = {
  skills: ['AWS', 'Terraform'],
  summary: 'Cloud infrastructure operations',
  preferences: { roles: ['Cloud Engineer'], allowTailoredCv: false },
};

const aligned = assessJob({ role: 'Cloud Engineer', description: 'AWS Terraform Kubernetes' }, profile);
assert.equal(aligned.roleAligned, true);
assert.equal(aligned.driftPercent, 13);
assert.deepEqual(aligned.missingTerms, ['kubernetes']);
assert.equal(aligned.tailoredEligible, true);

const outside = assessJob({ role: 'Frontend Developer', description: 'React TypeScript' }, profile);
assert.equal(outside.roleAligned, false);
assert.equal(outside.tailoredEligible, false);
assert.equal(assessJob({ role: 'AI Platform Engineer', description: 'Kubernetes' }, profile).roleAligned, false);

const gated = ensureTailoredCv({ role: 'Cloud Engineer', description: 'AWS Terraform Kubernetes' }, profile);
assert.equal(gated.generated, false);
assert.equal(gated.path, '');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-cv-'));
try {
  const variant = (id, focuses, keywords) => {
    const file = path.join(tmp, `${id}.pdf`); fs.writeFileSync(file, '%PDF-test');
    return { id, label: id, path: file, focuses, keywords };
  };
  const variants = {
    ...profile,
    cvPath: path.join(tmp, 'main.pdf'),
    preferences: {
      ...profile.preferences,
      cvVariants: [
        variant('main', ['general'], ['platform', 'kubernetes']),
        variant('aws', ['aws'], ['aws', 'eks', 's3']),
        variant('sre', ['sre'], ['sre', 'slo', 'observability']),
      ],
    },
  };
  fs.writeFileSync(variants.cvPath, '%PDF-main');
  assert.equal(selectCvVariant({ role: 'Cloud Engineer', description: 'AWS EKS Terraform' }, variants).id, 'aws');
  assert.equal(selectCvVariant({ role: 'Site Reliability Engineer', description: 'SLO observability' }, variants).id, 'sre');
  assert.equal(selectCvVariant({ role: 'Platform Engineer', description: 'Kubernetes Terraform' }, variants).id, 'main');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('cv feature checks passed');
