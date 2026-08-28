const fs = require('fs');
const c = fs.readFileSync('D:/Jovan\'s Workplace/app/renderer/index.html', 'utf8');
const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0, fail = 0;
while ((m = re.exec(c)) !== null) {
  const b = m[1].trim();
  if (!b) continue;
  i++;
  try { new Function(b); console.log('OK  block#' + i + ' (' + b.length + ' chars)'); }
  catch (e) { fail++; console.log('FAIL block#' + i + ': ' + e.message); }
}
console.log('---- total blocks:', i, 'failures:', fail);
