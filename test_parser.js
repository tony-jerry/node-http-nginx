const path = require('path');
const fs = require('fs');

// Mock tokenizeNginxConf and parseNginxTokens
function tokenizeNginxConf(text) {
  const tokens = [];
  let i = 0;
  let current = '';
  let quote = null;
  function pushCurrent() {
    if (!current) return;
    tokens.push(current);
    current = '';
  }
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        i += 1;
        continue;
      }
      if (ch === '\\' && i + 1 < text.length) {
        const next = text[i + 1];
        current += next;
        i += 2;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '#') {
      pushCurrent();
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      pushCurrent();
      i += 1;
      continue;
    }
    if (ch === '{' || ch === '}' || ch === ';') {
      pushCurrent();
      tokens.push(ch);
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  pushCurrent();
  return tokens;
}

function parseNginxTokens(tokens) {
  let idx = 0;
  function parseBlock() {
    const items = [];
    while (idx < tokens.length) {
      const t = tokens[idx];
      if (t === '}') {
        idx += 1;
        break;
      }
      const parts = [];
      while (idx < tokens.length) {
        const cur = tokens[idx];
        if (cur === ';' || cur === '{' || cur === '}') break;
        parts.push(cur);
        idx += 1;
      }
      const end = tokens[idx];
      if (!parts.length) {
        idx += 1;
        continue;
      }
      const name = parts[0];
      const args = parts.slice(1);
      if (end === ';') {
        idx += 1;
        items.push({ type: 'directive', name, args });
        continue;
      }
      if (end === '{') {
        idx += 1;
        const children = parseBlock();
        items.push({ type: 'block', name, args, children });
        continue;
      }
      if (end === '}') {
        items.push({ type: 'directive', name, args });
        continue;
      }
      idx += 1;
    }
    return items;
  }
  return parseBlock();
}

function findBlocks(ast, name) {
  const out = [];
  for (const node of ast) {
    if (node?.type === 'block' && node.name === name) out.push(node);
  }
  return out;
}

function findDirectives(ast, name) {
  const out = [];
  for (const node of ast) {
    if (node?.type === 'directive' && node.name === name) out.push(node);
  }
  return out;
}

function buildNodeServerConfigFromAst(ast, configFilePath, baseDir) {
  const httpBlocks = findBlocks(ast, 'http');
  const httpBlock = httpBlocks[0];
  if (!httpBlock) return null;
  const servers = findBlocks(httpBlock.children || [], 'server');
  const server = servers[0];
  if (!server) return null;

  const serverRootDir = findDirectives(server.children || [], 'root')[0];
  const serverRoot = serverRootDir?.args?.[0] ? path.resolve(baseDir, String(serverRootDir.args[0])) : baseDir;

  return { serverRoot };
}

const configText = fs.readFileSync('nginx.conf', 'utf8');
const tokens = tokenizeNginxConf(configText);
const ast = parseNginxTokens(tokens);
const baseDir = 'c:/code/vpn';
const cfg = buildNodeServerConfigFromAst(ast, 'nginx.conf', baseDir);

console.log('Resolved Config:');
console.log(JSON.stringify(cfg, null, 2));
