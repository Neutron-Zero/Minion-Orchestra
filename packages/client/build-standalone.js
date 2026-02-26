#!/usr/bin/env node

/**
 * Build script to create a standalone HTML file that can be opened directly in a browser
 * Bundles all CSS and JS inline into a single index.html
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building Angular app...');

// First, build the Angular app normally
try {
    execSync('npm run build -- --configuration production', { stdio: 'inherit' });
} catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
}

console.log('\nCreating standalone HTML file...');

const distPath = path.join(__dirname, 'dist/minion-orchestra');
const indexPath = path.join(distPath, 'index.html');
const outputPath = path.join(__dirname, '../../minion-orchestra-dashboard.html');

if (!fs.existsSync(indexPath)) {
    console.error('Build output not found. Run: npm run build');
    process.exit(1);
}

// Read the index.html
let html = fs.readFileSync(indexPath, 'utf8');

// Remove external font references that won't work with file:// protocol
// Remove preconnect to Google Fonts
html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com"[^>]*>/g, '');

// Remove inline style tags with Google Fonts
html = html.replace(/<style type="text\/css">@font-face[^<]*<\/style>/g, '');

// Add fallback font styles
const fallbackFonts = `
<style>
  /* Fallback font styles for standalone mode */
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  .material-icons {
    /* Use text fallback for Material Icons */
    font-family: monospace;
    font-size: 24px;
  }
</style>
`;
html = html.replace('</head>', fallbackFonts + '</head>');

// Find and inline all CSS files
const cssRegex = /<link rel="stylesheet" href="([^"]+)"[^>]*>/g;
let cssMatch;
while ((cssMatch = cssRegex.exec(html)) !== null) {
    const cssFile = path.join(distPath, cssMatch[1]);
    if (fs.existsSync(cssFile)) {
        const cssContent = fs.readFileSync(cssFile, 'utf8');
        const styleTag = `<style>${cssContent}</style>`;
        html = html.replace(cssMatch[0], styleTag);
        console.log(`  ✓ Inlined CSS: ${cssMatch[1]}`);
    }
}

// Find and inline all JS files
const jsRegex = /<script src="([^"]+)"[^>]*><\/script>/g;
const jsFiles = [];
let jsMatch;

// Collect all script tags
const originalHtml = html;
while ((jsMatch = jsRegex.exec(originalHtml)) !== null) {
    jsFiles.push({
        tag: jsMatch[0],
        src: jsMatch[1]
    });
}

// Replace script tags with inline content
jsFiles.forEach(({ tag, src }) => {
    const jsFile = path.join(distPath, src);
    if (fs.existsSync(jsFile)) {
        const jsContent = fs.readFileSync(jsFile, 'utf8');
        const scriptTag = `<script>${jsContent}</script>`;
        html = html.replace(tag, scriptTag);
        console.log(`  ✓ Inlined JS: ${src}`);
    }
});

// Update the base href to work with file:// protocol
html = html.replace('<base href="/">', '<base href="">');

// Add a note about CORS and WebSocket connection
const corsNote = `
<!--
    Minion Orchestra Dashboard - Standalone Version

    IMPORTANT:
    1. Make sure the Minion Orchestra server is running (default: http://localhost:3000)
    2. The server must have CORS enabled for file:// protocol or use a local web server
    3. Some browsers may block WebSocket connections from file:// URLs due to security restrictions

    For best results, serve this file from a local web server:
    - Python: python3 -m http.server 8080
    - Node.js: npx http-server
    - Or open in Chrome with: --allow-file-access-from-files flag
-->
`;

html = html.replace('<head>', '<head>\n' + corsNote);

// Update WebSocket connection to always use localhost
// This ensures it works when opened as a file
html = html.replace(
    /io\(['"]?\/['"]?\)/g,
    "io('http://localhost:3000')"
);

// Format the HTML to ensure proper structure
// Split after DOCTYPE and html tag to ensure proper formatting
html = html.replace('<!DOCTYPE html><html', '<!DOCTYPE html>\n<html');
html = html.replace('</head><body>', '</head>\n<body>');
html = html.replace('</body></html>', '</body>\n</html>');

// Write the standalone file
fs.writeFileSync(outputPath, html);

const fileSizeKB = (fs.statSync(outputPath).size / 1024).toFixed(2);

console.log('\n✅ Standalone dashboard created successfully!');
console.log(`📁 Location: ${outputPath}`);
console.log(`📊 Size: ${fileSizeKB} KB`);
console.log('\n📋 Usage:');
console.log('   1. Start the server: cd packages/server && npm start');
console.log('   2. Open minion-orchestra-dashboard.html in your browser');
console.log('\nNote: Some browsers may require a local web server due to CORS restrictions.');