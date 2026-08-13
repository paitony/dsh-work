/** Regression checks for the Electron renderer navigation boundary. */

import assert from 'node:assert/strict'
import { isAllowedExternalUrl, isSameOrigin } from '../src/window-policy.ts'

assert.equal(isAllowedExternalUrl('https://github.com/deepseek-ai/deepseek-harness'), true)
assert.equal(isAllowedExternalUrl('mailto:maintainers@example.com'), true)
assert.equal(isAllowedExternalUrl('file:///etc/passwd'), false)
assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false)
assert.equal(isAllowedExternalUrl('data:text/html,<script>alert(1)</script>'), false)
assert.equal(isAllowedExternalUrl('https://'), false)

assert.equal(isSameOrigin('http://127.0.0.1:43123/settings', 'http://127.0.0.1:43123'), true)
assert.equal(isSameOrigin('http://127.0.0.1:43124/settings', 'http://127.0.0.1:43123'), false)
assert.equal(isSameOrigin('https://example.com', 'http://127.0.0.1:43123'), false)

console.log('window policy ok')
