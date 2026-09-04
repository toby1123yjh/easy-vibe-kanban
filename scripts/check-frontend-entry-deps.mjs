import fs from 'node:fs';
import path from 'node:path';

const distRoot = path.resolve('packages/local-web/dist');
const html = fs.readFileSync(path.join(distRoot, 'index.html'), 'utf8');
const entryMatch = html.match(/src="\/assets\/([^"]+\.js)"/);
if (!entryMatch) throw new Error('Could not find the local-web entry script');

const entryFile = entryMatch[1];
const entryPath = path.join(distRoot, 'assets', entryFile);
const entrySource = fs.readFileSync(entryPath, 'utf8');
const staticImports = [...entrySource.matchAll(/(?:^|[^.\w])import\s+[^;]*?from\s*["']([^"']+)["']/g)].map(
  (match) => match[1]
);

const forbidden = /(features[\\/]workflow|features[\\/]arena|workspace-chat|terminal|mermaid|editor|workflow|arena)/i;

const forbiddenStaticImports = staticImports.filter((source) => forbidden.test(source));
if (forbiddenStaticImports.length > 0) {
  throw new Error(`Dashboard entry has forbidden static imports: ${forbiddenStaticImports.join(', ')}`);
}
console.log(`Dashboard entry: ${entryFile}`);
console.log(`Static imports: ${staticImports.length} (shared dependencies are allowed)`);
console.log('Forbidden static Workflow/Arena/editor/terminal imports: 0');
