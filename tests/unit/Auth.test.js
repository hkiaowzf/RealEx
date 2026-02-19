import { beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../../src/utils/Auth.js';

describe('Auth', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('registers user with email + code and creates unique id format', () => {
    const req = Auth.requestCode('user@example.com', 'register');
    expect(req.ok).toBe(true);
    const reg = Auth.register('user@example.com', req.code);
    expect(reg.ok).toBe(true);
    expect(reg.user.email).toBe('user@example.com');
    expect(reg.user.id).toMatch(/^\d{6}[A-Z]{2}$/);
    expect(Auth.getCurrentUser()?.id).toBe(reg.user.id);
  });

  it('fails register when email already exists', () => {
    const req1 = Auth.requestCode('dupe@example.com', 'register');
    Auth.register('dupe@example.com', req1.code);
    const req2 = Auth.requestCode('dupe@example.com', 'register');
    expect(req2.ok).toBe(false);
  });

  it('logs in with email + code', () => {
    const reqReg = Auth.requestCode('login@example.com', 'register');
    const reg = Auth.register('login@example.com', reqReg.code);
    expect(reg.ok).toBe(true);
    Auth.logout();

    const reqLogin = Auth.requestCode('login@example.com', 'login');
    expect(reqLogin.ok).toBe(true);
    const login = Auth.login('login@example.com', reqLogin.code);
    expect(login.ok).toBe(true);
    expect(Auth.getCurrentUser()?.email).toBe('login@example.com');
  });

  it('rebinds email by user id + code', () => {
    const reqReg = Auth.requestCode('old@example.com', 'register');
    const reg = Auth.register('old@example.com', reqReg.code);
    expect(reg.ok).toBe(true);

    const reqRebind = Auth.requestCode('new@example.com', 'rebind', reg.user.id);
    expect(reqRebind.ok).toBe(true);
    const rebind = Auth.rebindEmail(reg.user.id, 'new@example.com', reqRebind.code);
    expect(rebind.ok).toBe(true);
    expect(rebind.user.email).toBe('new@example.com');
    expect(Auth.getCurrentUser()?.email).toBe('new@example.com');
  });

  it('supports requesting rebind code directly by user id', () => {
    const reqReg = Auth.requestCode('id-old@example.com', 'register');
    const reg = Auth.register('id-old@example.com', reqReg.code);
    expect(reg.ok).toBe(true);

    const reqRebind = Auth.requestRebindCodeByUserId(reg.user.id, 'id-new@example.com');
    expect(reqRebind.ok).toBe(true);
    const rebind = Auth.rebindEmail(reg.user.id, 'id-new@example.com', reqRebind.code);
    expect(rebind.ok).toBe(true);
    expect(rebind.user.email).toBe('id-new@example.com');
  });
});
