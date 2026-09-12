import http from 'node:http';
const mod = await import(process.cwd() + '/api/index.js');
const app = mod.default;
console.log('app type:', typeof app);
const srv = http.createServer(app).listen(3130, () => console.log('sim listening'));
