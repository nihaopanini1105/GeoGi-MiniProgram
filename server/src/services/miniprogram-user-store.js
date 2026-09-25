const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USER_TYPES = new Set(['customer', 'staff', 'partner']);

function dataRoot() {
  if (process.env.GEOGI_MINIPROGRAM_USER_DATA_ROOT) return process.env.GEOGI_MINIPROGRAM_USER_DATA_ROOT;
  if (process.env.GEOGI_PAYMENT_DATA_ROOT) {
    return path.join(path.dirname(process.env.GEOGI_PAYMENT_DATA_ROOT), 'miniprogram-users');
  }
  return path.join(__dirname, '../../data/miniprogram-users');
}

function usersPath() { return path.join(dataRoot(), 'users.json'); }

async function ensureRoot() {
  await fs.promises.mkdir(dataRoot(), { recursive: true, mode: 0o700 });
  await fs.promises.chmod(dataRoot(), 0o700);
}

async function readUsers() {
  try {
    const raw = await fs.promises.readFile(usersPath(), 'utf8');
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

let mutationQueue = Promise.resolve();

async function mutateUsers(mutator) {
  const run = mutationQueue.catch(() => undefined).then(async () => {
    const current = await readUsers();
    const result = await mutator(current);
    if (!result || typeof result !== 'object' || !Object.prototype.hasOwnProperty.call(result, 'value')) {
      throw new Error('MINIPROGRAM_USER_MUTATION_RESULT_INVALID');
    }
    if (result.write !== false) {
      await ensureRoot();
      const filePath = usersPath();
      const temp = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
      await fs.promises.writeFile(temp, JSON.stringify(result.next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      await fs.promises.rename(temp, filePath);
      await fs.promises.chmod(filePath, 0o600);
    }
    return result.value;
  });
  mutationQueue = run;
  return run;
}

function clean(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function normalizePhone(value) {
  const raw = clean(value, 40).replace(/[\s-]/g, '');
  return raw;
}

function userIdForPhone(phoneNumber) {
  const phone = normalizePhone(phoneNumber);
  if (!phone) throw new Error('MINIPROGRAM_USER_PHONE_REQUIRED');
  return 'mpu_' + crypto.createHash('sha256').update(phone, 'utf8').digest('hex').slice(0, 20);
}

function publicAdminUser(row) {
  return {
    userId: row.userId,
    phoneNumber: row.phoneNumber,
    purePhoneNumber: row.purePhoneNumber || row.phoneNumber,
    countryCode: row.countryCode || '',
    displayName: row.displayName || '',
    userType: USER_TYPES.has(row.userType) ? row.userType : 'customer',
    verified: row.verified === true,
    verificationSource: row.verificationSource || 'wechat_phone_authorization',
    firstAuthorizedAt: row.firstAuthorizedAt || '',
    lastAuthorizedAt: row.lastAuthorizedAt || '',
    authorizationCount: Number(row.authorizationCount || 0),
    notes: row.notes || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  };
}

async function listMiniProgramUsers() {
  return (await readUsers()).map(publicAdminUser);
}

async function findMiniProgramUserByPhone(phoneNumber) {
  const phone = normalizePhone(phoneNumber);
  if (!phone) return null;
  const rows = await readUsers();
  const row = rows.find((item) => normalizePhone(item.phoneNumber) === phone);
  return row ? publicAdminUser(row) : null;
}

async function findMiniProgramUserById(userId) {
  const id = clean(userId, 80);
  if (!id) return null;
  const rows = await readUsers();
  const row = rows.find((item) => item.userId === id);
  return row ? publicAdminUser(row) : null;
}

async function recordPhoneAuthorization({
  phoneNumber,
  purePhoneNumber = '',
  countryCode = '',
  authorizedAt = '',
  verificationSource = 'wechat_phone_authorization'
} = {}) {
  const phone = normalizePhone(phoneNumber);
  if (!phone) throw new Error('MINIPROGRAM_USER_PHONE_REQUIRED');
  const at = clean(authorizedAt, 80) || new Date().toISOString();
  const id = userIdForPhone(phone);
  return mutateUsers(async (current) => {
    const rows = Array.isArray(current) ? current.slice() : [];
    const index = rows.findIndex((item) => item.userId === id || normalizePhone(item.phoneNumber) === phone);
    const existing = index >= 0 ? rows[index] : null;
    const now = new Date().toISOString();
    const row = {
      userId: existing && existing.userId || id,
      phoneNumber: phone,
      purePhoneNumber: normalizePhone(purePhoneNumber) || existing && existing.purePhoneNumber || phone,
      countryCode: clean(countryCode !== undefined ? countryCode : existing && existing.countryCode, 16),
      displayName: clean(existing && existing.displayName, 120),
      userType: USER_TYPES.has(existing && existing.userType) ? existing.userType : 'customer',
      verified: true,
      verificationSource: clean(verificationSource || existing && existing.verificationSource, 80) || 'wechat_phone_authorization',
      firstAuthorizedAt: existing && existing.firstAuthorizedAt || at,
      lastAuthorizedAt: at,
      authorizationCount: Number(existing && existing.authorizationCount || 0) + 1,
      notes: clean(existing && existing.notes, 1000),
      createdAt: existing && existing.createdAt || now,
      updatedAt: now
    };
    if (index >= 0) rows[index] = row;
    else rows.push(row);
    return { next: rows, value: publicAdminUser(row) };
  });
}

async function ensureHistoricalAuthorizedUser({
  phoneNumber,
  authorizedAt = '',
  displayName = ''
} = {}) {
  const phone = normalizePhone(phoneNumber);
  if (!phone) return null;
  const existing = await findMiniProgramUserByPhone(phone);
  if (existing) return existing;
  const created = await recordPhoneAuthorization({
    phoneNumber: phone,
    purePhoneNumber: phone,
    authorizedAt: authorizedAt || new Date().toISOString(),
    verificationSource: 'historical_wechat_session_order'
  });
  if (displayName) {
    return updateMiniProgramUser({
      userId: created.userId,
      displayName
    });
  }
  return created;
}

async function updateMiniProgramUser(input = {}) {
  const userId = clean(input.userId, 80);
  if (!userId) throw new Error('MINIPROGRAM_USER_ID_REQUIRED');
  return mutateUsers(async (current) => {
    const rows = Array.isArray(current) ? current.slice() : [];
    const index = rows.findIndex((item) => item.userId === userId);
    if (index < 0) throw new Error('MINIPROGRAM_USER_NOT_FOUND');
    const existing = rows[index];
    const userType = input.userType === undefined ? existing.userType : clean(input.userType, 40);
    if (!USER_TYPES.has(userType)) throw new Error('MINIPROGRAM_USER_TYPE_INVALID');
    const row = {
      ...existing,
      displayName: input.displayName === undefined ? existing.displayName : clean(input.displayName, 120),
      userType,
      notes: input.notes === undefined ? existing.notes : clean(input.notes, 1000),
      updatedAt: new Date().toISOString()
    };
    rows[index] = row;
    return { next: rows, value: publicAdminUser(row) };
  });
}

module.exports = {
  USER_TYPES,
  userIdForPhone,
  normalizePhone,
  listMiniProgramUsers,
  findMiniProgramUserByPhone,
  findMiniProgramUserById,
  recordPhoneAuthorization,
  ensureHistoricalAuthorizedUser,
  updateMiniProgramUser
};
