import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const candidateRoot = path.resolve('packages/local-web');
const baselineRoot = process.argv[2]
  ? path.resolve(process.argv[2], 'packages/local-web')
  : null;

function readBuild(root) {
  const distRoot = path.join(root, 'dist');
  const html = fs.readFileSync(path.join(distRoot, 'index.html'), 'utf8');
  const entryMatch = html.match(/src="\/assets\/([^"]+\.js)"/);
  if (!entryMatch) throw new Error(`No entry script found under ${distRoot}`);
  const assetsRoot = path.join(distRoot, 'assets');
  const entryFile = entryMatch[1];
  const entryBytes = fs.readFileSync(path.join(assetsRoot, entryFile));
  const chunks = fs
    .readdirSync(assetsRoot)
    .filter((file) => /\.(?:js|css)$/.test(file))
    .filter((file) => /(workflow|arena|editor|terminal|mermaid)/i.test(file))
    .map((file) => ({
      file,
      bytes: fs.statSync(path.join(assetsRoot, file)).size,
    }))
    .sort((a, b) => b.bytes - a.bytes);
  return {
    entryFile,
    raw: entryBytes.length,
    gzip: zlib.gzipSync(entryBytes, { level: 9 }).length,
    chunks,
  };
}

const candidate = readBuild(candidateRoot);
console.log(
  `candidate entry=${candidate.entryFile} raw=${candidate.raw} gzip=${candidate.gzip}`
);
console.log('candidate route/heavy chunks:');
for (const chunk of candidate.chunks) console.log(`  ${chunk.file} ${chunk.bytes}`);

if (baselineRoot) {
  const baseline = readBuild(baselineRoot);
  const gzipGrowth = ((candidate.gzip - baseline.gzip) / baseline.gzip) * 100;
  console.log(
    `baseline entry=${baseline.entryFile} raw=${baseline.raw} gzip=${baseline.gzip}`
  );
  console.log(`initial gzip growth=${gzipGrowth.toFixed(2)}%`);
  if (gzipGrowth > 5) {
    throw new Error('Initial Dashboard gzip grew by more than the 5% budget');
  }
}
