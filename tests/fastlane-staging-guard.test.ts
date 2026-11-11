import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Source scan of fastlane/Fastfile: both store lanes must refuse a bundle that
// points at staging (Q26/Q27). Ruby comment lines are stripped first, so a
// commented-out guard call does not count as present.

const FASTFILE_PATH = path.resolve(__dirname, '..', 'fastlane', 'Fastfile');
const raw = fs.readFileSync(FASTFILE_PATH, 'utf8');
const code = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

const IOS_MARKER = 'platform :ios do';
const ANDROID_MARKER = 'platform :android do';
const iosStart = code.indexOf(IOS_MARKER);
const androidStart = code.indexOf(ANDROID_MARKER);

const helpers = code.slice(0, Math.min(iosStart, androidStart));
const iosBlock = iosStart < androidStart ? code.slice(iosStart, androidStart) : code.slice(iosStart);
const androidBlock = androidStart > iosStart ? code.slice(androidStart) : code.slice(androidStart, iosStart);

const IOS_GUARD = 'ensure_not_staging!("ios/App/App/public", "ios")';
const ANDROID_ENV_GUARD = 'ensure_no_staging_env!("android")';
const ANDROID_BUNDLE_GUARD = 'ensure_not_staging!("android/app/src/main/assets/public", "android")';

describe('Fastfile staging guard: structure', () => {
  it('has both platform blocks (red if a marker is renamed and the split below stops being meaningful)', () => {
    expect(iosStart).toBeGreaterThan(-1);
    expect(androidStart).toBeGreaterThan(-1);
  });

  it('defines ensure_not_staging! and ensure_no_staging_env! at top level — red if either helper is removed', () => {
    expect(helpers).toContain('def ensure_not_staging!(bundle_rel, platform)');
    expect(helpers).toContain('def ensure_no_staging_env!(platform)');
  });

  it('ensure_not_staging! calls ensure_no_staging_env! and fails via UI.user_error! — red if the env check or the hard failure is dropped', () => {
    const start = helpers.indexOf('def ensure_not_staging!');
    const body = helpers.slice(start);
    expect(body).toMatch(/ensure_no_staging_env!\(platform\)/);
    expect(body).toContain('UI.user_error!');
    const envStart = helpers.indexOf('def ensure_no_staging_env!');
    const envBody = helpers.slice(envStart, helpers.indexOf('\nend', envStart));
    expect(envBody).toContain('UI.user_error!');
  });

  it('STAGING_PATTERN covers school-bus-tracker-staging and .up.railway.app — red if either alternative is dropped', () => {
    const m = code.match(/STAGING_PATTERN\s*=\s*\/(.+)\/\s*$/m);
    expect(m, 'STAGING_PATTERN regex literal not found').not.toBeNull();
    const re = new RegExp(m![1]);
    expect(re.test('https://school-bus-tracker-staging.up.railway.app')).toBe(true);
    expect(re.test('school-bus-tracker-staging')).toBe(true);
    expect(re.test('https://anything.up.railway.app')).toBe(true);
    expect(re.test('https://www.schoolbustracker.org')).toBe(false);
  });
});

describe('Fastfile staging guard: iOS lane', () => {
  it('red if the iOS guard call is removed, commented out, or moved below build_app / upload_to_testflight', () => {
    const guard = iosBlock.indexOf(IOS_GUARD);
    const build = iosBlock.indexOf('build_app(');
    const upload = iosBlock.indexOf('upload_to_testflight(');
    expect(guard, 'iOS ensure_not_staging! call missing (non-comment)').toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(-1);
    expect(guard, 'iOS guard must run before build_app(').toBeLessThan(build);
    expect(guard, 'iOS guard must run before upload_to_testflight(').toBeLessThan(upload);
  });
});

describe('Fastfile staging guard: Android lane', () => {
  it('red if the Android env guard is removed, commented out, or moved below npm run build', () => {
    const envGuard = androidBlock.indexOf(ANDROID_ENV_GUARD);
    const npmBuild = androidBlock.indexOf('npm run build');
    expect(envGuard, 'Android ensure_no_staging_env! call missing (non-comment)').toBeGreaterThan(-1);
    expect(npmBuild).toBeGreaterThan(-1);
    expect(envGuard, 'Android env guard must run before npm run build').toBeLessThan(npmBuild);
  });

  it('red if the Android bundle scan is removed, or moved above cap sync android or below gradle(', () => {
    const bundleGuard = androidBlock.indexOf(ANDROID_BUNDLE_GUARD);
    const sync = androidBlock.indexOf('cap sync android');
    const gradle = androidBlock.indexOf('gradle(');
    expect(bundleGuard, 'Android ensure_not_staging! call missing (non-comment)').toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(-1);
    expect(gradle).toBeGreaterThan(-1);
    expect(bundleGuard, 'Android bundle scan must run after cap sync android').toBeGreaterThan(sync);
    expect(bundleGuard, 'Android bundle scan must run before gradle(').toBeLessThan(gradle);
  });
});
