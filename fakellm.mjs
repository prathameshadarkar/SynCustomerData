import http from 'node:http';
let n = 0;
http.createServer((req, res) => {
  let body=''; req.on('data', c => body += c); req.on('end', () => {
    n++;
    const b = JSON.parse(body);
    if (n === 1) { res.writeHead(429, {'content-type':'application/json','retry-after':'1'}); return res.end(JSON.stringify({error:{message:'Rate limit reached. Please try again in 1s.'}})); }
    if (n === 2) { // bad JSON to trigger repair path
      res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({choices:[{message:{content:'{"name":"Ava Chen","age":"20","academic_year":"Sophomore","school_or_field":"CAS","major":"Biology","background":"x","topic_familiarity":"moderate","usage_intensity":"Weekly","behavioral_pattern":"b"}'}}],usage:{total_tokens:100}}));
    }
    // From call 3 on: always 503 so the adapter must fall back to mock
    res.writeHead(503, {'content-type':'application/json'}); res.end(JSON.stringify({error:{message:'overloaded'}}));
  });
}).listen(3999, () => console.log('fake llm on 3999'));
