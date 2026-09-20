// Membuat src/abi/<nama>.ts dari artefak Foundry di ../contracts/out. Jalankan `forge build` dulu (dari contracts/).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'contracts', 'out');
const dest = join(here, '..', 'src', 'abi');
mkdirSync(dest, { recursive: true });

const targets = [
  ['EquinoxPool.sol/EquinoxPool.json', 'equinoxPool'],
  ['EquinoxVolEngine.sol/EquinoxVolEngine.json', 'equinoxVolEngine'],
  ['EquinoxOptionToken.sol/EquinoxOptionToken.json', 'equinoxOptionToken'],
  ['MockUSDG.sol/MockUSDG.json', 'mockUsdg'],
  ['MockSequencerFeed.sol/MockSequencerFeed.json', 'mockSequencerFeed'],
  ['IAggregatorV3.sol/IAggregatorV3.json', 'aggregatorV3'],
  ['IBlackScholes.sol/IBlackScholes.json', 'blackScholes'],
];

for (const [artifact, name] of targets) {
  const { abi } = JSON.parse(readFileSync(join(out, artifact), 'utf8'));
  const keep = abi.filter((i) => i.type === 'function' || i.type === 'error' || i.type === 'event');
  const body = `// Dibuat oleh scripts/gen-abi.mjs dari contracts/out/${artifact} — jangan diedit.\nexport const ${name}Abi = ${JSON.stringify(keep, null, 2)} as const;\n`;
  writeFileSync(join(dest, `${name}.ts`), body);
  console.log(`wrote src/abi/${name}.ts (${keep.length} items)`);
}
