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
var specialTaxonomy = new Array("przyklejonegłówna", "główna", "przyklejone", "złoto", "srebro"); //wymaga uprawnien admina

// internals

const sortParam = new Array("ostatni", "ileKomentarzy", "autor", "ostatniKomentarz");

var cacheID = 1; //ID for new files - cache
var cacheTexts = new Array();
var cacheUsers = new Array();
var cacheFiles = new Array();

var nonLogged = new Array();
var logged = new Array();

const crypto = require('crypto');
const fs = require('fs');
//const http = require('http');
const http2 = require('http2');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

function getUserLevelUserName(userName) {
    if (userName == "") return "0";
    var userLevel = "0";
    cacheUsers.forEach(function(user) {
        if (userName == user["Author"]) userLevel = user["Level"];
    });
    return userLevel;
}

function readFileContentSync(fileName, callback) {
    //FIXME: checking if path is going out
    if (callback) {
        fs.readFile(path.normalize(__dirname + fileName), 'utf8', (err, data) => {
            if (err) throw err;
            if (data.charCodeAt(0) == 65279) {
                callback(data.substring(1));
            } else {
                callback(data);
            }
        });
    } else {
        var x = fs.readFileSync(path.normalize(__dirname + fileName), 'utf8');
        if (x.charCodeAt(0) == 65279) x = x.substring(1);
        return x;
    }
}

// CAN'T USE // comments in JS !!!! Use /* */ instead.
function getFileContentSync(fileName) {
    if (!cacheFiles[fileName]) {
        if (fileName.includes("_gzip")) {
            cacheFiles[fileName] = zlib.gzipSync(readFileContentSync(fileName.replace("_gzip", "").replace(/(\r\n|\n|\r)/gm, "")));
        } else if (fileName.includes("_deflate")) {
            cacheFiles[fileName] = zlib.deflateSync(readFileContentSync(fileName.replace("_deflate", "").replace(/(\r\n|\n|\r)/gm, "")));
        } else {
            cacheFiles[fileName] = readFileContentSync(fileName).replace(/(\r\n|\n|\r)/gm, "");
        }
    }
    return cacheFiles[fileName];
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
    var x = decodeFileContent(readFileContentSync('\\teksty\\' + name + '.txt'), false);
    x["filename"] = name;
    x["callback"] = new Array();
    cacheTexts.push(x);
}

var months = new Array("Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec");

function formatDate(date) {
    const d = new Date(date);
    return ret = d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ' ' +
        (d.getHours()) + ':' + (d.getMinutes() + 1) + ':' + d.getSeconds();
}

function getPageList(pageNum, typeList, stateList, taxonomy, specialtaxonomyplus, specialtaxonomyminus, sortLevel, userName, userLevel) {
    var result = new Array();
    const plus = specialtaxonomyplus ? specialtaxonomyplus.split(",") : null;
    const minus = specialtaxonomyminus ? specialtaxonomyminus.split(",") : null;
    cacheTexts.forEach(function(entry) {
        if (typeList && !typeList.includes(entry["Type"])) return;
        if (!stateList.includes(entry["State"])) return;
        if (entry["State"] == "szkic" && userName != entry["Author"]) return;
        if (entry["SpecialTaxonomy"]) {
            var bad = false;
            if (plus) {
                plus.forEach(function(special) {
                    if (!entry["SpecialTaxonomy"].split(",").includes(special)) bad = true;
                });
            }
            if (!bad && minus) {
                minus.forEach(function(special) {
                    if (entry["SpecialTaxonomy"].split(",").includes(special)) bad = true;
                });
            }
            if (bad) return;
        } else {
            if (plus) return;
        }
        result.push(entry);
    });

    if (sortLevel == "ostatni") {
        result.sort(function(a, b) {
            if (a["When"] == b["When"]) return 0;
            return a["When"] > b["When"] ? -1 : 1;
        });
    } else if (sortLevel == "ostatniKomentarz") {
        result.sort(function(a, b) {
            if (a["commentswhen"] == b["commentswhen"]) return 0;
            return a["commentswhen"] > b["commentswhen"] ? -1 : 1;
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
            var x = a["Author"].localeCompare(b["Author"]);
            if (x == 0) return a["When"] > b["When"] ? -1 : 1;
            return x;
        });
    }

    if (specialtaxonomyplus && specialtaxonomyplus.includes("przyklejone")) {
        return new Array(result);
    } else {
        return new Array(result.slice(pageNum * onThePage, (pageNum + 1) * onThePage), result.length);
    }
}

function updateComment(comment, res) {
    console.log("jest callback");
    var template = getFileContentSync('\\internal\\comment.txt');
    template = template.replace("<!--USER-->", comment["Author"]);
    template = template.replace("<!--TITLE-->", comment["Title"]);
    template = template.replace("<!--WHEN-->", formatDate(comment["When"]));
    template = template.replace("<!--TEXT-->", comment["Text"]);

    res.write("event: c\n");
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

                cacheTexts.forEach(function(entry) {
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
        if (params["q"] == "upload_text" && params["tekst"] && params["text"] && params["state"] &&
            params["type"] && params["title"] && params["taxonomy"] !== 'undefined' && params["specialtaxonomy"] !== 'undefined') {
            if (params["tekst"] == "0") {
                var id = cacheID;
                while (1) {
                    var fd;
                    try {
                        txt = "";
                        if (params["taxonomy"] !== 'undefined') txt += "Taxonomy:" + params["taxonomy"] + "\n";
                        if (params["specialtaxonomy"] !== 'undefined') txt += "SpecialTaxonomy:" + params["specialtaxonomy"] + "\n";

                        fd = fs.openSync(__dirname + "\\teksty\\" + id + ".txt", 'wx');
                        fs.appendFileSync(fd,
                            "Title:" + params["title"] + "\n" +
                            "State:" + params["state"] + "\n" +
                            "Type:" + params["type"] + "\n" +
                            txt +
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
                Object.keys(podstronyType).forEach(function(entry) {
                    if (podstronyType[entry].includes(params["type"])) {
                        res.end(entry + "/zmien/" + id.toString());
                    }
                });
                return;
            }
            if (fs.existsSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt")) {
                const t = Date.now();
                txt = "";
                if (params["taxonomy"] !== 'undefined') txt += "Taxonomy:" + params["taxonomy"] + "\n";
                if (params["specialtaxonomy"] !== 'undefined') txt += "SpecialTaxonomy:" + params["specialtaxonomy"] + "\n";
                fs.appendFileSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt",
                    "\n<!--change-->\n" +
                    "Title:" + params["title"] + "\n" +
                    "State:" + params["state"] + "\n" +
                    "Type:" + params["type"] + "\n" +
                    txt +
                    "When:" + formatDate(t) + "\n" +
                    "Author:" + userName + "\n\n" +
                    params["text"]
                );
                //update cache
                cacheTexts.forEach(function(entry) {
                    if (params["tekst"] == entry["filename"]) {
                        entry["Title"] = params["title"];
                        entry["State"] = params["state"];
                        entry["Type"] = params["type"];
                        if (params["taxonomy"] !== 'undefined') entry["Taxonomy"] = params["taxonomy"];
                        if (params["specialtaxonomy"] !== 'undefined') entry["SpecialTaxonomy"] = params["specialtaxonomy"];
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
            var arr = decodeFileContent(readFileContentSync('\\uzytkownicy\\' + file), false);
            nonLogged.forEach(function(session) {
                if (found) return;
                usr = crypto.createHash('sha256').update(session + arr["Author"]).digest("hex");
                if (usr != params["user"]) return;
                pass = crypto.createHash('sha256').update(session + arr["Password"]).digest("hex");
                if (pass != params["password"]) return;
                const salt = crypto.randomBytes(32).toString('base64');
                logged.push(new Array(salt, arr["Author"], file));
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
        logged.forEach(function(cookieInfo, index) {
            if ("login=" + cookieInfo[0] == req.headers['cookie']) {
                logged.splice(index, 1);
            }
        });
        /*        logged.forEach(function(cookieInfo) {
                    console.log(cookieInfo);
                });*/

        res.end();
        return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end();
}

function isMobile(req) {
    if (req.headers['user-agent']) {
        return req.headers['user-agent'].includes('iPad') || req.headers['user-agent'].includes('iPhone') ||
            req.headers['user-agent'].includes('Android');
    }
    return false;
}

function genericReplace(req, res, text, userName) {
    res.setHeader("Link", "</external/styles.css>; rel=preload; as=style" +
        (userName == "" ? ", </external/sha256.js>; rel=preload; as=script" : ""));

    const session = crypto.randomBytes(32).toString('base64');
    nonLogged.push(session);

    text = text.replace("<!--MENU-->", getFileContentSync('\\internal\\menu' +
        ((getUserLevelUserName(userName) == "0") ? '0' : '12') +
        '.txt'));

    txt = "<link rel=\'stylesheet\' type=\'text/css\' href=\'external/styles.css\'>";
    if (req.headers['cookie']) {
        if (req.headers['cookie'].includes('dark=1')) txt +=
            "<link rel=\'stylesheet\' type=\'text/css\' href=\'external/dark.css\'>";
    } else {
        //txt+= "<link rel=\'stylesheet\' type=\'text/css\' href=\'external/autodark.css\'>";
    }
    text = text.replace("<!--STYLES-->", txt);
    text = text.replace("<!--DARK-LINK-->", "<p><a href=\"?set=dark" +
        ((req.headers['cookie'] && req.headers['cookie'].includes('dark=1')) ? "0\">Wy" : "1\">W") +
        "łącz ciemny kolor</a>");

    text = text.replace("<!--MOBILE-LINK-->", "<p><a href=\"?set=mobile" +
        ((req.headers['cookie'] && req.headers['cookie'].includes('mobile=1')) ? "0\">Wy" : "1\">W") +
        "łącz mobile</a>");

    text = text.replace("<!--JS-->", getFileContentSync('\\internal\\js.txt'));
    if (userName == "") {
        text = text.replace("<!--LOGIN-LOGOUT-->", getFileContentSync('\\internal\\login.txt'));
        return text.replace("<!--HASH-->", session);
    } else {
        return text.replace("<!--LOGIN-LOGOUT-->", getFileContentSync('\\internal\\logout.txt'));
    }
}

function addRadio(idname, value, checked) {
    return "<input type=\"radio\" name=\"" + idname + "\" id=" + idname + " value=\"" + value + "\"" +
        (checked ? " checked" : "") + "><label for=\"" + idname + "\">" + value + "</label>";
}

function addOption(idnamevalue, selected) {
    return "<option value=\"" + idnamevalue + "\"" + (selected ? " selected" : "") + ">" + idnamevalue + "</option>";
}

// for example opowiadania/dodaj
// for example opowiadania/zmien/1
function zmienDodajStrona(req, res, params, id, userName, userLevel) {
    if (userLevel == "0" || !podstronyType[id[1]]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }
    if (id[2]) {
        var arr = decodeFileContent(readFileContentSync('\\teksty\\' + id[2] + '.txt'), true);
        if (!podstronyType[id[1]].includes(arr["Type"])) {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }
    }

    var text = getFileContentSync('\\internal\\entryedit.txt');
    text = genericReplace(req, res, text, userName);
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
        if (userLevel != "2" && state == "biblioteka" && id[1] != "hydepark" &&
            (!id[2] || (id[2] && arr["State"] != "biblioteka"))) return;
        txt += addRadio("state", state, (!id[2] && state == "szkic" || id[2] && state == arr["State"]));
    });
    text = text.replace("<!--STATE-->", txt + "<p>");

    txt = "";
    podstronyType[id[1]].forEach(function(type) {
        txt += addRadio("type", type, (podstronyType[id[1]].length == 1 || (id[2] && arr["Type"] == type)));
    });
    text = text.replace("<!--TYPE-->", txt + "<p>");

    txt = "<select id=\"taxonomy\" name=\"taxonomy\" size=5 multiple>";
    taxonomy.forEach(function(tax) {
        txt += addOption(tax, (id[2] && arr["Taxonomy"].split(",").includes(tax)));
    });
    text = text.replace("<!--TAXONOMY-->", txt + "</select><p>");

    if (userLevel == "2") {
        txt = "<select id=\"specialtaxonomy\" name=\"specialtaxonomy\" size=5 multiple>";
        specialTaxonomy.forEach(function(tax) {
            txt += addOption(tax, (id[2] && arr["SpecialTaxonomy"].split(",").includes(tax)));
        });
        text = text.replace("<!--SPECIAL-TAXONOMY-->", txt + "</select><p>");
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
        res.setHeader('Content-Encoding', 'deflate');
        res.end(zlib.deflateSync(text));
    } else {
        res.end(text);
    }
}

// for example opowiadania/pokaz/1
function pokazStrona(req, res, params, id, userName, userLevel) {
    if (!podstronyType[id[1]]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    readFileContentSync('\\teksty\\' + id[2] + '.txt', (data) => {
        var arr = decodeFileContent(data, true);
        if (!podstronyType[id[1]].includes(arr["Type"]) || (arr["State"] == "szkic" && userName != arr["Author"])) {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }

        res.statusCode = 200;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');

        var text = getFileContentSync('\\internal\\entry.txt');
        text = genericReplace(req, res, text, userName);

        text = text.replace(/<!--TITLE-->/g, arr["Title"]);
        text = text.replace("<!--USER-->", arr["Author"]);
        text = text.replace("<!--TEXT-->", arr["Text"]);
        text = text.replace("<!--TYPE-->", arr["Type"]);
        text = text.replace("<!--WHEN-->", formatDate(arr["When"]));

        var lu = arr["When"];
        if (arr["Comments"]) {
            const template0 = getFileContentSync('\\internal\\comment.txt');
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
            text = text.replace("<!--COMMENTEDIT-->", getFileContentSync('\\internal\\commentedit.txt'));
            text = text.replace("<!--LOGIN-EDIT-->", "<div align=right><a href=\"?q=" +
                params["q"].replace("pokaz", "zmien") + "\">Edycja</a></div>");
        }

        text = text.replace(/<!--PAGEID-->/g, id[2]); //many entries

        if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
            res.setHeader('Content-Encoding', 'deflate');
            res.end(zlib.deflateSync(text));
        } else {
            res.end(text);
        }
    });
}

function pokazListaMain(req, res, page, params, userName) {
    var text = getFileContentSync('\\internal\\main.txt');

    text = text.replace("<!--TITLE-->", "");
    text = genericReplace(req, res, text, userName);

    const list = getPageList(page,
        null,
        new Array("biblioteka"),
        null,
        "przyklejonegłówna",
        null,
        "ostatni",
        userName,
        "0");

    const template0 = getFileContentSync('\\internal\\listentry.txt');

    if (list[0]) {
        var txt = "";
        list[0].forEach(function(arr) {
            var template = template0;
            template = template.replace("<!--USER-->", arr["Author"]);
            Object.keys(podstronyType).forEach(function(entry) {
                if (podstronyType[entry].includes(arr["Type"])) {
                    template = template.replace("<!--TITLE-->",
                        "<a href=\"?q=" + entry + "/pokaz/" + arr["filename"] + "\">" + arr["Title"] + "</a>");
                }
            });
            template = template.replace("<!--TYPE-->", arr["Type"]);
            template = template.replace("<!--COMMENTSNUM-->", arr["commentsnum"]);
            if (arr["commentsnum"] != "0") {
                template = template.replace("<!--COMMENTSWHEN-->", "(ostatni " + formatDate(arr["commentswhen"]) + ")");
            }
            template = template.replace("<!--WHEN-->", formatDate(arr["When"]));
            if (txt != "") txt += "<hr>";
            txt += template;
        });
        text = text.replace("<!--LIST-GLUE-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");
    }

    const list2 = getPageList(page,
        null,
        new Array("biblioteka"),
        null,
        "główna",
        "przyklejonegłówna",
        "ostatni",
        userName,
        "0");

    if (list2[0]) {
        var txt = "";
        list2[0].forEach(function(arr) {
            var template = template0;
            template = template.replace("<!--USER-->", arr["Author"]);
            Object.keys(podstronyType).forEach(function(entry) {
                if (podstronyType[entry].includes(arr["Type"])) {
                    template = template.replace("<!--TITLE-->",
                        "<a href=\"?q=" + entry + "/pokaz/" + arr["filename"] + "\">" + arr["Title"] + "</a>");
                }
            });
            template = template.replace("<!--TYPE-->", arr["Type"]);
            template = template.replace("<!--COMMENTSNUM-->", arr["commentsnum"]);
            if (arr["commentsnum"] != "0") {
                template = template.replace("<!--COMMENTSWHEN-->", "(ostatni " + formatDate(arr["commentswhen"]) + ")");
            }
            template = template.replace("<!--WHEN-->", formatDate(arr["When"]));
            if (txt != "") txt += "<hr>";
            txt += template;
        });
        text = text.replace("<!--LIST-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");
    }

    console.log("page num is " + page);
    if (page != 0) {
        text = text.replace("<!--PREVLINK-->",
            "<a href=\"?q=/" + (page - 1) + "\">&lt; Prev page</a>"
        );
    }
    if ((page + 1) * onThePage < list2[1]) {
        text = text.replace("<!--NEXTLINK-->",
            "<a href=\"?q=/" + (page + 1) + "\">Next page &gt;</a>"
        );
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
        res.setHeader('Content-Encoding', 'deflate');
        res.end(zlib.deflateSync(text));
    } else {
        res.end(text);
    }
}

function buildURL(tekst, rodzaj, typ, status, page, sorttype) {
    var txt = "<a href=\"?q=" + rodzaj + "/" + typ + "/" + status;
    if (page != 0) txt += "/" + page;
    if (sorttype != "") txt += "&s=" + sorttype;
    return txt + "\">" + tekst + "</a>";
}

// rodzaj/typ/status
function pokazLista(req, res, params, id, userName, userLevel) {
    const rodzaj = id[1];
    const typ = id[2] ? id[2] : "";
    const status = id[3] ? id[3] : "";
    const sortLevel = params["s"] ? params["s"] : "";

    if (!podstronyState[rodzaj] ||
        (typ && !podstronyType[rodzaj].includes(typ)) ||
        (status && !podstronyState[rodzaj].includes(status)) || (userLevel == "0" && status == "szkic") ||
        (sortLevel && !sortParam.includes(sortLevel))) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    const pageNum = id[4] ? parseInt(id[4].substring(1)) : 0;

    const list2 = getPageList(pageNum,
        typ ? new Array(typ) : podstronyType[rodzaj],
        status ? new Array(status) : podstronyState[rodzaj],
        null,
        null,
        "przyklejone",
        sortLevel == "" ? "ostatni" : sortLevel,
        userName,
        userLevel);

    if (pageNum * onThePage > list2[1]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    res.statusCode = 200;
    res.setHeader('Cache-Control', 'must-revalidate');
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');

    const template0 = getFileContentSync('\\internal\\listentry.txt');

    var text = getFileContentSync('\\internal\\list.txt');

    const list = getPageList(0,
        typ ? new Array(typ) : podstronyType[rodzaj],
        new Array("biblioteka"),
        null,
        "przyklejone",
        null,
        "ostatni",
        userName,
        userLevel);

    if (list2[0]) {
        var txt = "";
        list2[0].forEach(function(arr) {
            var template = template0;
            template = template.replace("<!--USER-->", arr["Author"]);
            template = template.replace("<!--TITLE-->",
                "<a href=\"?q=" + rodzaj + "/pokaz/" + arr["filename"] + "\">" + arr["Title"] + "</a>");
            template = template.replace("<!--TYPE-->", arr["Type"]);
            template = template.replace("<!--COMMENTSNUM-->", arr["commentsnum"]);
            if (arr["commentsnum"] != "0") {
                template = template.replace("<!--COMMENTSWHEN-->", "(ostatni " + formatDate(arr["commentswhen"]) + ")");
            }
            template = template.replace("<!--WHEN-->", formatDate(arr["When"]));
            if (txt != "") txt += "<hr>";
            txt += template;
        });
        text = text.replace("<!--LIST-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");
    }

    if (list[0]) {
        var txt = "";
        list[0].forEach(function(arr) {
            var template = template0;
            template = template.replace("<!--USER-->", arr["Author"]);
            Object.keys(podstronyType).forEach(function(entry) {
                if (podstronyType[entry].includes(arr["Type"])) {
                    template = template.replace("<!--TITLE-->",
                        "<a href=\"?q=" + entry + "/pokaz/" + arr["filename"] + "\">" + arr["Title"] + "</a>");
                }
            });
            template = template.replace("<!--TYPE-->", arr["Type"]);
            template = template.replace("<!--COMMENTSNUM-->", arr["commentsnum"]);
            if (arr["commentsnum"] != "0") {
                template = template.replace("<!--COMMENTSWHEN-->", "(ostatni " + formatDate(arr["commentswhen"]) + ")");
            }
            template = template.replace("<!--WHEN-->", formatDate(arr["When"]));
            if (txt != "") txt += "<hr>";
            txt += template;
        });
        text = text.replace("<!--LIST-GLUE-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");
    }

    text = text.replace("<!--TITLE-->", "");
    text = genericReplace(req, res, text, userName);
    text = text.replace("<!--RODZAJ-->", rodzaj);

    template = getFileContentSync("\\internal\\criteria.txt");

    txt = typ ? buildURL("wszystkie", rodzaj, "", status, pageNum, sortLevel) : "<b>wszystkie</b>";
    podstronyType[rodzaj].forEach(function(t) {
        if (txt != "") txt += " | ";
        txt += (typ == t) ? "<b>" + t + "</b>" : buildURL(t, rodzaj, t, status, pageNum, sortLevel);
    });
    template = template.replace("<!--TYPE-->", txt);

    txt = status ? buildURL("wszystkie", rodzaj, typ, "", pageNum, sortLevel) : "<b>wszystkie</b>";
    podstronyState[rodzaj].forEach(function(t) {
        if (userName == "" && t == "szkic") return;
        if (txt != "") txt += " | ";
        txt += (status == t) ? "<b>" + t + "</b>" : buildURL(t, rodzaj, typ, t, pageNum, sortLevel);
    });
    template = template.replace("<!--STATE-->", txt);

    txt = "";
    sortParam.forEach(function(sortL) {
        if (txt != "") txt += " | ";
        txt += ((!sortLevel && sortL == "ostatni") || (sortLevel == sortL)) ?
            "<b>" + sortL + "</b>" : buildURL(sortL, rodzaj, typ, status, pageNum, sortL);
    });
    template = template.replace("<!--SORTBY-->", txt);

    text = text.replace("<!--CRITERIA-->", template);

    if (pageNum != 0) {
        text = text.replace("<!--PREVLINK-->",
            buildURL("&lt; Prev page", rodzaj, typ, status, (pageNum - 1), sortLevel)
        );
    }
    if ((pageNum + 1) * onThePage < list2[1]) {
        text = text.replace("<!--NEXTLINK-->",
            buildURL("Next page &gt;", rodzaj, typ, status, (pageNum + 1), sortLevel)
        );
    }

    if (userName != "") {
        text = text.replace("<!--LOGIN-NEW-->", "<div align=right><a href=\"?q=" + rodzaj + "/dodaj\">Nowy tekst</a></div>");
    }

    if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
        res.setHeader('Content-Encoding', 'deflate');
        res.end(zlib.deflateSync(text));
    } else {
        res.end(text);
    }
}

const onRequestHandler = (req, res) => {
    if (req.url == "/external/styles.css" || req.url == "/external/quill.snow.css" ||
        req.url == "/external/dark.css" || req.url == "/external/sha256.js" ||
        req.url == "/external/quill.min.js") {
        res.statusCode = 200;
        if (req.url.includes('.js')) {
            res.setHeader('Content-Type', 'text/javascript; charset=UTF-8');
        } else {
            res.setHeader('Content-Type', 'text/css; charset=UTF-8');
        }
        //        res.setHeader('Cache-Control', 'must-revalidate');
        res.setHeader('Last-Modified', 'Wed, 21 Oct 2015 07:28:00 GMT');
        if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('gzip')) {
            res.setHeader('Content-Encoding', 'gzip');
            res.end(getFileContentSync(req.url + "_gzip"));
        } else if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
            res.setHeader('Content-Encoding', 'deflate');
            res.end(getFileContentSync(req.url + "_deflate"));
        } else {
            res.end(getFileContentSync(req.url));
        }
        return;
    }
    if (req.url == "/favicon.ico") {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end();
        return;
    }

    var userName = "";
    if (req.headers['cookie']) {
        logged.forEach(function(cookieInfo) {
            req.headers['cookie'].split("; ").forEach(function(cookie) {
                if ("login=" + cookieInfo[0] == cookie) userName = cookieInfo[1];
            });
        });
    }
    console.log('user name is ' + userName);

    if (req.method === 'GET') {
        const params = url.parse(req.url, true).query;
        console.log(req.url);

        //PUSH functionality
        //check field format
        //check if session is OK
        if (params["sse"]) {
            console.log(req.headers);
            //fixme - we need checking URL beginning
            var id = req.headers['referer'].match(/.*([a-ząż]+)\/pokaz\/([0-9\-]+)$/);
            if (id && fs.existsSync(__dirname + "\\teksty\\" + id[2] + ".txt")) {
                res.writeHead(200, {
                    'Cache-Control': 'no-cache',
                    'Content-Type': 'text/event-stream',
                    'Connection': 'keep-alive',
                });
                res.write("event: c\n");
                res.write("data: \n\n");

                const session = crypto.randomBytes(32).toString('base64');
                cacheTexts.forEach(function(entry) {
                    if (id[2] == entry["filename"]) {
                        entry["callback"][session] = res;
                        console.log("dodaje callback " + session);
                    }
                });
                res.on('close', function() {
                    cacheTexts.forEach(function(entry) {
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
        if (params["set"]) {
            if (params["set"] == "mobile1") {
                if (isMobile(req)) {
                    res.setHeader('Set-Cookie', 'mobile=; expires=Sun, 21 Dec 1980 14:14:14 GMT');
                } else {
                    res.setHeader('Set-Cookie', 'mobile=1');
                }
            } else if (params["set"] == "mobile0") {
                if (!isMobile(req)) {
                    res.setHeader('Set-Cookie', 'mobile=; expires=Sun, 21 Dec 1980 14:14:14 GMT');
                } else {
                    res.setHeader('Set-Cookie', 'mobile=0');
                }
            } else if (params["set"] == "dark1") {
                res.setHeader('Set-Cookie', 'dark=1');
            } else if (params["set"] == "dark0") {
                res.setHeader('Set-Cookie', 'dark=0');
            }
            res.statusCode = 302;
            res.setHeader('Location', req.headers['referer']);
            res.end();
            return;
        }
        if (params["q"]) {
            if (userName != "") {
                // for example opowiadania/zmien/1
                var id = params["q"].match(/^([a-ząż]+)\/zmien\/([0-9\-]+)$/);
                if (id) {
                    zmienDodajStrona(req, res, params, id, userName, getUserLevelUserName(userName));
                    return;
                }
                // for example opowiadania/dodaj
                var id = params["q"].match(/^([a-ząż]+)\/dodaj$/);
                if (id) {
                    zmienDodajStrona(req, res, params, id, userName, getUserLevelUserName(userName));
                    return;
                }
            }
            // for example opowiadania/pokaz/1
            var id = params["q"].match(/^([a-ząż]+)\/pokaz\/([0-9\-]+)$/);
            if (id) {
                pokazStrona(req, res, params, id, userName);
                return;
            }
            // for example opowiadania//biblioteka/1
            var id = params["q"].match(/^([a-ząż]+)\/([a-złąż]+)?\/([a-z]+)?(\/{1,1}[0-9]*)?$/);
            if (id) {
                pokazLista(req, res, params, id, userName, getUserLevelUserName(userName));
                return;
            }
            var id = params["q"].match(/^(\/{1,1}[0-9]*)?$/);
            if (id) {
                pokazListaMain(req, res, parseInt(id[1].substring(1)), params, userName);
                return;
            }
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }
        pokazListaMain(req, res, 0, new Array(), userName);
        return;
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
};

fs.readdirSync(__dirname + '\\teksty').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    addToCache(file.replace(".txt", ""));
})

fs.readdirSync(__dirname + '\\uzytkownicy').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    cacheUsers[file.replace(".txt", "")] = decodeFileContent(readFileContentSync('\\uzytkownicy\\' + file), false);
})

//http.createServer(onRequestHandler).listen
http2.createSecureServer({
    key: fs.readFileSync(__dirname + '\\internal\\localhost-privkey.pem'),
    cert: fs.readFileSync(__dirname + '\\internal\\localhost-cert.pem')
}, onRequestHandler).listen(port, hostname, () => {
    console.log(`Server running at https://${hostname}:${port}/`);
});