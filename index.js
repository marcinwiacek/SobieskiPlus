//formatted with js-beautify

const hostname = '127.0.0.1';
const port = 3000;

const onThePage = 5;

//NOTE: adding Polish chars needs changing regular expressions
var podstronyType = new Array();
podstronyType["opowiadania"] = new Array("opowiadanie", "szort");
podstronyType["publicystyka"] = new Array("artykuł", "felieton", "poradnik");
podstronyType["książki"] = new Array("książka", "recenzja");
podstronyType["hydepark"] = new Array("inne");
var podstronyState = new Array();
podstronyState["opowiadania"] = new Array("szkic", "beta", "poczekalnia", "biblioteka");
podstronyState["publicystyka"] = new Array("szkic", "poczekalnia", "biblioteka");
podstronyState["książki"] = new Array("szkic", "poczekalnia", "biblioteka");
podstronyState["hydepark"] = new Array("szkic", "biblioteka");

var taxonomy = new Array("postapo", "upadek cywilizacji", "mrok");
var specialTaxonomy = new Array("główna", "przyklejone", "złoto", "srebro"); //wymaga uprawnien admina

// internals

const sortParam = new Array("ostatni", "ileKomentarzy", "autor", "ostatniKomentarz");

//var callbackID = 0;
var cacheID = 1; //ID for new files - cache

const crypto = require('crypto');
const fs = require('fs');
//const http = require('http');
const http2 = require('http2');
const path = require('path');
const url = require('url');

function getUserLevelUserName(userName) {
    if (userName == "") return "0";
    var userLevel = "0";
    users.forEach(function(user) {
        if (userName == user["Author"]) userLevel = user["Level"];
    });
    return userLevel;
}

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

//FIXME: reading only headers to save memory
//fields starting from big char are read from memory
function decodeFileContent(txt, allVersions) {
    var arr = new Array();
    var level = DecodingLevel.MainHeaders;
    var comment = null;
    arr["commentsnum"] = 0; // for cache we don't want comments in memory; just number
    arr["commentswhen"] = 0; // for cache we don't want comments in memory; just number
    txt.split(/\r?\n/).forEach(function(line) {
        if (line == "<!--comment-->") {
            if (comment != null) {
                if (!arr["Comments"]) arr["Comments"] = new Array();
                comment["When"] = Date.parse(comment["When"]);
                arr["Comments"].push(comment);
                arr["commentsnum"]++;
                arr["commentswhen"] = comment["When"];
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
                        oldtext["When"] = Date.parse(arr["When"]);
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
        comment["When"] = Date.parse(comment["When"]);
        arr["Comments"].push(comment);
        arr["commentsnum"]++;
        arr["commentswhen"] = comment["When"];
    }
    arr["When"] = Date.parse(arr["When"]);
    return arr;
}

function addToCache(name) {
    var x = decodeFileContent(readFileContent('\\teksty\\' + name + '.txt'), false);
    x["filename"] = name;
    x["callback"] = new Array();
    cache.push(x);
}

var months = new Array("Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec");

function formatDate(date) {
    const d = new Date(date);
    return ret = d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ' ' +
        (d.getHours()) + ':' + (d.getMinutes() + 1) + ':' + d.getSeconds();
}

function getPageList(pageNum, typeList, stateList, taxonomy, sortLevel) {
    var result = new Array();
    cache.forEach(function(entry) {
        if (!stateList.includes(entry["State"])) return;
        if (!typeList.includes(entry["Type"])) return;
        result.push(entry);
        /*            if ($taxonomy!="" && isset($row["taxonomy"])) {
                        $tax = explode(",", $row["taxonomy"]);
                        if (!in_array($taxonomy, $tax)) { continue;
                        }
                    }*/
    });

    if (sortLevel == "ostatni") {
        result.sort(function(a, b) {
            if (a["When"] == b["When"]) return 0;
            return a["When"] > b["When"] ? -1 : 1;
        });
    } else if (sortLevel == "ileKomentarzy") {
        result.sort(function(a, b) {
            if (a["commentsnum"] == b["commentsnum"]) {
                if (a["When"] == b["When"]) return 0;
                return a["When"] > b["When"] ? -1 : 1;
            }
            return a["commentsnum"] > b["commentsnum"] ? -1 : 1;
        });
    } else if (sortLevel == "autor") {
        result.sort(function(a, b) {
            return a["Author"].localeCompare(b["Author"]);
        });
    }

    return new Array(result.slice(pageNum * onThePage, (pageNum + 1) * onThePage),
        result.length);
}

function updateComment(comment, res) {
    console.log("jest callback");
    var template = readFileContent('\\internal\\comment.txt');
    template = template.replace("<!--USER-->", comment["Author"]);
    template = template.replace("<!--TITLE-->", comment["Title"]);
    template = template.replace("<!--WHEN-->", formatDate(comment["When"]));
    template = template.replace("<!--TEXT-->", comment["Text"]);

    res.write("event: c\n");
    //    res.write("id: " + comment["When"] + "\n");
    res.write("data: " + encodeURI(template) + "\n\n");
}

function parsePOSTforms(params, req, res, userName) {
    console.log(params);

    if (params["q"]) {
        if (params["q"] == "upload_comment" && params["tekst"] && params["comment"]) {
            //checking for login
            //checking for correct filename protection
            if (fs.existsSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt")) {
                const t = Date.now();
                fs.appendFileSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt",
                    "\n<!--comment-->\n" +
                    "Title:ala\n" +
                    "When:" + formatDate(t) + "\n" +
                    "Author:" + userName + "\n\n" +
                    params["comment"]
                );

                comment = new Array();
                comment["Title"] = "ala";
                comment["Author"] = userName;
                comment["When"] = t;
                comment["Text"] = params["comment"];

                cache.forEach(function(entry) {
                    if (params["tekst"] == entry["filename"]) {
                        entry["commentswhen"] = t;
                        entry["commentsnum"]++;
                        console.log("probuje callback");
                        for (var index in entry["callback"]) {
                            updateComment(comment, entry["callback"][index]);
                        }
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
                            "When:" + formatDate(Date.now()) + "\n" +
                            "Author:" + userName + "\n\n" +
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
                const t = Date.now();
                fs.appendFileSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt",
                    "\n<!--change-->\n" +
                    "Title:" + params["title"] + "\n" +
                    "State:" + params["state"] + "\n" +
                    "Type:" + params["type"] + "\n" +
                    "When:" + formatDate(t) + "\n" +
                    "Author:" + userName + "\n\n" +
                    params["text"]
                );
                //update cache
                cache.forEach(function(entry) {
                    if (params["tekst"] == entry["filename"]) {
                        entry["Title"] = params["title"];
                        entry["State"] = params["state"];
                        entry["Type"] = params["type"];
                        entry["When"] = t;
                        entry["Author"] = userName;
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
    if (params["login"] && params["user"] && params["password"] && userName == "") {
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
                cookies.push(new Array(salt, arr["Author"], file));
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
    if (params["logout"] && userName != "") {
        res.setHeader('Set-Cookie', 'login=; expires=Sun, 21 Dec 1980 14:14:14 GMT');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        cookies.forEach(function(cookieInfo, index) {
            if ("login=" + cookieInfo[0] == req.headers['cookie']) {
                console.log('removing cookie');
                cookies.splice(index, 1);
            }
        });

        console.log('after');
        cookies.forEach(function(cookieInfo) {
            console.log(cookieInfo);
        });

        res.end();
        return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end();
}

function genericReplace(text, userName) {
    const session = crypto.randomBytes(32).toString('base64');
    sessions.push(session);

    if (getUserLevelUserName(userName) == "0") {
        text = text.replace("<!--MENU-->", readFileContent('\\internal\\menu0.txt'));
    } else {
        text = text.replace("<!--MENU-->", readFileContent('\\internal\\menu12.txt'));
    }
    text = text.replace("<!--JS-->", readFileContent('\\internal\\js.txt'));
    if (userName == "") {
        text = text.replace("<!--LOGIN-LOGOUT-->", readFileContent('\\internal\\login.txt'));
        return text.replace("<!--HASH-->", session);
    } else {
        return text.replace("<!--LOGIN-LOGOUT-->", readFileContent('\\internal\\logout.txt'));
    }
}

// for example opowiadania/dodaj
// for example opowiadania/zmien/1
function zmienDodajStrona(res, params, id, userName, userLevel) {
    if (userLevel == "0" || !podstronyType[id[1]]) {
        console.log("typ1" + id[1]);
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }
    if (id[2]) {
        var arr = decodeFileContent(readFileContent('\\teksty\\' + id[2] + '.txt'), true);
        if (!podstronyType[id[1]].includes(arr["Type"])) {
            console.log("typ2" + arr["Type"]);
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }
    }

    var text = readFileContent('\\internal\\entryedit.txt');
    text = genericReplace(text, userName);
    text = text.replace("<!--RODZAJ-->", id[1]);
    if (id[2]) {
        text = text.replace("<!--TEXT-->", arr["Text"]);
        text = text.replace(/<!--TITLE-->/g, arr["Title"]); //many entries
        text = text.replace(/<!--PAGEID-->/g, id[2]); //many entries
    } else {
        text = text.replace(/<!--TITLE-->/g, ""); //many entries
        text = text.replace(/<!--PAGEID-->/g, "0"); //many entries
    }

    txt = "";
    podstronyState[id[1]].forEach(function(state) {
        if (userLevel != "2" && state == "biblioteka") return;
        txt += "<input type=\"radio\" name=\"state\" value=\"" + state + "\"";
        if ((!id[2] && state == "szkic" || id[2] && state == arr["State"])) txt += " checked";
        txt += "><label for=\"" + state + "\">" + state + "</label>";
    });
    text = text.replace("<!--STATE-->", txt + "<p>");

    txt = "";
    podstronyType[id[1]].forEach(function(type) {
        txt += "<input type=\"radio\" name=\"type\" value=\"" + type + "\"";
        if (podstronyType[id[1]].length == 1 || (id[2] && arr["Type"] == type)) txt += " checked";
        txt += "><label for=\"" + type + "\">" + type + "</label>";
    });
    text = text.replace("<!--TYPE-->", txt + "<p>");

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(text);
}

// for example opowiadania/pokaz/1
function pokazStrona(res, params, id, userName, userLevel) {
    if (!podstronyType[id[1]]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    var arr = decodeFileContent(readFileContent('\\teksty\\' + id[2] + '.txt'), true);
    if (!podstronyType[id[1]].includes(arr["Type"]) || (userLevel == "0" && arr["Author"] != userName)) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    var text = readFileContent('\\internal\\entry.txt');
    text = genericReplace(text, userName);

    text = text.replace(/<!--TITLE-->/g, arr["Title"]);
    text = text.replace("<!--USER-->", arr["Author"]);
    text = text.replace("<!--TEXT-->", arr["Text"]);
    text = text.replace("<!--TYPE-->", arr["Type"]);
    text = text.replace("<!--WHEN-->", formatDate(arr["When"]));

    var lu = arr["When"];
    if (arr["Comments"]) {
        const template0 = readFileContent('\\internal\\comment.txt');
        var txt = "";
        arr["Comments"].forEach(function(comment) {
            var template = template0;
            template = template.replace("<!--USER-->", comment["Author"]);
            template = template.replace("<!--TITLE-->", comment["Title"]);
            template = template.replace("<!--WHEN-->", formatDate(comment["When"]));
            txt += template.replace("<!--TEXT-->", comment["Text"]);
            lu = comment["When"];
        });
        text = text.replace("<!--COMMENTS-->", txt);
    }
    text = text.replace("<!--LASTUPDATE-->", formatDate(lu));

    if (userName != "") {
        text = text.replace("<!--COMMENTEDIT-->", readFileContent('\\internal\\commentedit.txt'));
        text = text.replace("<!--LOGIN-EDIT-->", "<div align=right><a href=?q=" + params["q"].replace("pokaz", "zmien") + ">Edycja</a></div>");
    }

    text = text.replace(/<!--PAGEID-->/g, id[2]); //many entries

    res.statusCode = 200;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(text);
}

// rodzaj/typ/status
function pokazLista(res, params, id, userName, userLevel) {
    if (!podstronyState[id[1]] || (id[2] && !podstronyType[id[1]].includes(id[2])) ||
        (id[3] && !podstronyState[id[1]].includes(id[3])) || (id[3] && userLevel == "0" && id[3] == "szkic")) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }
    var sortLevel = "ostatni";
    if (params["s"]) {
        if (!sortParam.includes(params["s"])) {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }
        sortLevel = params["s"];
    }

    const pageNum = id[4] ? parseInt(id[4].substring(1)) : 0;

    const list = getPageList(pageNum,
        id[2] ? new Array(id[2]) : podstronyType[id[1]],
        id[3] ? new Array(id[3]) : podstronyState[id[1]],
        "",
        sortLevel);

    if (pageNum * onThePage > list[1]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    var text = readFileContent('\\internal\\list.txt');

    text = text.replace("<!--TITLE-->", "");
    text = genericReplace(text, userName);
    text = text.replace("<!--RODZAJ-->", id[1]);

    template = readFileContent("\\internal\\criteria.txt");

    txt = "";
    if (!id[2]) {
        txt += "<b>wszystkie</b>, ";
    } else {
        txt += "<a href=?q=" + id[1] + "//";
        if (id[3]) txt += id[3];
        if (params["s"]) txt += "&s=" + params["s"];
        txt += ">wszystkie</a>, ";
    }
    podstronyType[id[1]].forEach(function(t) {
        if (id[2] && id[2] == t) {
            txt += "<b>" + t + "</b>, ";
        } else {
            txt += "<a href=?q=" + id[1] + "/" + t + "/";
            if (id[3]) txt += id[3];
            if (params["s"]) txt += "&s=" + params["s"];
            txt += ">" + t + "</a>, ";
        }
    });
    template = template.replace("<!--TYPE-->", txt);

    txt = "";
    podstronyState[id[1]].forEach(function(t) {
        if (userName == "" && t == "szkic") return;
        if (id[3] && id[3] == t) {
            txt += "<b>" + t + "</b>, ";
        } else {
            txt += "<a href=?q=" + id[1] + "/" + (id[2] ? id[2] : "") + "/" + t + ">" + t + "</a>, ";
        }
    });
    template = template.replace("<!--STATE-->", txt);

    txt = "";
    sortParam.forEach(function(t) {
        if ((!params["s"] && t == "ostatni") || (params["s"] && params["s"] == t)) {
            txt += "<b>" + t + "</b>, ";
        } else {
            txt += "<a href=?q=" + id[1] + "/" + id[2] + "&s=" + t;
            if (params["t"]) txt += "&t=" + params["t"];
            txt += ">" + t + "</a>, ";
        }
    });
    template = template.replace("<!--SORTBY-->", txt);

    text = text.replace("<!--CRITERIA-->", template);

    if (list[0]) {
        const template0 = readFileContent('\\internal\\listentry.txt');
        var txt = "";
        list[0].forEach(function(arr) {
            var template = template0;
            template = template.replace("<!--USER-->", arr["Author"]);
            template = template.replace("<!--TITLE-->",
                "<a href=\"?q=" + id[1] + "/pokaz/" + arr["filename"] + "\">" + arr["Title"] + "</a>");
            template = template.replace("<!--TYPE-->", arr["Type"]);
            template = template.replace("<!--COMMENTSNUM-->", arr["commentsnum"]);
            if (arr["commentsnum"] != "0") {
                template = template.replace("<!--COMMENTSWHEN-->", "(ostatni " + formatDate(arr["commentswhen"]) + ")");
            }
            template = template.replace("<!--WHEN-->", formatDate(arr["When"]));
            txt += template;
        });
        text = text.replace("<!--LIST-->", txt);
    }

    var txt = "";
    if (params["s"]) txt = "&s=" + params["s"];
    if (params["t"]) txt += "&t=" + params["t"];
    if (pageNum != 0) {
        text = text.replace("<!--PREVLINK-->",
            "<a href=?q=" + id[1] + "/" + id[2] + "/" + (pageNum - 1) + txt + ">&lt; Prev page</a>&nbsp;"
        );
    }
    if ((pageNum + 1) * onThePage < list[1]) {
        text = text.replace("<!--NEXTLINK-->",
            "<a href=?q=" + id[1] + "/" + id[2] + "/" + (pageNum + 1) + txt + ">Next page &gt;</a>"
        );
    }

    if (userName != "") {
        text = text.replace("<!--LOGIN-NEW-->", "<div align=right><a href=?q=" + id[1] + "/dodaj>Nowy tekst</a></div>");
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(text);
}

const onRequestHandler = (req, res) => {
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

    var userName = "";
    cookies.forEach(function(cookieInfo) {
        if ("login=" + cookieInfo[0] == req.headers['cookie']) userName = cookieInfo[1];
    });
    console.log('user name is ' + userName);

    console.log(req.method);

    if (req.method === 'GET') {
        const params = url.parse(req.url, true).query;

        //PUSH functionality
        //check field format
        //check if session is OK
        if (params["sse"]) {
            //fixme - we need checking URL beginning
            var id = req.headers['referer'].match(/.*([a-z]+)\/pokaz\/([0-9\-]+)$/);
            if (id && fs.existsSync(__dirname + "\\teksty\\" + id[2] + ".txt")) {
                res.writeHead(200, {
                    'Cache-Control': 'no-cache',
                    'Content-Type': 'text/event-stream',
                    'Connection': 'keep-alive',
                });
                res.write("event: c\n");
                res.write("data: \n\n");

                const session = crypto.randomBytes(32).toString('base64');
                cache.forEach(function(entry) {
                    if (id[2] == entry["filename"]) {
                        entry["callback"][session] = res;
                        console.log("usuwa callback " + session);
                    }
                });
                res.on('close', function() {
                    cache.forEach(function(entry) {
                        if (id[2] == entry["filename"]) {
                            console.log("usuwa callback " + session);
                            delete entry["callback"][session];
                        }
                    });
                })
                setTimeout(function() {
                    res.end();
                }, 60000); //60 seconds

                return;
            }
        }

        if (params["q"]) {
            if (userName != "") {
                // for example opowiadania/zmien/1
                var id = params["q"].match(/^([a-ząż]+)\/zmien\/([0-9\-]+)$/);
                if (id) {
                    zmienDodajStrona(res, params, id, userName, getUserLevelUserName(userName));
                    return;
                }
                // for example opowiadania/dodaj
                var id = params["q"].match(/^([a-ząż]+)\/dodaj$/);
                if (id) {
                    zmienDodajStrona(res, params, id, userName, getUserLevelUserName(userName));
                    return;
                }
            }
            // for example opowiadania/pokaz/1
            var id = params["q"].match(/^([a-ząż]+)\/pokaz\/([0-9\-]+)$/);
            if (id) {
                pokazStrona(res, params, id, userName);
                return;
            }
            // for example opowiadania//biblioteka/1
            var id = params["q"].match(/^([a-ząż]+)\/([a-złąż]+)?\/([a-z]+)?(\/{1,1}[0-9]*)?$/);
            if (id) {
                pokazLista(res, params, id, userName, getUserLevelUserName(userName));
                return;
            }
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }
    } else if (req.headers['content-type'] == "application/x-www-form-urlencoded") { // POST forms
        var body = "";
        req.on('data', function(data) {
            body += data;
            if (body.length > 1e6 * 6) req.connection.destroy(); // 6 MB 
        });
        req.on('end', function() {
            console.log(body);
            parsePOSTforms(url.parse("/?" + body, true).query, req, res, userName);
            return;
        });
        return;
    }

    var text = readFileContent('\\internal\\main.txt');
    text = text.replace("<!--TITLE-->", "");
    text = genericReplace(text, userName);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(text);
};

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

//const server = http.createServer(onRequestHandler);
const server = http2.createSecureServer({
    key: fs.readFileSync(__dirname + '\\internal\\localhost-privkey.pem'),
    cert: fs.readFileSync(__dirname + '\\internal\\localhost-cert.pem')
}, onRequestHandler);

server.listen(port, hostname, () => {
    console.log(`Server running at http(s)://${hostname}:${port}/`);
});