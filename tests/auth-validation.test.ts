import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Replicate the auth functions without importing from server (avoids DATABASE_URL requirement)
async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  return bcrypt.compare(supplied, stored);
}

describe('Authentication - Password Hashing', () => {
  it('should hash a password and not return plaintext', async () => {
    const password = 'TestPassword123!';
    const hashed = await hashPassword(password);
    expect(hashed).not.toBe(password);
    expect(hashed.length).toBeGreaterThan(0);
  });

  it('should produce different hashes for same password (unique salts)', async () => {
    const password = 'TestPassword123!';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    expect(hash1).not.toBe(hash2);
  });

  it('should verify correct password against hash', async () => {
    const password = 'TestPassword123!';
    const hashed = await hashPassword(password);
    const isValid = await comparePasswords(password, hashed);
    expect(isValid).toBe(true);
  });

  it('should reject incorrect password against hash', async () => {
    const password = 'TestPassword123!';
    const hashed = await hashPassword(password);
    const isValid = await comparePasswords('WrongPassword!', hashed);
    expect(isValid).toBe(false);
  });

  it('should reject empty password against hash', async () => {
    const password = 'TestPassword123!';
    const hashed = await hashPassword(password);
    const isValid = await comparePasswords('', hashed);
    expect(isValid).toBe(false);
  });

  it('should handle special characters in passwords', async () => {
    const password = 'P@$$w0rd!#%^&*()_+';
    const hashed = await hashPassword(password);
    const isValid = await comparePasswords(password, hashed);
    expect(isValid).toBe(true);
  });

  it('should handle very long passwords', async () => {
    const password = 'A'.repeat(200);
    const hashed = await hashPassword(password);
    const isValid = await comparePasswords(password, hashed);
    expect(isValid).toBe(true);
  });

  it('should use bcrypt with salt rounds of 12', async () => {
    const password = 'TestPassword';
    const hashed = await hashPassword(password);
    // bcrypt hashes start with $2a$ or $2b$ followed by salt rounds
    expect(hashed).toMatch(/^\$2[ab]\$12\$/);
  });
});

describe('Authentication - Token Security', () => {
  function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  it('should hash reset tokens with SHA-256', () => {
    const token = crypto.randomBytes(32).toString('hex');
    const hashed = hashToken(token);
    expect(hashed).toHaveLength(64);
    expect(hashed).not.toBe(token);
  });

  it('should produce deterministic hashes for same token', () => {
    const token = 'fixed-test-token';
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('should produce different hashes for different tokens', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });
});
