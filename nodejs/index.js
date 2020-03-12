const http = require('http');
const fs = require('fs');

const hostname = '127.0.0.1';
const port = 3000;

const server = http.createServer((req, res) => {
console.log(req.url);
  if (req.url == "/external/styles.css") {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'Content-Type: text/css');
    res.end(fs.readFileSync(__dirname+'\\external\\styles.css', ''));
    return;
  }
  if (req.url == "/external/sha256.js") {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'Content-Type: text/javascript');
    res.end(fs.readFileSync(__dirname+'\\external\\sha256.js', ''));
    return;
  }

  var contents = fs.readFileSync(__dirname+'\\internal\\main.txt', 'utf8');
  contents = contents.replace("<!--TITLE-->","");
  contents = contents.replace("<!--MENU-->",fs.readFileSync(__dirname+'\\internal\\menu.txt', 'utf8'));
  contents = contents.replace("<!--JS-->",fs.readFileSync(__dirname+'\\internal\\js.txt', 'utf8'));
  contents = contents.replace("<!--LOGIN-LOGOUT-->",fs.readFileSync(__dirname+'\\internal\\login.txt', 'utf8'));

  res.statusCode = 200;
  res.setHeader('Content-Type', 'Content-Type: text/html; charset=UTF-8');
  res.end(contents);
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
