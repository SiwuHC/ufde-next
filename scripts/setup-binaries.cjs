#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Setup binaries for Tauri application
 * Copies FDE-CLI tools and yosys binaries to src-tauri/binaries with platform-specific suffixes
 */

const PROJECT_ROOT = path.join(__dirname, '..');
const PUBLIC_FDE_BUILD = path.join(PROJECT_ROOT, 'public/FDE-Source/build/bin');
const PUBLIC_YOSYS_BUILD = path.join(PROJECT_ROOT, 'public/yosys');
const BINARIES_DIR = path.join(PROJECT_ROOT, 'src-tauri/binaries');
const FDE_CLI_DIR = path.join(BINARIES_DIR, 'fde-cli');

// FDE-CLI tools to copy
const FDE_CLI_TOOLS = ['bitgen', 'import', 'map', 'nlfiner', 'pack', 'place', 'route', 'sta'];

// Yosys binaries to copy
const YOSYS_BINARIES = ['yosys', 'yosys-abc'];

/**
 * Get target triple from environment variable set by Tauri build
 * Format: x86_64-pc-windows-msvc, x86_64-unknown-linux-gnu, etc.
 */
function getTargetTriple() {
  const targetTriple = process.env.CARGO_CFG_TARGET_TRIPLE;
  
  if (!targetTriple) {
    console.warn('CARGO_CFG_TARGET_TRIPLE not set. Using default detection.');
    // Fallback: detect from process.platform
    const platform = process.platform;
    const arch = process.arch;
    
    if (platform === 'win32') {
      return 'x86_64-pc-windows-msvc';
    } else if (platform === 'linux') {
      return arch === 'x64' ? 'x86_64-unknown-linux-gnu' : 'i686-unknown-linux-gnu';
    } else if (platform === 'darwin') {
      return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    }
  }
  
  return targetTriple;
}

/**
 * Determine file extension based on platform
 */
function getExeExtension(targetTriple) {
  return targetTriple.includes('windows') ? '.exe' : '';
}

/**
 * Create directory if it doesn't exist
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

/**
 * Copy file and set execution permissions
 */
function copyBinary(sourceFile, targetFile) {
  try {
    // Check if source exists
    if (!fs.existsSync(sourceFile)) {
      console.error(` Source file not found: ${sourceFile}`);
      return false;
    }

    // Copy file
    fs.copyFileSync(sourceFile, targetFile);

    // Set execution permission on Unix-like systems
    if (process.platform !== 'win32') {
      fs.chmodSync(targetFile, 0o755);
    }

    console.log(`Copied: ${path.relative(PROJECT_ROOT, sourceFile)} → ${path.relative(PROJECT_ROOT, targetFile)}`);
    return true;
  } catch (error) {
    console.error(` Failed to copy ${sourceFile}: ${error.message}`);
    return false;
  }
}

/**
 * Setup FDE-CLI tools
 */
function setupFdeCliTools(targetTriple) {
  console.log('\n Setting up FDE-CLI tools...');
  
  const exeExt = getExeExtension(targetTriple);
  const suffix = `-${targetTriple}${exeExt}`;
  
  // Check if FDE-Source build directory exists
  if (!fs.existsSync(PUBLIC_FDE_BUILD)) {
    console.error(`   FDE-Source build directory not found: ${PUBLIC_FDE_BUILD}`);
    console.error('   Please build FDE-Source first:');
    console.error('   $ cd public/FDE-Source && mkdir -p build && cd build');
    console.error('   $ cmake -GNinja .. && ninja');
    return false;
  }

  ensureDir(FDE_CLI_DIR);

  let successCount = 0;
  for (const tool of FDE_CLI_TOOLS) {
    const sourceFile = path.join(PUBLIC_FDE_BUILD, tool);
    const targetFile = path.join(FDE_CLI_DIR, tool + suffix);
    
    if (copyBinary(sourceFile, targetFile)) {
      successCount++;
    }
  }

  console.log(` FDE-CLI: ${successCount}/${FDE_CLI_TOOLS.length} tools copied`);
  return successCount === FDE_CLI_TOOLS.length;
}

/**
 * Setup yosys binaries
 */
function setupYosysBinaries(targetTriple) {
  console.log('\n Setting up yosys binaries...');
  
  const exeExt = getExeExtension(targetTriple);
  const suffix = `-${targetTriple}${exeExt}`;
  
  // Check if yosys build directory exists
  if (!fs.existsSync(PUBLIC_YOSYS_BUILD)) {
    console.error(`   Yosys build directory not found: ${PUBLIC_YOSYS_BUILD}`);
    console.error('   Please build yosys first:');
    console.error('   $ cd public/yosys && mkdir -p build && cd build');
    console.error('   $ cmake .. && cmake --build .');
    return false;
  }

  ensureDir(BINARIES_DIR);

  let successCount = 0;
  for (const binary of YOSYS_BINARIES) {
    const sourceFile = path.join(PUBLIC_YOSYS_BUILD, binary + exeExt);
    const targetFile = path.join(BINARIES_DIR, binary + suffix);
    
    if (copyBinary(sourceFile, targetFile)) {
      successCount++;
    }
  }

  console.log(` Yosys: ${successCount}/${YOSYS_BINARIES.length} binaries copied`);
  return successCount === YOSYS_BINARIES.length;
}

/**
 * Validate setup
 */
function validateSetup(targetTriple) {
  console.log('\n Validating setup...');

  const exeExt = getExeExtension(targetTriple);
  const suffix = `-${targetTriple}${exeExt}`;

  let allValid = true;

  // Check FDE-CLI tools
  for (const tool of FDE_CLI_TOOLS) {
    const file = path.join(FDE_CLI_DIR, tool + suffix);
    if (!fs.existsSync(file)) {
      console.error(`Missing: ${path.relative(PROJECT_ROOT, file)}`);
      allValid = false;
    }
  }

  // Check yosys binaries
  for (const binary of YOSYS_BINARIES) {
    const file = path.join(BINARIES_DIR, binary + suffix);
    if (!fs.existsSync(file)) {
      console.error(`Missing: ${path.relative(PROJECT_ROOT, file)}`);
      allValid = false;
    }
  }

  if (allValid) {
    console.log('All required binaries are in place');
  } else {
    console.error('Some required binaries are missing');
  }

  return allValid;
}

/**
 * Main setup function
 */
function main() {
  console.log('Setting up Tauri binaries...\n');

  const targetTriple = getTargetTriple();
  console.log(`Target platform: ${targetTriple}`);

  try {
    const fdeCliOk = setupFdeCliTools(targetTriple);
    const yosysOk = setupYosysBinaries(targetTriple);
    const validationOk = validateSetup(targetTriple);

    console.log('\n' + '='.repeat(60));
    if (fdeCliOk && yosysOk && validationOk) {
      console.log('Binaries setup completed successfully');
      console.log('='.repeat(60));
      process.exit(0);
    } else {
      console.error('Setup failed. Please check the errors above.');
      console.log('='.repeat(60));
      process.exit(1);
    }
  } catch (error) {
    console.error('\nUnexpected error:', error.message);
    process.exit(1);
  }
}

// Run main function
main();
