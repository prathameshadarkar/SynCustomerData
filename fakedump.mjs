import http from 'node:http';
http.createServer((req, res) => { let body=''; req.on('data', c => body += c); req.on('end', () => { const b=JSON.parse(body); console.log(JSON.stringify(b.response_format).slice(0,200)); res.writeHead(500,{'content-type':'application/json'}); res.end('{"error":{"message":"x"}}'); }); }).listen(3998);
