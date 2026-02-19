const USERS_KEY = 'expogrid_auth_users';
const SESSION_KEY = 'expogrid_auth_session';
const CODES_KEY = 'expogrid_auth_codes';
const CODE_TTL_MS = 5 * 60 * 1000;

function now() {
  return Date.now();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadUsers() {
  const state = readJson(USERS_KEY, { byId: {}, byEmail: {} });
  if (!state.byId || typeof state.byId !== 'object') state.byId = {};
  if (!state.byEmail || typeof state.byEmail !== 'object') state.byEmail = {};
  return state;
}

function saveUsers(state) {
  writeJson(USERS_KEY, state);
}

function loadCodes() {
  const state = readJson(CODES_KEY, {});
  return state && typeof state === 'object' ? state : {};
}

function saveCodes(state) {
  writeJson(CODES_KEY, state);
}

function loadSession() {
  const state = readJson(SESSION_KEY, null);
  return state && typeof state === 'object' ? state : null;
}

function saveSession(session) {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  writeJson(SESSION_KEY, session);
}

function randomDigits(len) {
  let out = '';
  for (let i = 0; i < len; i++) out += String(Math.floor(Math.random() * 10));
  return out;
}

function randomLetters(len) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function generateUserId(existingById) {
  for (let i = 0; i < 100000; i++) {
    const id = `${randomDigits(6)}${randomLetters(2)}`;
    if (!existingById[id]) return id;
  }
  throw new Error('User id generation exhausted');
}

function cleanupExpiredCodes(codes) {
  const t = now();
  Object.keys(codes).forEach(email => {
    if (!codes[email] || Number(codes[email].expiresAt || 0) <= t) {
      delete codes[email];
    }
  });
  return codes;
}

export class Auth {
  static getCurrentUser() {
    const session = loadSession();
    if (!session?.userId) return null;
    const users = loadUsers();
    const user = users.byId?.[session.userId];
    if (!user) return null;
    return { ...user };
  }

  static logout() {
    saveSession(null);
    return { ok: true };
  }

  static requestCode(email, purpose = 'login', targetUserId = '') {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      return { ok: false, message: '邮箱格式不正确' };
    }
    const users = loadUsers();
    const existingId = users.byEmail?.[normalized];
    if (purpose === 'register' && existingId) {
      return { ok: false, message: '该邮箱已注册，请直接登录' };
    }
    if (purpose === 'login' && !existingId) {
      return { ok: false, message: '该邮箱未注册，请先注册' };
    }
    if (purpose === 'rebind' && existingId) {
      return { ok: false, message: '该邮箱已被占用' };
    }
    const code = randomDigits(6);
    const expiresAt = now() + CODE_TTL_MS;
    const codes = cleanupExpiredCodes(loadCodes());
    codes[normalized] = {
      email: normalized,
      code,
      purpose,
      targetUserId: targetUserId || '',
      expiresAt,
      sentAt: now()
    };
    saveCodes(codes);
    return { ok: true, code, expiresAt };
  }

  static requestRebindCodeByUserId(userId, newEmail) {
    const id = String(userId || '').trim().toUpperCase();
    if (!/^\d{6}[A-Z]{2}$/.test(id)) {
      return { ok: false, message: '用户ID格式不正确' };
    }
    const users = loadUsers();
    if (!users.byId?.[id]) {
      return { ok: false, message: '用户不存在' };
    }
    return Auth.requestCode(newEmail, 'rebind', id);
  }

  static register(email, code) {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) return { ok: false, message: '邮箱格式不正确' };
    const users = loadUsers();
    if (users.byEmail?.[normalized]) {
      return { ok: false, message: '该邮箱已注册，请直接登录' };
    }
    const check = Auth._consumeCode(normalized, code, 'register');
    if (!check.ok) return check;

    const id = generateUserId(users.byId || {});
    const user = {
      id,
      email: normalized,
      createdAt: now(),
      updatedAt: now()
    };
    users.byId[id] = user;
    users.byEmail[normalized] = id;
    saveUsers(users);
    saveSession({ userId: id, email: normalized, signedAt: now() });
    return { ok: true, user: { ...user } };
  }

  static login(email, code) {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) return { ok: false, message: '邮箱格式不正确' };
    const users = loadUsers();
    const userId = users.byEmail?.[normalized];
    if (!userId) return { ok: false, message: '该邮箱未注册，请先注册' };
    const check = Auth._consumeCode(normalized, code, 'login');
    if (!check.ok) return check;
    const user = users.byId?.[userId];
    if (!user) return { ok: false, message: '账号数据异常，请重新注册' };
    saveSession({ userId: user.id, email: user.email, signedAt: now() });
    return { ok: true, user: { ...user } };
  }

  static rebindEmail(userId, newEmail, code) {
    const normalized = normalizeEmail(newEmail);
    if (!userId) return { ok: false, message: '请先登录' };
    if (!isValidEmail(normalized)) return { ok: false, message: '邮箱格式不正确' };

    const users = loadUsers();
    const user = users.byId?.[userId];
    if (!user) return { ok: false, message: '用户不存在' };
    if (users.byEmail?.[normalized] && users.byEmail[normalized] !== userId) {
      return { ok: false, message: '该邮箱已被占用' };
    }
    const check = Auth._consumeCode(normalized, code, 'rebind', userId);
    if (!check.ok) return check;

    const prevEmail = normalizeEmail(user.email);
    if (prevEmail && users.byEmail?.[prevEmail] === userId) {
      delete users.byEmail[prevEmail];
    }
    user.email = normalized;
    user.updatedAt = now();
    users.byId[userId] = user;
    users.byEmail[normalized] = userId;
    saveUsers(users);
    saveSession({ userId, email: normalized, signedAt: now() });
    return { ok: true, user: { ...user } };
  }

  static _consumeCode(email, code, purpose, targetUserId = '') {
    const normalized = normalizeEmail(email);
    const codes = cleanupExpiredCodes(loadCodes());
    const entry = codes[normalized];
    if (!entry || entry.purpose !== purpose) {
      saveCodes(codes);
      return { ok: false, message: '请先获取验证码' };
    }
    if (purpose === 'rebind' && String(entry.targetUserId || '') !== String(targetUserId || '')) {
      saveCodes(codes);
      return { ok: false, message: '验证码不匹配当前用户' };
    }
    if (Number(entry.expiresAt || 0) <= now()) {
      delete codes[normalized];
      saveCodes(codes);
      return { ok: false, message: '验证码已过期，请重新获取' };
    }
    if (String(entry.code || '') !== String(code || '').trim()) {
      saveCodes(codes);
      return { ok: false, message: '验证码错误' };
    }
    delete codes[normalized];
    saveCodes(codes);
    return { ok: true };
  }
}
