/**
 * Give the iOS app the version in package.json, as the Android build does.
 *
 * Android reads package.json itself (android/app/build.gradle): versionName is
 * the version, versionCode is major*10000 + minor*100 + patch. Xcode cannot, so
 * this writes the same two numbers into the project as MARKETING_VERSION and
 * CURRENT_PROJECT_VERSION, which Info.plist reads. Before 2026-10-09 the iOS
 * project stayed at 1.0 (1) whatever package.json said. Run by
 * `npm run build:native`.
 */
import { readFileSync, writeFileSync } from 'fs';

const PBXPROJ = 'ios/App/App.xcodeproj/project.pbxproj';
const version: string = JSON.parse(readFileSync('package.json', 'utf8')).version;
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!m) throw new Error(`package.json version "${version}" is not major.minor.patch`);
const build = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);

const before = readFileSync(PBXPROJ, 'utf8');
const after = before
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
if (after !== before) writeFileSync(PBXPROJ, after);
console.log(`iOS version ${version} (${build})`);
