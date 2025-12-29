#!/usr/bin/env node
/**
 * Fix theme CSS files to use data-theme attribute selectors
 * This ensures themes properly override the default variables in styles.css
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const themesDir = join(process.cwd(), 'public/themes');

function extractCSSVariables(css, themeId) {
  // Extract :root block
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/s);
  const rootContent = rootMatch ? rootMatch[1].trim() : '';
  
  // Extract .dark block
  const darkMatch = css.match(/\.dark\s*\{([^}]+)\}/s);
  const darkContent = darkMatch ? darkMatch[1].trim() : '';
  
  if (!rootContent && !darkContent) {
    console.warn('  Warning: No CSS variables found');
    return null;
  }

  // Build CSS with data-theme attribute selectors for proper specificity
  let cleanCSS = `/* Theme: ${themeId} - auto-generated */\n\n`;
  
  // Use :root[data-theme="xxx"] for light mode - higher specificity than :root
  if (rootContent) {
    cleanCSS += `:root[data-theme="${themeId}"] {\n  ${rootContent.split('\n').map(l => l.trim()).filter(l => l).join('\n  ')}\n}\n\n`;
  }
  
  // Use :root[data-theme="xxx"].dark for dark mode - higher specificity than .dark
  if (darkContent) {
    cleanCSS += `:root[data-theme="${themeId}"].dark {\n  ${darkContent.split('\n').map(l => l.trim()).filter(l => l).join('\n  ')}\n}\n`;
  }
  
  return cleanCSS;
}

function processTheme(filename) {
  const filepath = join(themesDir, filename);
  const themeId = basename(filename, '.css');
  
  // Skip default theme - it's defined in styles.css
  if (themeId === 'default') {
    console.log(`Skipping: ${filename} (default theme)`);
    return;
  }
  
  console.log(`Processing: ${filename}`);
  
  try {
    const css = readFileSync(filepath, 'utf-8');
    const cleanCSS = extractCSSVariables(css, themeId);
    
    if (cleanCSS) {
      writeFileSync(filepath, cleanCSS);
      console.log(`  ✓ Fixed: ${filename}`);
    } else {
      console.log(`  ⚠ Skipped: ${filename} (no variables found)`);
    }
  } catch (err) {
    console.error(`  ✗ Error: ${err.message}`);
  }
}

// Process all CSS files
const files = readdirSync(themesDir).filter(f => f.endsWith('.css'));
console.log(`Found ${files.length} theme files\n`);

files.forEach(processTheme);

console.log('\nDone!');

