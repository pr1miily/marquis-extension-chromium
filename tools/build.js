#!/usr/bin/env node
// Builds the store packages from this one source tree. No dependencies (Node 22+).
//   node tools/build.js            -> both targets
//   node tools/build.js firefox    -> one target (chrome | firefox)
// Output (gitignored):
//   dist/chrome/    unpacked Chromium build: the root manifest.json, unchanged
//   dist/firefox/   unpacked Firefox build: platform/firefox/manifest.json + platform/firefox/*.js
//   dist/marquis-<target>-<version>.zip   store upload; same input -> byte-identical zip
// The Firefox manifest takes its "version" from the root manifest, so both builds always ship the same version.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SHARED_DIRS = ['scripts', 'styles', 'img'];
const SHARED_ROOT_FILE = /^(.+\.(html|js)|THIRD_PARTY_NOTICES\.md|PRIVACY\.md)$/;

function walk(rel) {
    return fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap(e => {
        const child = `${rel}/${e.name}`;
        return e.isDirectory() ? walk(child) : [child];
    });
}

function sharedFiles() {
    const rootFiles = fs.readdirSync(ROOT, { withFileTypes: true })
        .filter(e => e.isFile() && SHARED_ROOT_FILE.test(e.name)).map(e => e.name);
    return [...rootFiles, ...SHARED_DIRS.flatMap(walk)];
}

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

function targetFiles(target, version) {
    const files = new Map(sharedFiles().map(f => [f, fs.readFileSync(path.join(ROOT, f))]));
    let manifest = readJson('manifest.json');
    if (target === 'firefox') {
        for (const f of walk('platform/firefox')) {
            if (f !== 'platform/firefox/manifest.json') files.set(f, fs.readFileSync(path.join(ROOT, f)));
        }
        manifest = { ...readJson('platform/firefox/manifest.json'), version };
        const missing = manifest.background.scripts.filter(s => !files.has(s));
        if (missing.length) throw new Error(`Firefox background scripts not in the build: ${missing.join(', ')}`);
        // Firefox's event page cannot importScripts: every file background.js imports must be listed instead.
        const imported = [...files.get('background.js').toString().matchAll(/importScripts\(([^)]*)\)/g)]
            .flatMap(m => [...m[1].matchAll(/['"]\/?([^'"]+)['"]/g)].map(s => s[1]));
        const unlisted = imported.filter(s => !manifest.background.scripts.includes(s));
        if (unlisted.length) throw new Error(`Add to background.scripts in platform/firefox/manifest.json: ${unlisted.join(', ')}`);
    }
    files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    return files;
}

// Minimal ZIP writer (deflate, UTF-8 names, fixed 1980-01-01 timestamps so the output is reproducible).
function zip(files) {
    const local = [], central = [];
    let offset = 0;
    for (const name of [...files.keys()].sort()) {
        const data = files.get(name);
        const packed = zlib.deflateRawSync(data, { level: 9 });
        if (!zlib.inflateRawSync(packed).equals(data)) throw new Error(`Compression check failed for ${name}`);
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = zlib.crc32(data);
        const head = Buffer.alloc(30);
        head.writeUInt32LE(0x04034b50, 0);
        head.writeUInt16LE(20, 4);            // version needed
        head.writeUInt16LE(0x0800, 6);        // UTF-8 file name
        head.writeUInt16LE(8, 8);             // deflate
        head.writeUInt16LE(0, 10);            // time 00:00
        head.writeUInt16LE(0x21, 12);         // date 1980-01-01
        head.writeUInt32LE(crc, 14);
        head.writeUInt32LE(packed.length, 18);
        head.writeUInt32LE(data.length, 22);
        head.writeUInt16LE(nameBuf.length, 26);
        const dir = Buffer.alloc(46);
        dir.writeUInt32LE(0x02014b50, 0);
        dir.writeUInt16LE(20, 4);             // made by
        head.copy(dir, 6, 4, 30);             // version needed .. name length
        dir.writeUInt32LE(offset, 42);
        local.push(head, nameBuf, packed);
        central.push(dir, nameBuf);
        offset += head.length + nameBuf.length + packed.length;
    }
    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.size, 8);
    end.writeUInt16LE(files.size, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, centralBuf, end]);
}

function build(target) {
    const { version } = readJson('manifest.json');
    const files = targetFiles(target, version);
    const outDir = path.join(DIST, target);
    fs.rmSync(outDir, { recursive: true, force: true });
    for (const [name, data] of files) {
        fs.mkdirSync(path.dirname(path.join(outDir, name)), { recursive: true });
        fs.writeFileSync(path.join(outDir, name), data);
    }
    const zipPath = path.join(DIST, `marquis-${target}-${version}.zip`);
    fs.writeFileSync(zipPath, zip(files));
    console.log(`${target}: ${files.size} files -> ${path.relative(ROOT, outDir)}/ and ${path.relative(ROOT, zipPath)}`);
}

const targets = process.argv.slice(2);
for (const t of targets.length ? targets : ['chrome', 'firefox']) {
    if (!['chrome', 'firefox'].includes(t)) throw new Error(`Unknown target "${t}" (chrome | firefox)`);
    build(t);
}
