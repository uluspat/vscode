/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDependencies = void 0;
const child_process_1 = require("child_process");
const path = require("path");
const install_sysroot_1 = require("./debian/install-sysroot");
const calculate_deps_1 = require("./debian/calculate-deps");
const calculate_deps_2 = require("./rpm/calculate-deps");
const dep_lists_1 = require("./debian/dep-lists");
const dep_lists_2 = require("./rpm/dep-lists");
const types_1 = require("./debian/types");
const types_2 = require("./rpm/types");
const product = require("../../product.json");
// A flag that can easily be toggled.
// Make sure to compile the build directory after toggling the value.
// If false, we warn about new dependencies if they show up
// while running the prepare package tasks for a release.
// If true, we fail the build if there are new dependencies found during that task.
// The reference dependencies, which one has to update when the new dependencies
// are valid, are in dep-lists.ts
const FAIL_BUILD_FOR_NEW_DEPENDENCIES = true;
// Based on https://source.chromium.org/chromium/chromium/src/+/refs/tags/114.0.5735.199:chrome/installer/linux/BUILD.gn;l=64-80
// and the Linux Archive build
// Shared library dependencies that we already bundle.
const bundledDeps = [
    'libEGL.so',
    'libGLESv2.so',
    'libvulkan.so.1',
    'libvk_swiftshader.so',
    'libffmpeg.so'
];
async function getDependencies(packageType, buildDir, applicationName, arch) {
    if (packageType === 'deb') {
        if (!(0, types_1.isDebianArchString)(arch)) {
            throw new Error('Invalid Debian arch string ' + arch);
        }
    }
    if (packageType === 'rpm' && !(0, types_2.isRpmArchString)(arch)) {
        throw new Error('Invalid RPM arch string ' + arch);
    }
    // Get the files for which we want to find dependencies.
    const nativeModulesPath = path.join(buildDir, 'resources', 'app', 'node_modules.asar.unpacked');
    const findResult = (0, child_process_1.spawnSync)('find', [nativeModulesPath, '-name', '*.node']);
    if (findResult.status) {
        console.error('Error finding files:');
        console.error(findResult.stderr.toString());
        return [];
    }
    const appPath = path.join(buildDir, applicationName);
    const vscodeFiles = findResult.stdout.toString().trimEnd().split('\n');
    // Add the tunnel binary.
    vscodeFiles.push(path.join(buildDir, 'bin', product.tunnelApplicationName));
    const runtimeFiles = [];
    // Add the main executable.
    runtimeFiles.push(appPath);
    // Add chrome sandbox and crashpad handler.
    runtimeFiles.push(path.join(buildDir, 'chrome-sandbox'));
    runtimeFiles.push(path.join(buildDir, 'chrome_crashpad_handler'));
    // Generate the dependencies.
    let mergedDependencies;
    if (packageType === 'deb') {
        const chromiumSysroot = await (0, install_sysroot_1.getChromiumSysroot)(arch);
        const vscodeSysroot = await (0, install_sysroot_1.getVSCodeSysroot)(arch);
        const vscodeDependencies = mergePackageDeps((0, calculate_deps_1.generatePackageDeps)(vscodeFiles, arch, vscodeSysroot));
        const runtimeDependencies = mergePackageDeps((0, calculate_deps_1.generatePackageDeps)(runtimeFiles, arch, chromiumSysroot));
        mergedDependencies = new Set([...vscodeDependencies, ...runtimeDependencies]);
    }
    else {
        const dependencies = (0, calculate_deps_2.generatePackageDeps)([...vscodeFiles, ...runtimeFiles]);
        mergedDependencies = mergePackageDeps(dependencies);
    }
    // Exclude bundled dependencies and sort
    const sortedDependencies = Array.from(mergedDependencies).filter(dependency => {
        return !bundledDeps.some(bundledDep => dependency.startsWith(bundledDep));
    }).sort();
    const referenceGeneratedDeps = packageType === 'deb' ?
        dep_lists_1.referenceGeneratedDepsByArch[arch] :
        dep_lists_2.referenceGeneratedDepsByArch[arch];
    if (JSON.stringify(sortedDependencies) !== JSON.stringify(referenceGeneratedDeps)) {
        const failMessage = 'The dependencies list has changed.'
            + '\nOld:\n' + referenceGeneratedDeps.join('\n')
            + '\nNew:\n' + sortedDependencies.join('\n');
        if (FAIL_BUILD_FOR_NEW_DEPENDENCIES) {
            throw new Error(failMessage);
        }
        else {
            console.warn(failMessage);
        }
    }
    return sortedDependencies;
}
exports.getDependencies = getDependencies;
// Based on https://source.chromium.org/chromium/chromium/src/+/main:chrome/installer/linux/rpm/merge_package_deps.py.
function mergePackageDeps(inputDeps) {
    const requires = new Set();
    for (const depSet of inputDeps) {
        for (const dep of depSet) {
            const trimmedDependency = dep.trim();
            if (trimmedDependency.length && !trimmedDependency.startsWith('#')) {
                requires.add(trimmedDependency);
            }
        }
    }
    return requires;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwZW5kZW5jaWVzLWdlbmVyYXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImRlcGVuZGVuY2llcy1nZW5lcmF0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztnR0FHZ0c7QUFFaEcsWUFBWSxDQUFDOzs7QUFFYixpREFBMEM7QUFDMUMsNkJBQThCO0FBQzlCLDhEQUFnRjtBQUNoRiw0REFBMkY7QUFDM0YseURBQXFGO0FBQ3JGLGtEQUF5RjtBQUN6RiwrQ0FBbUY7QUFDbkYsMENBQXNFO0FBQ3RFLHVDQUE2RDtBQUM3RCw4Q0FBK0M7QUFFL0MscUNBQXFDO0FBQ3JDLHFFQUFxRTtBQUNyRSwyREFBMkQ7QUFDM0QseURBQXlEO0FBQ3pELG1GQUFtRjtBQUNuRixnRkFBZ0Y7QUFDaEYsaUNBQWlDO0FBQ2pDLE1BQU0sK0JBQStCLEdBQVksSUFBSSxDQUFDO0FBRXRELGdJQUFnSTtBQUNoSSw4QkFBOEI7QUFDOUIsc0RBQXNEO0FBQ3RELE1BQU0sV0FBVyxHQUFHO0lBQ25CLFdBQVc7SUFDWCxjQUFjO0lBQ2QsZ0JBQWdCO0lBQ2hCLHNCQUFzQjtJQUN0QixjQUFjO0NBQ2QsQ0FBQztBQUVLLEtBQUssVUFBVSxlQUFlLENBQUMsV0FBMEIsRUFBRSxRQUFnQixFQUFFLGVBQXVCLEVBQUUsSUFBWTtJQUN4SCxJQUFJLFdBQVcsS0FBSyxLQUFLLEVBQUUsQ0FBQztRQUMzQixJQUFJLENBQUMsSUFBQSwwQkFBa0IsRUFBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQy9CLE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLEdBQUcsSUFBSSxDQUFDLENBQUM7UUFDdkQsQ0FBQztJQUNGLENBQUM7SUFDRCxJQUFJLFdBQVcsS0FBSyxLQUFLLElBQUksQ0FBQyxJQUFBLHVCQUFlLEVBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUNyRCxNQUFNLElBQUksS0FBSyxDQUFDLDBCQUEwQixHQUFHLElBQUksQ0FBQyxDQUFDO0lBQ3BELENBQUM7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