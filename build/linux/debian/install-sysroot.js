"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChromiumSysroot = exports.getVSCodeSysroot = void 0;
const child_process_1 = require("child_process");
const os_1 = require("os");
const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto_1 = require("crypto");
const ansiColors = require("ansi-colors");
// Based on https://source.chromium.org/chromium/chromium/src/+/main:build/linux/sysroot_scripts/install-sysroot.py.
const URL_PREFIX = 'https://msftelectron.blob.core.windows.net';
const URL_PATH = 'sysroots/toolchain';
const REPO_ROOT = path.dirname(path.dirname(path.dirname(__dirname)));
const ghApiHeaders = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'VSCode Build',
};
if (process.env.GITHUB_TOKEN) {
    ghApiHeaders.Authorization = 'Basic ' + Buffer.from(process.env.GITHUB_TOKEN).toString('base64');
}
const ghDownloadHeaders = {
    ...ghApiHeaders,
    Accept: 'application/octet-stream',
};
function getElectronVersion() {
    const yarnrc = fs.readFileSync(path.join(REPO_ROOT, '.yarnrc'), 'utf8');
    const electronVersion = /^target "(.*)"$/m.exec(yarnrc)[1];
    const msBuildId = /^ms_build_id "(.*)"$/m.exec(yarnrc)[1];
    return { electronVersion, msBuildId };
}
function getSha(filename) {
    const hash = (0, crypto_1.createHash)('sha1');
    // Read file 1 MB at a time
    const fd = fs.openSync(filename, 'r');
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position)) === buffer.length) {
        hash.update(buffer);
        position += bytesRead;
    }
    hash.update(buffer.slice(0, bytesRead));
    return hash.digest('hex');
}
function getVSCodeSysrootChecksum(expectedName) {
    const checksums = fs.readFileSync(path.join(REPO_ROOT, 'build', 'checksums', 'vscode-sysroot.txt'), 'utf8');
    for (const line of checksums.split('\n')) {
        const [checksum, name] = line.split(/\s+/);
        if (name === expectedName) {
            return checksum;
        }
    }
    return undefined;
}
/*
 * Do not use the fetch implementation from build/lib/fetch as it relies on vinyl streams
 * and vinyl-fs breaks the symlinks in the compiler toolchain sysroot. We use the native
 * tar implementation for that reason.
 */
async function fetchUrl(options, retries = 10, retryDelay = 1000) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30 * 1000);
        const version = '20231122-245579';
        try {
            const response = await fetch(`https://api.github.com/repos/Microsoft/vscode-linux-build-agent/releases/tags/v${version}`, {
                headers: ghApiHeaders,
                signal: controller.signal /* Typings issue with lib.dom.d.ts */
            });
            if (response.ok && (response.status >= 200 && response.status < 300)) {
                console.log(`Fetch completed: Status ${response.status}.`);
                const contents = Buffer.from(await response.arrayBuffer());
                const asset = JSON.parse(contents.toString()).assets.find((a) => a.name === options.assetName);
                if (!asset) {
                    throw new Error(`Could not find asset in release of Microsoft/vscode-linux-build-agent @ ${version}`);
                }
                console.log(`Found asset ${options.assetName} @ ${asset.url}.`);
                const assetResponse = await fetch(asset.url, {
                    headers: ghDownloadHeaders
                });
                if (assetResponse.ok && (assetResponse.status >= 200 && assetResponse.status < 300)) {
                    const assetContents = Buffer.from(await assetResponse.arrayBuffer());
                    console.log(`Fetched response body buffer: ${ansiColors.magenta(`${assetContents.byteLength} bytes`)}`);
                    if (options.checksumSha256) {
                        const actualSHA256Checksum = (0, crypto_1.createHash)('sha256').update(assetContents).digest('hex');
                        if (actualSHA256Checksum !== options.checksumSha256) {
                            throw new Error(`Checksum mismatch for ${ansiColors.cyan(asset.url)} (expected ${options.checksumSha256}, actual ${actualSHA256Checksum}))`);
                        }
                    }
                    console.log(`Verified SHA256 checksums match for ${ansiColors.cyan(asset.url)}`);
                    const tarCommand = `tar -xz -C ${options.dest}`;
                    (0, child_process_1.execSync)(tarCommand, { input: assetContents });
                    console.log(`Fetch complete!`);
                    return;
                }
                throw new Error(`Request ${ansiColors.magenta(asset.url)} failed with status code: ${assetResponse.status}`);
            }
            throw new Error(`Request ${ansiColors.magenta('https://api.github.com')} failed with status code: ${response.status}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    catch (e) {
        if (retries > 0) {
            console.log(`Fetching failed: ${e}`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return fetchUrl(options, retries - 1, retryDelay);
        }
        throw e;
    }
}
async function getVSCodeSysroot(arch) {
    return new Promise((resolve, reject) => {
        let expectedName;
        let triple;
        switch (arch) {
            case 'amd64':
                expectedName = `x86_64-linux-gnu.tar.gz`;
                triple = 'x86_64-linux-gnu';
                break;
            case 'arm64':
                expectedName = `aarch64-linux-gnu.tar.gz`;
                triple = 'aarch64-linux-gnu';
                break;
            case 'armhf':
                expectedName = `arm-rpi-linux-gnueabihf.tar.gz`;
                triple = 'arm-rpi-linux-gnueabihf';
                break;
        }
        const checksumSha256 = getVSCodeSysrootChecksum(expectedName);
        if (!checksumSha256) {
            reject(new Error(`Could not find checksum for ${expectedName}`));
            return;
        }
        const sysroot = process.env['VSCODE_SYSROOT_DIR'] ?? path.join((0, os_1.tmpdir)(), `vscode-${arch}-sysroot`);
        const stamp = path.join(sysroot, '.stamp');
        const result = `${sysroot}/${triple}/${triple}/sysroot`;
        if (fs.existsSync(stamp) && fs.readFileSync(stamp).toString() === expectedName) {
            resolve(result);
            return;
        }
        console.log(`Installing ${arch} root image: ${sysroot}`);
        fs.rmSync(sysroot, { recursive: true, force: true });
        fs.mkdirSync(sysroot);
        fetchUrl({
            checksumSha256,
            assetName: expectedName,
            dest: sysroot
        }).then(_ => {
            fs.writeFileSync(stamp, expectedName);
            resolve(result);
        }).catch(error => reject(error));
    });
}
exports.getVSCodeSysroot = getVSCodeSysroot;
async function getChromiumSysroot(arch) {
    const sysrootJSONUrl = `https://raw.githubusercontent.com/electron/electron/v${getElectronVersion().electronVersion}/script/sysroots.json`;
    const sysrootDictLocation = `${(0, os_1.tmpdir)()}/sysroots.json`;
    const result = (0, child_process_1.spawnSync)('curl', [sysrootJSONUrl, '-o', sysrootDictLocation]);
    if (result.status !== 0) {
        throw new Error('Cannot retrieve sysroots.json. Stderr:\n' + result.stderr);
    }
    const sysrootInfo = require(sysrootDictLocation);
    const sysrootArch = arch === 'armhf' ? 'bullseye_arm' : `bullseye_${arch}`;
    const sysrootDict = sysrootInfo[sysrootArch];
    const tarballFilename = sysrootDict['Tarball'];
    const tarballSha = sysrootDict['Sha1Sum'];
    const sysroot = path.join((0, os_1.tmpdir)(), sysrootDict['SysrootDir']);
    const url = [URL_PREFIX, URL_PATH, tarballSha, tarballFilename].join('/');
    const stamp = path.join(sysroot, '.stamp');
    if (fs.existsSync(stamp) && fs.readFileSync(stamp).toString() === url) {
        return sysroot;
    }
    console.log(`Installing Debian ${arch} root image: ${sysroot}`);
    fs.rmSync(sysroot, { recursive: true, force: true });
    fs.mkdirSync(sysroot);
    const tarball = path.join(sysroot, tarballFilename);
    console.log(`Downloading ${url}`);
    let downloadSuccess = false;
    for (let i = 0; i < 3 && !downloadSuccess; i++) {
        fs.writeFileSync(tarball, '');
        await new Promise((c) => {
            https.get(url, (res) => {
                res.on('data', (chunk) => {
                    fs.appendFileSync(tarball, chunk);
                });
                res.on('end', () => {
                    downloadSuccess = true;
                    c();
                });
            }).on('error', (err) => {
                console.error('Encountered an error during the download attempt: ' + err.message);
                c();
            });
        });
    }
    if (!downloadSuccess) {
        fs.rmSync(tarball);
        throw new Error('Failed to download ' + url);
    }
    const sha = getSha(tarball);
    if (sha !== tarballSha) {
        throw new Error(`Tarball sha1sum is wrong. Expected ${tarballSha}, actual ${sha}`);
    }
    const proc = (0, child_process_1.spawnSync)('tar', ['xf', tarball, '-C', sysroot]);
    if (proc.status) {
        throw new Error('Tarball extraction failed with code ' + proc.status);
    }
    fs.rmSync(tarball);
    fs.writeFileSync(stamp, url);
    return sysroot;
}
exports.getChromiumSysroot = getChromiumSysroot;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5zdGFsbC1zeXNyb290LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaW5zdGFsbC1zeXNyb290LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7O2dHQUdnRzs7O0FBRWhHLGlEQUFvRDtBQUNwRCwyQkFBNEI7QUFDNUIseUJBQXlCO0FBQ3pCLCtCQUErQjtBQUMvQiw2QkFBNkI7QUFDN0IsbUNBQW9DO0FBRXBDLDBDQUEwQztBQUUxQyxvSEFBb0g7QUFDcEgsTUFBTSxVQUFVLEdBQUcsNENBQTRDLENBQUM7QUFDaEUsTUFBTSxRQUFRLEdBQUcsb0JBQW9CLENBQUM7QUFDdEMsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBRXRFLE1BQU0sWUFBWSxHQUEyQjtJQUM1QyxNQUFNLEVBQUUsZ0NBQWdDO0lBQ3hDLFlBQVksRUFBRSxjQUFjO0NBQzVCLENBQUM7QUFFRixJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsWUFBWSxFQUFFLENBQUM7SUFDOUIsWUFBWSxDQUFDLGFBQWEsR0FBRyxRQUFRLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUNsRyxDQUFDO0FBRUQsTUFBTSxpQkFBaUIsR0FBRztJQUN6QixHQUFHLFlBQVk7SUFDZixNQUFNLEVBQUUsMEJBQTBCO0NBQ2xDLENBQUM7QUFRRixTQUFTLGtCQUFrQjtJQUMxQixNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFNBQVMsQ0FBQyxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ3hFLE1BQU0sZUFBZSxHQUFHLGtCQUFrQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUUsQ0FB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