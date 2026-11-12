const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

function validateHtmlFile(filePath) {
  console.log(`\nValidating ${filePath}...`);
  const content = fs.readFileSync(filePath, 'utf8');

  // 1. Check HTML <div> balance (stripping <script>, <style>, and <!-- comments -->)
  const noScripts = content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const noStyles = noScripts.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const noComments = noStyles.replace(/<!--[\s\S]*?-->/g, '');

  let openDivs = 0;
  let closeDivs = 0;
  const divRegex = /<\/?div\b[^>]*>/gi;
  let match;
  while ((match = divRegex.exec(noComments)) !== null) {
    if (match[0].startsWith('</')) {
      closeDivs++;
    } else if (!match[0].endsWith('/>')) {
      openDivs++;
    }
  }
  console.log(`HTML <div> balance: open=${openDivs}, close=${closeDivs}, diff=${openDivs - closeDivs}`);
  if (openDivs !== closeDivs) {
    throw new Error(`Unbalanced <div> tags in HTML markup: ${openDivs} open vs ${closeDivs} close`);
  }

  // 2. Extract and check all <script> tags with node --check
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let scriptIndex = 0;
  let errorCount = 0;

  const tempDir = path.join(__dirname, '..', '.tmp_validate_scripts');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  while ((match = scriptRegex.exec(content)) !== null) {
    scriptIndex++;
    const attrs = match[1];
    const scriptBody = match[2];

    if (attrs.includes('src=')) {
      console.log(`Script #${scriptIndex}: external (src), skipped`);
      continue;
    }
    if (attrs.includes('type="application/json"') || attrs.includes('type="text/html"')) {
      console.log(`Script #${scriptIndex}: non-JS MIME, skipped`);
      continue;
    }
    if (!scriptBody.trim()) {
      console.log(`Script #${scriptIndex}: empty, skipped`);
      continue;
    }

    const scriptPath = path.join(tempDir, `script_${scriptIndex}.js`);
    fs.writeFileSync(scriptPath, scriptBody, 'utf8');

    try {
      execSync(`node --check "${scriptPath}"`, { stdio: 'pipe' });
      console.log(`Script #${scriptIndex} (${scriptBody.length} chars): syntax OK`);
    } catch (err) {
      console.error(`Script #${scriptIndex}: SYNTAX ERROR:\n${err.stderr ? err.stderr.toString() : err.message}`);
      errorCount++;
    } finally {
      try { fs.unlinkSync(scriptPath); } catch (e) {}
    }
  }

  try { fs.rmdirSync(tempDir); } catch (e) {}

  if (errorCount > 0) {
    throw new Error(`${errorCount} script(s) failed syntax validation!`);
  }
  console.log(`All ${scriptIndex} scripts validated successfully.`);
  return true;
}

const targetFile = process.argv[2] || path.join(__dirname, '..', 'index.html');
validateHtmlFile(targetFile);
