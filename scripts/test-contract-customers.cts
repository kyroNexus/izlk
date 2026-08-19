import assert from 'node:assert/strict'
import { additionalCustomerIds } from '../src/lib/contract-customers'

assert.deepEqual(additionalCustomerIds(['primary', 'second', 'second', '', 'third'], 'primary'), ['second', 'third'])
assert.deepEqual(additionalCustomerIds([], 'primary'), [])

console.log('Contract customer checks passed: primary customer is excluded and additional customers are unique.')
