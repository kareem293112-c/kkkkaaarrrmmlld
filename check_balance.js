import fs from 'fs';

const content = fs.readFileSync('src/App.tsx', 'utf8');
const lines = content.split('\n');

let balance = 0;
for (let i = 1330; i < 1345; i++) {
  const line = lines[i-1];
  const opens = (line.match(/{/g) || []).length;
  const closes = (line.match(/}/g) || []).length;
  const prevBalance = balance;
  // I need the global balance, so I should run from the start but only print here
}

// Rewriting for global context
balance = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const opens = (line.match(/{/g) || []).length;
  const closes = (line.match(/}/g) || []).length;
  balance += opens;
  balance -= closes;
  if (i >= 1270 && i <= 1350) {
    console.log(`Line ${i + 1} (balance ${balance}): ${line}`);
  }
}
