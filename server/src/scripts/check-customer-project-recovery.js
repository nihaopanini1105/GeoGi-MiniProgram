'use strict';

const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../services/customer-portal.js');
const text = fs.readFileSync(file, 'utf8');

function assert(condition, code) {
  if (!condition) {
    console.error(code);
    process.exit(1);
  }
}

assert(!text.includes("if (!cleanClientId) return fail('缺少客户编号')"), 'CLIENT_ID_STILL_REQUIRED_FOR_PROJECT_LIST');
assert(text.includes('const phone = normalizePhone(customer && customer.phoneNumber);'), 'AUTH_PHONE_NOT_USED');
assert(text.includes('const ownedClientIds = Array.from(new Set('), 'OWNED_CLIENT_RECOVERY_MISSING');
assert(text.includes("clientId: cleanClientId || ownedClientIds[0] || ''"), 'RECOVERED_CLIENT_ID_NOT_RETURNED');
assert(text.includes('clientIds: ownedClientIds'), 'OWNED_CLIENT_IDS_NOT_RETURNED');

console.log('CUSTOMER_PROJECT_PHONE_RECOVERY_OK=True');
