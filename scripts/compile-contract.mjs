// Compile contracts/src/DrinkTally.sol with solc-js into contracts/out/.
// Equivalent of `forge build` for environments without Foundry.
import solc from 'solc';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'contracts/src/DrinkTally.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'DrinkTally.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // paris keeps the bytecode runnable on older local EVMs (ganache);
    // Base mainnet/Sepolia run newer forks and execute it identically
    evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const fatal = (output.errors ?? []).filter((e) => e.severity === 'error');
for (const e of output.errors ?? []) console.error(e.formattedMessage);
if (fatal.length) process.exit(1);

const contract = output.contracts['DrinkTally.sol'].DrinkTally;
const outDir = path.join(root, 'contracts/out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'DrinkTally.json'),
  JSON.stringify(
    { abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object },
    null,
    2,
  ),
);
console.log('compiled -> contracts/out/DrinkTally.json');
