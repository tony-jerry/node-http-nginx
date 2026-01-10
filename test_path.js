const path = require('path');
const fs = require('fs');

function safeJoin(rootDir, requestPath) {
  const normalized = path.posix.normalize(String(requestPath || '/').replace(/\\/g, '/'));
  const withoutLeading = normalized.replace(/^\/+/, '');
  const candidate = path.resolve(rootDir, withoutLeading);
  const rootResolved = path.resolve(rootDir);
  const candidateLower = candidate.toLowerCase();
  const rootLower = rootResolved.toLowerCase();

  console.log(`[safeJoin] rootDir: ${rootDir}`);
  console.log(`[safeJoin] requestPath: ${requestPath}`);
  console.log(`[safeJoin] candidate: ${candidate}`);
  console.log(`[safeJoin] rootResolved: ${rootResolved}`);

  if (candidateLower === rootLower) return candidate;
  if (!candidateLower.startsWith(rootLower + path.sep)) {
    console.log(`[safeJoin] DENIED: ${candidateLower} does not start with ${rootLower}${path.sep}`);
    return null;
  }
  return candidate;
}

const root = 'C:/code/vite-project/dist';
const reqPath = '/';
const result = safeJoin(root, reqPath);
console.log(`Result for '/': ${result}`);

const result2 = safeJoin(root, '/index.html');
console.log(`Result for '/index.html': ${result2}`);

if (result2) {
  try {
    const stat = fs.statSync(result2);
    console.log(`Stat for index.html: exists=${!!stat}, isFile=${stat.isFile()}`);
  } catch (e) {
    console.log(`Stat failed: ${e.message}`);
  }
}
