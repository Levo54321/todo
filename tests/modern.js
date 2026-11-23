// Syntax check for the modern Work projects section (public/wp/*.js): ES2022, main.js as a module, wlinks.js as a classic script.
// The ES5 check (tests/es5.js) covers public/js/*.js only. Run: node tests/modern.js
var acorn = require('acorn'), fs = require('fs'), bad = 0;
fs.readdirSync(__dirname + '/../public/wp').filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
  try { acorn.parse(fs.readFileSync(__dirname + '/../public/wp/' + f, 'utf8'), { ecmaVersion: 2022, sourceType: f === 'main.js' ? 'module' : 'script' }); console.log('OK ' + f); }
  catch (e) { bad++; console.log('FAIL ' + f + ' ' + e.message); }
});
process.exit(bad ? 1 : 0);
