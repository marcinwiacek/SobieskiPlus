//formatted with js-beautify

const hostname = '127.0.0.1';
const port = 3000;
var callbackID = 0;
var cacheID = 1; //ID for new files - cache

podstronyType = new Array();
podstronyType["opowiadania"] = new Array("opowiadanie", "szort");
podstronyType["publicystyka"] = new Array("artykul", "felieton");

podstronyState = new Array();
podstronyState["opowiadania"] = new Array("biblioteka", "beta", "archiwum");
podstronyState["publicystyka"] = new Array("artykuly", "felietony", "poradniki");

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');

function readFileContent(fileName) {
    //FIXME: checking if path is going out
    var x = fs.readFileSync(path.normalize(__dirname + fileName), 'utf8');
    if (x.charCodeAt(0) == 65279) x = x.substring(1);
    return x;
}

const DecodingLevel = {
    MainHeaders: 1,
    MainText: 2,
    CommentHeaders: 3,
    CommentText: 4
}

function decodeFileContent(txt, allVersions) {
    var arr = new Array();
    var level = DecodingLevel.MainHeaders;
    var comment = null;
    txt.split(/\r?\n/).forEach(function(line) {
        if (line == "<!--comment-->") {
            if (comment != null) {
                if (!arr["Comments"]) arr["Comments"] = new Array();
                arr["Comments"].push(comment);
            }
            level = DecodingLevel.CommentHeaders;
            comment = new Array();
            comment["Text"] = "";
            return;
        } else if (line == "<!--change-->") {
            level = DecodingLevel.MainHeaders;
            return;
        }

        switch (level) {
            case DecodingLevel.MainHeaders:
                if (line == "") {
                    level = DecodingLevel.MainText;
                    if (allVersions && arr["Text"] && arr["Text"] != "") {
                        if (!arr["OldText"]) arr["OldText"] = new Array();
                        var oldtext = new Array();
                        oldtext["Text"] = arr["Text"];
                        oldtext["When"] = arr["When"];
                        arr["OldText"].push(oldtext);
                    }
                    arr["Text"] = "";
                } else {
                    var x = line.split(":");
                    if (x.length >= 2) arr[x[0]] = line.substring(x[0].length + 1, line.length);
                }
                break;
            case DecodingLevel.MainText:
                arr["Text"] += line + "\n";
                break;
            case DecodingLevel.CommentHeaders:
                if (line == "") {
                    level = DecodingLevel.CommentText;
                } else {
                    var x = line.split(":");
                    if (x.length >= 2) comment[x[0]] = line.substring(x[0].length + 1, line.length);
                }
                break;
            case DecodingLevel.CommentText:
                comment["Text"] += line + "\n";
                break;
        }
    });
    if (comment != null) {
        if (!arr["Comments"]) arr["Comments"] = new Array();
        arr["Comments"].push(comment);
    }
    //    console.log(arr);
    return arr;
}

function addToCache(name) {
    console.log(name);
    var x = decodeFileContent(readFileContent('\\teksty\\' + name + '.txt'), false);
    x["filename"] = name;
    x["callback"] = new Array();
    cache.push(x);
}

function getPageList(pageNum, stateList, typeList, speciesList, taxonomy, sortLevel) {
    var result = new Array();
    cache.forEach(function(entry) {
        if (!stateList.includes(entry["State"])) return;
        if (!typeList.includes(entry["Type"])) return;
        if (!speciesList.includes(entry["Species"])) return;
        result.push(entry);
        /*            if ($taxonomy!="" && isset($row["taxonomy"])) {
                        $tax = explode(",", $row["taxonomy"]);
                        if (!in_array($taxonomy, $tax)) { continue;
                        }
                    }*/
    });
    return result;
}

function parsePOSTforms(params, req, res, userID) {
    console.log(params);

    if (params["q"]) {
        if (params["q"] == "upload_comment" && params["tekst"] && params["comment"]) {
            //checking for login
            //checking for correct filename protection
            if (fs.existsSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt")) {
                fs.appendFileSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt",
                    "\n<!--comment-->\n" +
                    "Title:ala\n" +
                    //            "When:".date("d M Y H:i:s", $t)."\n"+
                    "Author:marcin\n\n" +
                    params["comment"]
                );

                comment = new Array();
                comment["Title"] = "ala";
                comment["Author"] = "marcin";
                comment["Text"] = params["comment"];

                cache.forEach(function(entry) {
                    if (params["tekst"] == entry["filename"]) {
                        entry["callback"].forEach(function(entry2) {
                            console.log("probuje callbark");
                            entry2[0](comment, entry2[1]);
                        });
                    }
                });
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=UTF-8');
            res.end();
            return;
        }
        if (params["q"] == "upload_text" && params["tekst"] && params["text"] &&
            params["state"] && params["type"]) { //&& params["title"] 
            if (params["tekst"] == "0") {
                var id = cacheID;
                while (1) {
                    var fd;
                    try {
                        fd = fs.openSync(__dirname + "\\teksty\\" + id + ".txt", 'wx');
                        fs.appendFileSync(fd,
                            "Title:" + params["title"] + "\n" +
                            "State:" + params["state"] + "\n" +
                            "Type:" + params["type"] + "\n" +
                            //                          "When:".date("d M Y H:i:s", $t)."\n"+
                            "Author:marcin\n\n" +
                            params["text"], 'utf8');
                        addToCache(id);
                        cacheID = id + 1;
                        break;
                    } catch (err) {
                        id++;
                    } finally {
                        if (fd !== undefined) fs.closeSync(fd);
                    }
                }
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html; charset=UTF-8');
                res.end(id.toString());
                return;
            }
            if (fs.existsSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt")) {
                fs.appendFileSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt",
                    "\n<!--change-->\n" +
                    "Title:" + params["title"] + "\n" +
                    "State:" + params["state"] + "\n" +
                    "Type:" + params["type"] + "\n" +
                    "Species:inne\n" +
                    //                          "When:".date("d M Y H:i:s", $t)."\n"+
                    "Author:marcin\n\n" +
                    params["text"]
                );
                //update cache
                cache.forEach(function(entry) {
                    if (params["tekst"] == entry["filename"]) {
                        entry["Title"] = params["title"];
                        entry["State"] = params["state"];
                        entry["Type"] = params["type"];
                        entry["Species"] = params["inne"];
                    }
                });
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html; charset=UTF-8');
                res.end();
            } else {
                res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
                res.end();
            }
        }
        return;
    }
    if (params["login"] && params["user"] && params["password"]) {
        console.log("probuje login");
        var found = false;
        fs.readdirSync(__dirname + '\\uzytkownicy').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
            if (found) return;
            var arr = decodeFileContent(readFileContent('\\uzytkownicy\\' + file), false);
            sessions.forEach(function(session) {
                if (found) return;
                usr = crypto.createHash('sha256').update(session + arr["Author"]).digest("hex");
                if (usr != params["user"]) return;
                pass = crypto.createHash('sha256').update(session + arr["Password"]).digest("hex");
                if (pass != params["password"]) return;
                const salt = crypto.randomBytes(32).toString('base64');
                cookies.push(new Array(salt, arr["Author"]));
                console.log("jest login");
                res.setHeader('Set-Cookie', 'login=' + salt);
                found = true;
            });
        });

        if (!found) {
            res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        } else {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        }
        res.end();
        return;
    }
    res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
    res.end();
}

function updateComment(comment, res) {
    console.log("jest callbark");
    var template = readFileContent('\\internal\\comment.txt');
    template = template.replace("<!--USER-->", comment["Author"]);
    template = template.replace("<!--TITLE-->", comment["Title"]);
    //           template = text.replace("<!--WHEN-->", date("d M Y H:i:s", $comment["When"]), $template);
    template = template.replace("<!--TEXT-->", comment["Text"]);

    res.write("data: " + encodeURI(template) + "\n\n")
}

function genericReplace(text, userID) {
    const session = crypto.randomBytes(32).toString('base64');
    sessions.push(session);

    text = text.replace("<!--MENU-->", readFileContent('\\internal\\menu.txt'));
    text = text.replace("<!--JS-->", readFileContent('\\internal\\js.txt'));
    if (userID == "") {
        text = text.replace("<!--LOGIN-LOGOUT-->", readFileContent('\\internal\\login.txt'));
        return text.replace("<!--HASH-->", session);
    } else {
        return text.replace("<!--LOGIN-LOGOUT-->", readFileContent('\\internal\\logout.txt'));
    }
}

function zmienDodajStrona(res, params, id, userID) {
    if (!podstronyType[id[1]]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    if (id[2] == "zmien") {
        var arr = decodeFileContent(readFileContent('\\teksty\\' + id[3] + '.txt'), true);
        if (!podstronyType[id[1]].includes(arr["Type"])) {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }
    } else { // new page
        if (!podstronyState[id[1]].includes(id[2])) {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }
    }

    var text = readFileContent('\\internal\\entryedit.txt');
    text = genericReplace(text, userID);
    if (id[2] == "zmien") {
        text = text.replace("<!--TEXT-->", arr["Text"]);
        text = text.replace(/<!--TITLE-->/g, arr["Title"]); //many entries
        text = text.replace(/<!--PAGEID-->/g, id[3]); //many entries
    } else {
        text = text.replace(/<!--TITLE-->/g, ""); //many entries
        text = text.replace(/<!--PAGEID-->/g, "0"); //many entries
    }

    txt = "";
    podstronyState[id[1]].forEach(function(state) {
        txt += "<input type=\"radio\" name=\"state\" value=\"" + state + "\"";
        if ((id[2] == "zmien" ? arr["State"] : id[2]) == state) txt += " checked";
        txt += "><label for=\"" + state + "\">" + state + "</label>";
    });
    text = text.replace("<!--STATE-->", txt + "<p>");

    txt = "";
    podstronyType[id[1]].forEach(function(type) {
        txt += "<input type=\"radio\" name=\"type\" value=\"" + type + "\"";
        if (id[2] == "zmien" && arr["Type"] == type) txt += " checked";
        txt += "><label for=\"" + type + "\">" + type + "</label>";
    });
    text = text.replace("<!--TYPE-->", txt + "<p>");

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(text);
}

function pokazStrona(res, params, id, userID) {
    if (!podstronyType[id[1]]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    var arr = decodeFileContent(readFileContent('\\teksty\\' + id[2] + '.txt'), true);
    if (!podstronyType[id[1]].includes(arr["Type"])) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    var text = readFileContent('\\internal\\entry.txt');
    text = genericReplace(text, userID);

    text = text.replace(/<!--TITLE-->/g, arr["Title"]);
    text = text.replace("<!--USER-->", arr["Author"]);
    text = text.replace("<!--TEXT-->", arr["Text"]);
    text = text.replace("<!--TYPE-->", arr["Type"]);
    text = text.replace("<!--SPECIES-->", arr["Species"]);
    //       text = text.replace("<!--WHEN-->",arr["Text"]);

    if (arr["Comments"]) {
        const template0 = readFileContent('\\internal\\comment.txt');
        var txt = "";
        arr["Comments"].forEach(function(comment) {
            var template = template0;
            template = template.replace("<!--USER-->", comment["Author"]);
            template = template.replace("<!--TITLE-->", comment["Title"]);
            //           template = text.replace("<!--WHEN-->", date("d M Y H:i:s", $comment["When"]), $template);
            txt += template.replace("<!--TEXT-->", comment["Text"]);
        });
        text = text.replace("<!--COMMENTS-->", txt);
    }
    //    $text = str_replace_first("<!--LASTUPDATE-->", $last, $text);

    if (userID != "") {
        text = text.replace("<!--COMMENTEDIT-->", readFileContent('\\internal\\commentedit.txt'));
        text = text.replace("<!--LOGIN-EDIT-->", "<div align=right><a href=?q=" + params["q"].replace("pokaz", "zmien") + ">Edycja</a></div>");
    }

    text = text.replace(/<!--PAGEID-->/g, id[2]); //many entries

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(text);
}

function pokazLista(res, params, id, userID) {
    if (!podstronyState[id[1]] || !podstronyState[id[1]].includes(id[2])) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }
    var typ = "";
    if (params["t"]) {
        if (!podstronyType[id[1]].includes(params["t"])) {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }
        typ = params["t"];
    }

    /*        $sortLevel = SortLevel::DateSort;
            if (isset($_GET["s"])) {
                switch ($_GET["s"]) {
                case "date":
                    $sortLevel= SortLevel::DateSort;
                    break;
                case "comments":
                    $sortLevel = SortLevel::CommentsNumSort;
                    break;
                case "author":
                    $sortLevel = SortLevel::AuthorSort;
                    break;
                default:
                    header('Location: '.$_SERVER['PHP_SELF']);
                    exit(0);
                }
            }
    */

    const pageNum = id[3] ? parseInt(id[1].substring(1)) : 0;

    list = getPageList(pageNum, new Array(id[2]), typ == "" ? podstronyType[id[1]] : new Array(typ),
        new Array("inne", "scifi"), "", pageNum);

    var text = readFileContent('\\internal\\list.txt');

    text = text.replace("<!--TITLE-->", "");
    text = genericReplace(text, userID);

    template = readFileContent("\\internal\\criteria.txt");

    txt = "";
    if (typ == "") {
        txt += "<b>wszystkie</b>, ";
    } else {
        txt += "<a href=?q=" + id[1] + "/" + id[2];
        if (params["s"]) txt += "&s=" + params["s"];
        txt += ">wszystkie</a>, ";
    }
    podstronyType[id[1]].forEach(function(t) {
        if (typ == t) {
            txt += "<b>$t</b>, ";
        } else {
            txt += "<a href=?q=" + id[1] + "/" + id[2] + "&t=" + t;
            if (params["s"]) txt += "&s=" + params["s"];
            txt += ">" + t + "</a>, ";
        }
    });
    template = template.replace("<!--TYPE-->", txt);

    txt = "";
    podstronyState[id[1]].forEach(function(t) {
        if (id[2] == t) {
            txt += "<b>" + t + "</b>, ";
        } else {
            txt += "<a href=?q=" + id[1] + "/" + t + ">" + t + "</a>, ";
        }
    });
    template = template.replace("<!--STATE-->", txt);

    txt = "";
    (new Array("date", "author", "comments")).forEach(function(t) {
        if ((!params["s"] && t == "date") || (params["s"] && params["s"] == t)) {
            txt += "<b>" + t + "</b>, ";
        } else {
            txt += "<a href=?q=" + id[1] + "/" + id[2] + "&s=" + t;
            if (params["t"]) txt += "&t=" + params["t"];
            txt += ">" + t + "</a>, ";
        }
    });
    template = template.replace("<!--SORTBY-->", txt);

    text = text.replace("<!--CRITERIA-->", template);

    if (list) {
        const template0 = readFileContent('\\internal\\listentry.txt');
        var txt = "";
        list.forEach(function(arr) {
            var template = template0;
            template = template.replace("<!--USER-->", arr["Author"]);
            template = template.replace("<!--TITLE-->",
                "<a href=\"?q=" + id[1] + "/pokaz/" + arr["filename"] + "\">" + arr["Title"] + "</a>");
            template = template.replace("<!--TYPE-->", arr["Type"]);
            template = template.replace("<!--SPECIES-->", arr["Species"]);
            //                    template = template.replace("<!--COMMENTSNUM-->", arr["CommentsNum"]);
            //           template = template.replace("<!--WHEN-->", date("d M Y H:i:s", $arr["When"]), $template);
            txt += template;
        });
        text = text.replace("<!--LIST-->", txt);
    }

    var txt = "";
    if (params["s"]) txt = "&s=" + params["s"];
    if (params["t"]) txt += "&t=" + params["t"];
    text = text.replace("<!--NEXTLINK-->",
        "<a href=?q=" + id[1] + "/" + id[2] + "/" + (pageNum - 1) + txt + ">&lt; Prev page</a>&nbsp;" +
        "<a href=?q=" + id[1] + "/" + id[2] + "/" + (pageNum + 1) + txt + ">Next page &gt;</a>"
    );

    if (userID != "") {
        text = text.replace("<!--LOGIN-NEW-->", "<div align=right><a href=?q=" + params["q"] + "/dodaj>Nowy tekst</a></div>");
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(text);
}

const server = http.createServer((req, res) => {
    if (req.url == "/external/styles.css" || req.url == "/external/quill.snow.css") {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/css; charset=UTF-8');
        res.end(readFileContent(req.url));
        return;
    }
    if (req.url == "/external/sha256.js" || req.url == "/external/quill.min.js") {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/javascript; charset=UTF-8');
        res.end(readFileContent(req.url));
        return;
    }
    if (req.url == "/favicon.ico") {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end();
        return;
    }

    var userID = "";
    cookies.forEach(function(cookieInfo) {
        if ("login=" + cookieInfo[0] == req.headers['cookie']) userID = cookieInfo[1];
    });
    console.log('user id is ' + userID);

    if (req.method === 'GET') {
        const params = url.parse(req.url, true).query;

        //PUSH functionality
        //check field format
        //check if session is OK
        if (params["fileid"] && fs.existsSync(__dirname + "\\teksty\\" + params["fileid"] + ".txt")) {
            console.log("callback");
            res.writeHead(200, {
                'Cache-Control': 'no-cache',
                'Content-Type': 'text/event-stream',
                'Connection': 'keep-alive',
            });
            res.write("data: \n\n")

            const id = callbackID++;

            cache.forEach(function(entry) {
                if (params["fileid"] == entry["filename"]) entry["callback"][id] = new Array(updateComment, res);
            });
            setTimeout(function() {
                cache.forEach(function(entry) {
                    if (params["fileid"] == entry["filename"]) {
                        console.log("usuwa callback");
                        delete entry["callback"][id];
                        res.end();
                    }
                });
            }, 60000); //60 seconds

            return;
        }

        if (params["q"]) {
            // for example opowiadania/pokaz/1
            var id = params["q"].match(/^([a-z]+)\/pokaz\/([0-9\-]+)$/);
            if (id) {
                pokazStrona(res, params, id, userID);
                return;
            }
            // for example opowiadanie/zmien/1
            var id = params["q"].match(/^([a-z]+)\/(zmien)\/([0-9\-]+)$/);
            if (id) {
                zmienDodajStrona(res, params, id, userID);
                return;
            }
            // for example opowiadania/biblioteka/dodaj
            var id = params["q"].match(/^([a-z]+)\/([a-z]+)\/dodaj$/);
            if (id) {
                zmienDodajStrona(res, params, id, userID);
                return;
            }
            // for example opowiadania/biblioteka/1
            var id = params["q"].match(/^([a-z]+)\/([a-z]+)(\/{1,1}[0-9]*)?$/);
            if (id) {
                pokazLista(res, params, id, userID);
                return;
            }
        }
    } else if (req.headers['content-type'] == "application/x-www-form-urlencoded") { // POST forms
        var body = "";
        req.on('data', function(data) {
            body += data;
            if (body.length > 1e6 * 6) req.connection.destroy(); // 6 MB 
        });
        req.on('end', function() {
            console.log(body);
            parsePOSTforms(url.parse("/?" + body, true).query, req, res, userID);
            return;
        });
        return;
    }

    var text = readFileContent('\\internal\\main.txt');
    text = text.replace("<!--TITLE-->", "");
    text = genericReplace(text, userID);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(text);
});

var cache = new Array();
fs.readdirSync(__dirname + '\\teksty').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    addToCache(file.replace(".txt", ""));
})

var users = new Array();
fs.readdirSync(__dirname + '\\uzytkownicy').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    users[file.replace(".txt", "")] = decodeFileContent(readFileContent('\\uzytkownicy\\' + file), false);
})

var sessions = new Array();
var cookies = new Array();

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});