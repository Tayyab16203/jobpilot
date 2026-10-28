import assert from 'node:assert/strict';
import { isGoogleSignInLabel, signedInUrl } from '../src/agent/browser.js';

assert.equal(isGoogleSignInLabel('Sign in with Google'), true);
assert.equal(isGoogleSignInLabel('Continue with Google'), true);
assert.equal(isGoogleSignInLabel('Sign up with Google'), true);
assert.equal(isGoogleSignInLabel('Google'), false);
assert.equal(signedInUrl('x', 'https://x.com/home'), true);
assert.equal(signedInUrl('x', 'https://x.com/i/flow/login'), false);
assert.equal(signedInUrl('gmail', 'https://mail.google.com/mail/u/0/#inbox'), true);
assert.equal(signedInUrl('gmail', 'https://accounts.google.com/signin'), false);
assert.equal(signedInUrl('linkedin', 'https://www.linkedin.com/feed/'), true);
console.log('ok');
