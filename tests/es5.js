var acorn=require('acorn'),fs=require('fs'),bad=0;
process.argv.slice(2).forEach(function(f){try{acorn.parse(fs.readFileSync(f,'utf8'),{ecmaVersion:5});}catch(e){bad++;console.log('ES5 FAIL',f,e.message);}});
var src=process.argv.slice(2).map(function(f){return fs.readFileSync(f,'utf8')}).join('\n');
['.includes(','Object.assign','.startsWith(','.endsWith(','position:sticky','display:grid','fetch('].forEach(function(k){if(src.indexOf(k)>=0)console.log('WARN contains',k)});
console.log(bad?'ES5 errors':'ES5 OK');
