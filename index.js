//formatted with js-beautify

const crypto = require('crypto');
const fs = require('fs');
//const http = require('http');
const http2 = require('http2');
const https = require('https');
const path = require('path');
const url = require('url');
const zlib = require('zlib');
const vm = require('vm')

vm.runInThisContext(fs.readFileSync(__dirname + '\\config.js'));

var smtp = "";
const nodemailer = require(path.normalize(process.argv[0].replace("node.exe", "") + '\\node_modules\\nodemailer'));
if (mailSupport) {
    nodemailer.createTestAccount((err, account) => {
        if (err) {
            console.error('No test account ' + err.message);
            return process.exit(1);
        }
        smtp = nodemailer.createTransport({
            host: account.smtp.host,
            port: account.smtp.port,
            secure: account.smtp.secure,
            auth: {
                user: account.user,
                pass: account.pass
            }
        });
    });
}

var cacheID = 1; //ID for new files - cache
var cacheTexts = new Array();
var cacheUsers = new Array();
var cacheFiles = new Array();
var cacheChat = new Array();

var callbackChat = new Array();
var callbackText = new Array();
var callbackList = new Array();

var nonLogged = new Array();
var logged = new Array();
var verifyToken = new Array();

function getUserLevelUserName(userName) {
    if (userName == "") return "0";
    return cacheUsers[userName][1]["Level"];
}

function readFileContentSync(fileName, callback) {
    //FIXME: checking if path is going out
    if (callback) {
        fs.readFile(path.normalize(__dirname + fileName), 'utf8', (err, data) => {
            if (err) {
                callback("");
            } else if (data.charCodeAt(0) == 65279) {
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
//replace(/(\r\n|\n|\r)/gm, "")
function getFileContentSync(fileName) {
    if (!cacheFiles[fileName]) {
        if (fileName.includes("_gzip")) {
            cacheFiles[fileName] = zlib.gzipSync(readFileContentSync(fileName.replace("_gzip", "")));
        } else if (fileName.includes("_deflate")) {
            cacheFiles[fileName] = zlib.deflateSync(readFileContentSync(fileName.replace("_deflate", "")));
        } else {
            cacheFiles[fileName] = readFileContentSync(fileName);
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
                    const x = line.split(":");
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
                    const x = line.split(":");
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
    cacheTexts[name] = decodeFileContent(readFileContentSync('\\teksty\\' + name + '.txt'), false);
    cacheTexts[name]["filename"] = name;
    callbackText[name] = new Array();
}

var months = new Array("Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec");

function formatDate(date) {
    const d = new Date(date);
    return ret = d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ' ' +
        (d.getHours() < 10 ? "0" : "") + d.getHours() + ':' +
        (d.getMinutes() < 10 ? "0" : "") + d.getMinutes() + ':' +
        (d.getSeconds() < 10 ? "0" : "") + d.getSeconds();
}

function getPageList(pageNum, typeList, stateList, taxonomy, specialtaxonomyplus, specialtaxonomyminus, sortLevel, userName, userLevel) {
    var result = new Array();
    const plus = specialtaxonomyplus ? specialtaxonomyplus.split(",") : null;
    const minus = specialtaxonomyminus ? specialtaxonomyminus.split(",") : null;
    const tax = taxonomy ? taxonomy.split(",") : null;

    cacheTexts.forEach((entry, key) => {
        if ((typeList && !typeList.includes(entry["Type"])) ||
            !stateList.includes(entry["State"]) ||
            (entry["State"] == "szkic" && userName != entry["Author"])) return;

        if (entry["Taxonomy"]) {
            if (tax) {
                var bad = false;
                tax.forEach(function(special) {
                    if (!entry["Taxonomy"].split(",").includes(special)) bad = true;
                });
                if (bad) return;
            }
        } else {
            if (tax) return;
        }

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
            return (a["When"] == b["When"]) ? 0 : (a["When"] > b["When"] ? -1 : 1);
        });
    } else if (sortLevel == "ostatniKomentarz") {
        result.sort(function(a, b) {
            return (a["commentswhen"] == b["commentswhen"]) ? 0 : (a["commentswhen"] > b["commentswhen"] ? -1 : 1);
        });
    } else if (sortLevel == "ileKomentarzy") {
        result.sort(function(a, b) {
            if (a["commentsnum"] == b["commentsnum"]) {
                return (a["When"] == b["When"]) ? 0 : (a["When"] > b["When"] ? -1 : 1);
            }
            return a["commentsnum"] > b["commentsnum"] ? -1 : 1;
        });
    } else if (sortLevel == "autor") {
        result.sort(function(a, b) {
            var x = a["Author"].localeCompare(b["Author"]);
            return (x == 0) ? (a["When"] > b["When"] ? -1 : 1) : x;
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

    const template = getFileContentSync('\\internal\\comment.txt')
        .replace("<!--USER-->", comment["Author"])
        .replace("<!--TITLE-->", comment["Title"])
        .replace("<!--WHEN-->", formatDate(comment["When"]))
        .replace("<!--TEXT-->", comment["Text"]);

    res.write("event: c\n");
    res.write("data: " + encodeURI(template) + "\n\n");
}

async function verifyMail(mail, username) {
    var x = encodeURIComponent(crypto.randomBytes(32).toString('base64'));
    let info = await smtp.sendMail({
        from: 'marcin@mwiacek.com',
        to: mail,
        subject: "Zweryfikuj swoje konto w systemie",
        text: "Link jest ważny przez godzinę: q=verifymail/" + x +
            "\n Jeżeli straci ważność, spróbuj się zalogować i dostaniesz kolejny mail"
    });
    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
    verifyToken.push(new Array(x, username, Date.now() + 1000 * 60 * 60, ""));
}

async function parsePOSTforms(params, req, res, userName) {
    console.log(params);
    if (params["q"]) {
        if (params["q"] == "upload_comment" && params["obj"] && params["tekst"] && params["comment"] && params["title"]) {
            if (params["obj"] == "chat") {
                if (fs.existsSync(__dirname + "\\chat\\" + params["tekst"] + ".txt")) {
                    const t = Date.now();
                    fs.appendFileSync(__dirname + "\\chat\\" + params["tekst"] + ".txt",
                        "\n<!--comment-->\n" +
                        "Title:" + params["title"] + "\n" +
                        "When:" + formatDate(t) + "\n" +
                        "Author:" + userName + "\n\n" +
                        params["comment"]
                    );

                    comment = new Array();
                    comment["Title"] = params["title"];
                    comment["Author"] = userName;
                    comment["When"] = t;
                    comment["Text"] = params["comment"];

                    for (var index in callbackChat[params["tekst"]]) {
                        updateComment(comment, callbackChat[params["tekst"]][index]);
                    }

                    res.statusCode = 200;
                } else {
                    res.statusCode = 404;
                }
            } else if (params["obj"] == "teksty") {
                //checking for login
                //checking for correct filename protection
                if (fs.existsSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt")) {
                    const t = Date.now();
                    fs.appendFileSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt",
                        "\n<!--comment-->\n" +
                        "Title:" + params["title"] + "\n" +
                        "When:" + formatDate(t) + "\n" +
                        "Author:" + userName + "\n\n" +
                        params["comment"]
                    );

                    comment = new Array();
                    comment["Title"] = params["title"];
                    comment["Author"] = userName;
                    comment["When"] = t;
                    comment["Text"] = params["comment"];

                    cacheTexts[params["tekst"]]["commentswhen"] = t;
                    cacheTexts[params["tekst"]]["commentsnum"]++;

                    for (var index in callbackText[params["tekst"]]) {
                        updateComment(comment, callbackText[params["tekst"]][index]);
                    }
                    res.statusCode = 200;
                } else {
                    res.statusCode = 404;
                }
                res.setHeader('Content-Type', 'text/plain');
                res.end();
                return;
            }
        }
        if (params["q"] == "upload_text" && params["tekst"]) {
            if (params["tekst"] == "0") {
                if (!params["text"] || !params["state"] ||
                    !params["type"] || !params["title"]) {
                    res.statusCode = 404;
                    res.setHeader('Content-Type', 'text/plain');
                    res.end();
                    return;
                }
                var id = cacheID;
                while (1) {
                    var fd;
                    try {
                        txt = "";
                        if (params["taxonomy"]) txt += "Taxonomy:" + params["taxonomy"] + "\n";
                        if (params["specialtaxonomy"]) txt += "SpecialTaxonomy:" + params["specialtaxonomy"] + "\n";

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
                res.setHeader('Content-Type', 'text/plain');
                Object.keys(podstronyType).forEach(function(entry) {
                    if (podstronyType[entry].includes(params["type"])) {
                        res.end(entry + "/zmien/" + id.toString());
                    }
                });
                return;
            }
            if (!params["text"] && !params["state"] && !params["type"] &&
                !params["title"] && !params["taxonomy"] && !params["specialtaxonomy"]) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'text/plain');
                res.end();
                return;
            }
            if (fs.existsSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt")) {
                const t = Date.now();
                txt = "";
                if (params["title"]) txt += "Title:" + params["title"] + "\n";
                if (params["state"]) txt += "State:" + params["state"] + "\n";
                if (params["type"]) txt += "Type:" + params["type"] + "\n";
                if (params["taxonomy"]) txt += "Taxonomy:" + params["taxonomy"] + "\n";
                if (params["specialtaxonomy"]) txt += "SpecialTaxonomy:" + params["specialtaxonomy"] + "\n";
                if (params["text"]) txt += "\n" + params["text"];
                fs.appendFileSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt",
                    "\n<!--change-->\n" +
                    "When:" + formatDate(t) + "\n" +
                    "Author:" + userName + "\n" +
                    txt
                );
                //update cache
                if (params["title"]) cacheTexts[params["tekst"]]["Title"] = params["title"];
                if (params["state"]) cacheTexts[params["tekst"]]["State"] = params["state"];
                if (params["type"]) cacheTexts[params["tekst"]]["Type"] = params["type"];
                if (params["taxonomy"]) cacheTexts[params["tekst"]]["Taxonomy"] = params["taxonomy"];
                if (params["specialtaxonomy"]) cacheTexts[params["tekst"]]["SpecialTaxonomy"] = params["specialtaxonomy"];
                if (params["text"]) cacheTexts[params["tekst"]]["Text"] = params["text"];
                cacheTexts[params["tekst"]]["When"] = t;
                cacheTexts[params["tekst"]]["Author"] = userName;
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/plain');
                res.end();
                return;
            }
        }
        if (params["q"] == "new_user" && params["username"] && params["typ"] && params["mail"]) {
            if ((params["typ"] != "g" && params["typ"] != "w") || (params["typ"] == "w" && !params["pass"])) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'text/plain');
                res.end();
                return;
            }
            if (cacheUsers[params["username"]]) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'text/plain');
                res.end("User already exists");
                return;
            }

            var id = 1;
            while (1) {
                var fd;
                try {
                    var txt = "Author:" + params["username"] + "\n" +
                        (params["typ"] == "w" ? "Password:" + params["pass"] + "\n" : "") +
                        "Mail:" + params["mail"] + "\n" +
                        "When:" + formatDate(Date.now()) + "\n" +
                        (params["typ"] != "g" ? "ConfirmMail:0\n" : "") +
                        (params["typ"] == "g" ? "Type:google\n" : "") +
                        "Level:1\n\n";
                    fd = fs.openSync(__dirname + "\\uzytkownicy\\" + id + ".txt", 'wx');
                    fs.appendFileSync(fd, txt, 'utf8');
                    cacheUsers[params["username"]] = new Array(id, decodeFileContent(txt, true));
                    break;
                } catch (err) {
                    id++;
                } finally {
                    if (fd !== undefined) fs.closeSync(fd);
                }
            }
            if (params["typ"] != "g") {
                if (mailSupport) {
                    verifyMail(params["mail"], params["username"]);
                }
            }
            console.log(id);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain');
            res.end(id.toString());
            return;
        }
    }
    if (params["login"] && params["user"] && params["password"] && userName == "") {
        console.log("probuje login");
        var found = "";
        fs.readdirSync(__dirname + '\\uzytkownicy').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
            if (found != "") return;
            var arr = decodeFileContent(readFileContentSync('\\uzytkownicy\\' + file), false);
            nonLogged.forEach(function(session) {
                if (found != "") return;
                if (!arr["Type"] || arr["Type"] == "wlasny") {
                    usr = crypto.createHash('sha256').update(session + arr["Author"]).digest("hex");
                    if (usr != params["user"]) return;
                    pass = crypto.createHash('sha256').update(session + arr["Password"]).digest("hex");
                    if (pass != params["password"]) return;
                    const salt = crypto.randomBytes(32).toString('base64');
                    if (params["typ"] != "g" && arr["ConfirmMail"] == "0") {
                        verifyMail(arr["Mail"], arr["Author"]);
                        found = "Konto niezweryfikowane. Kliknij na link w mailu";
                    } else {
                        logged.push(new Array(salt, arr["Author"], file));
                        console.log("jest login");
                        res.setHeader('Set-Cookie', 'login=' + salt);
                        found = true;
                    }
                }
            });
        });

        res.statusCode = found ? 200 : 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end(found);
        return;
    }
    if (params["verify"] && params["token"]) {
        found = false;
        verifyToken.forEach(function(session) {
            if (session[2] < Date.now()) {
                return;
            }
            if (!cacheUsers[session[1]][1]["Type"] || cacheUsers[session[1]][1]["Type"] == "wlasny") {
                if (cacheUsers[session[1]][1]["ConfirmMail"] == "0") {
                    token = crypto.createHash('sha256').update(session[3] + cacheUsers[session[1]][1]["Password"]).digest("hex");
                    if (token != params["token"]) return;
                    console.log("verified" + session[0]);
                    fs.appendFileSync(__dirname + "\\uzytkownicy\\" + cacheUsers[session[1]][0] + ".txt",
                        "\n<!--change-->\n" +
                        "When:" + formatDate(Date.now()) + "\n" +
                        "ConfirmMail:1\n"
                    );
                    cacheUsers[session[1]][1]["ConfirmMail"] = "1";
                    found = true;
                }
            }
        });

        res.statusCode = found ? 200 : 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end();
        return;
    }
    if (enableGoogleWithToken && params["glogin"] && params["id"] && userName == "") {
        // this is not preffered version according to Google, but good enough for this milestone
        const premise = new Promise((resolve, reject) => {
            https.get('https://oauth2.googleapis.com/tokeninfo?id_token=' + params["id"], (resp) => {
                var data = '';
                resp.on('data', (chunk) => data += chunk);
                resp.on('end', () => resolve(data));
            }).on('error', e => reject(e))
        });
        const txt = await premise;
        console.log(txt);
        const json = JSON.parse(txt);

        if (json.azp != GoogleSignInToken || json.aud != GoogleSignInToken) {
            console.log("bylo zle");
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain');
            res.end();
            return;
        }
        console.log("probuje login2");
        var found = false;
        fs.readdirSync(__dirname + '\\uzytkownicy').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
            if (found) return;
            var arr = decodeFileContent(readFileContentSync('\\uzytkownicy\\' + file), false);
            nonLogged.forEach(function(session) {
                if (found) return;
                if (arr["Type"] == "google" && json.email == arr["Mail"]) {
                    const salt = crypto.randomBytes(32).toString('base64');
                    logged.push(new Array(salt, arr["Author"], file, params["id"]));
                    console.log("jest login2");
                    res.setHeader('Set-Cookie', 'login=' + salt);
                    found = true;
                }
            });
        });

        res.statusCode = found ? 200 : 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end();
        return;
    }
    if (params["logout"] && userName != "") {
        res.setHeader('Set-Cookie', 'login=; expires=Sun, 21 Dec 1980 14:14:14 GMT');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
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

    txt = "<link rel=\'stylesheet\' type=\'text/css\' href=\'external/styles.css\'>";
    if (req.headers['cookie']) {
        if (req.headers['cookie'].includes('dark=1')) txt +=
            "<link rel=\'stylesheet\' type=\'text/css\' href=\'external/dark.css\'>";
    } else {
        //txt+= "<link rel=\'stylesheet\' type=\'text/css\' href=\'external/autodark.css\'>";
    }

    text = text.replace("<!--STYLES-->", txt)
        .replace("<!--MENU-->", getFileContentSync('\\internal\\menu' +
            ((getUserLevelUserName(userName) == "0") ? '0' : '12') +
            '.txt'))
        .replace("<!--DARK-LINK-->", "<p><a href=\"?set=dark" +
            ((req.headers['cookie'] && req.headers['cookie'].includes('dark=1')) ? "0\">Wy" : "1\">W") +
            "łącz ciemny kolor</a>")
        .replace("<!--MOBILE-LINK-->", "<p><a href=\"?set=mobile" +
            ((req.headers['cookie'] && req.headers['cookie'].includes('mobile=1')) ? "0\">Wy" : "1\">W") +
            "łącz mobile</a>")
        .replace("<!--JS-->", getFileContentSync('\\internal\\js.txt'));

    if (userName == "") {
        const session = crypto.randomBytes(32).toString('base64');
        nonLogged.push(session);
        return text.replace("<!--LOGIN-LOGOUT-->", getFileContentSync('\\internal\\login.txt'))
            .replace("<!--HASH-->", session);
    } else {
        return text.replace("<!--ID-USER-->", cacheUsers[userName][0])
            .replace("<!--LOGIN-LOGOUT-->", getFileContentSync('\\internal\\logout' +
                    (cacheUsers[userName][1]["Type"] == "google" ? "google" : "") + '.txt')
                .replace(/<!--SIGN-IN-TOKEN-->/g, GoogleSignInToken));
    }
}

function verifyMail2(req, res, params, id, userName, userLevel) {
    found = false;
    verifyToken.forEach(function(session) {
        console.log("sprawdza " + session[1] + " " + session[2] + " " + Date.now());
        if (session[2] < Date.now()) {
            return;
        }
        console.log("porównuje " + id[1] + " " + session[0]);
        if (id[1] == decodeURIComponent(session[0])) {
            console.log("sprawdza typ");
            if (!cacheUsers[session[1]][1]["Type"] || cacheUsers[session[1]][1]["Type"] == "wlasny") {
                console.log("typ ok");
                console.log(cacheUsers[session[1]][1]["ConfirmMail"]);
                if (cacheUsers[session[1]][1]["ConfirmMail"] == 0) {
                    console.log("confirm ok");
                    salt = crypto.randomBytes(32).toString('base64');
                    session[3] = salt;
                    found = true;
                }
            }
        }
    });

    if (!found) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    var text = genericReplace(req, res, getFileContentSync('\\internal\\verify.txt'), userName).
    replace("<!--HASH-->", salt);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
        res.setHeader('Content-Encoding', 'deflate');
        res.end(zlib.deflateSync(text));
    } else {
        res.end(text);
    }
}

function addRadio(idname, value, checked) {
    return "<input type=\"radio\" name=\"" + idname + "\" id=" + idname + " value=\"" + value + "\"" +
        (checked ? " checked" : "") + "><label for=\"" + idname + "\">" + value + "</label>";
}

function addOption(idnamevalue, selected) {
    return "<option value=\"" + idnamevalue + "\"" + (selected ? " selected" : "") + ">" + idnamevalue + "</option>";
}

function addUserLink(name) {
    return "<a href=?q=profil/pokaz/" + cacheUsers[name][0] + ">" + name + "</a>";
}

function zmienDodajUser(req, res, params, userName, userLevel) {
    var text = genericReplace(req, res, getFileContentSync('\\internal\\useredit.txt'), userName);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
        res.setHeader('Content-Encoding', 'deflate');
        res.end(zlib.deflateSync(text));
    } else {
        res.end(text);
    }
}

function zmienDodajUserGoogle(req, res, params, userName, userLevel) {
    var text = genericReplace(req, res, getFileContentSync('\\internal\\logingoogle.txt'), userName)
        .replace("<!--SIGN-IN-TOKEN-->", GoogleSignInToken);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
        res.setHeader('Content-Encoding', 'deflate');
        res.end(zlib.deflateSync(text));
    } else {
        res.end(text);
    }
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

    var text = genericReplace(req, res, getFileContentSync('\\internal\\entryedit.txt'), userName)
        .replace("<!--RODZAJ-->", id[1]);
    if (id[2]) {
        text = text.replace("<!--TEXT-->", arr["Text"])
            .replace(/<!--TITLE-->/g, arr["Title"]) //many entries
            .replace(/<!--PAGEID-->/g, id[2]); //many entries
    } else {
        text = text.replace(/<!--TITLE-->/g, "") //many entries
            .replace(/<!--PAGEID-->/g, "0"); //many entries
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
        txt += addOption(tax, (id[2] && arr["Taxonomy"] && arr["Taxonomy"].split(",").includes(tax)));
    });
    text = text.replace("<!--TAXONOMY-->", txt + "</select><p>");

    if (userLevel == "2") {
        txt = "<select id=\"specialtaxonomy\" name=\"specialtaxonomy\" size=5 multiple>";
        specialTaxonomy.forEach(function(tax) {
            txt += addOption(tax, (id[2] && arr["SpecialTaxonomy"] && arr["SpecialTaxonomy"].split(",").includes(tax)));
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

function pokazChat(req, res, params, id, userName) {
    if (userName == "") {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    readFileContentSync('\\chat\\' + id[1] + '.txt', (data) => {
        if (data == "") {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }

        var arr = decodeFileContent(data, true);

        if (arr["Author"] && !arr["Author"].split(",").includes(userName)) {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }

        res.statusCode = 200;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');

        var text = getFileContentSync('\\internal\\chat.txt');
        text = genericReplace(req, res, text, userName)
            .replace(/<!--TITLE-->/g, arr["Title"]); // multiple

        if (arr["Author"]) {
            txt = "";
            arr["Author"].split(",").forEach(function(autor) {
                txt += (txt != "" ? "," : "") + addUserLink(autor);
            });
            text = text.replace("<!--USERS-->", txt);
        }

        if (arr["Comments"]) {
            const template0 = getFileContentSync('\\internal\\comment.txt');
            var txt = "";
            arr["Comments"].reverse().forEach(function(comment) {
                txt += template0.replace("<!--USER-->", addUserLink(comment["Author"]))
                    .replace("<!--TITLE-->", comment["Title"])
                    .replace("<!--WHEN-->", formatDate(comment["When"]))
                    .replace("<!--TEXT-->", comment["Text"]);
            });
            text = text.replace("<!--COMMENTS-->", txt);
        }

        text = text.replace("<!--COMMENTEDIT-->", getFileContentSync('\\internal\\commentedit.txt'))
            .replace(/<!--PAGEID-->/g, '1') //many entries
            .replace("<!--OBJECT-->", "chat");

        if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
            res.setHeader('Content-Encoding', 'deflate');
            res.end(zlib.deflateSync(text));
        } else {
            res.end(text);
        }
    });
}

function getChatList(pageNum, userName) {
    var result = new Array();

    cacheChat.forEach((entry, key) => {
        if (!entry["Author"] || entry["Author"].split(",").includes(userName)) {
            console.log("jest2");
            result.push(entry);
        }
    });

    result.sort(function(a, b) {
        return (a["commentswhen"] == b["commentswhen"]) ? 0 : (a["commentswhen"] < b["commentswhen"] ? -1 : 1);
    });

    return new Array(result.slice(pageNum * onThePage, (pageNum + 1) * onThePage), result.length);
}

function formatChatEntry(template, arr) {
    template = template.replace("<!--TITLE-->",
        "<a href=\"?q=chat/pokaz/" + arr["filename"] + "\">" + arr["Title"] + "</a>");
    if (arr["commentsnum"] != "0") {
        template = template.replace("<!--COMMENTSWHEN-->", "(ostatni " + formatDate(arr["commentswhen"]) + ")");
    }
    if (arr["Author"]) {
        txt = "";
        arr["Author"].split(",").forEach(entry => {
            txt += (txt != "" ? ", " : "") + addUserLink(entry);
        });
        template = template.replace("<!--USER-->", txt);
    }
    return template.replace("<!--TYPE-->", arr["Type"])
        .replace("<!--COMMENTSNUM-->", arr["commentsnum"]);
}

// for example profil/pokaz/1
function pokazProfil(req, res, params, id, userName, userLevel) {
    readFileContentSync('\\uzytkownicy\\' + id[1] + '.txt', (data) => {
        if (data == "") {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }

        var arr = decodeFileContent(data, true);

        res.statusCode = 200;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');

        var text = getFileContentSync('\\internal\\user.txt');
        text = genericReplace(req, res, text, userName)
            .replace(/<!--TITLE-->/g, arr["Title"])
            .replace("<!--USER-->", arr["Author"]);


        const template = getFileContentSync('\\internal\\listentry.txt');

        const list = getChatList(0, userName);

        txt = "";
        if (list[0]) {
            list[0].forEach(function(arr) {
                txt += (txt != "" ? "<hr>" : "") + formatChatEntry(template, arr);
            });
        }
        text = text.replace("<!--CHAT-LIST-->", txt != "" ? "<div class=ramki>Ostatnie chaty</div><div class=ramki>" + txt + "</div>" : "");

        txt = "";
        for (var rodzaj in podstronyType) {
            console.log(rodzaj);
            const list = getPageList(0,
                podstronyType[rodzaj],
                (userName == "") ? new Array("biblioteka") : podstronyState[rodzaj],
                null,
                null,
                "ostatni",
                userName,
                userLevel);
            var t = "";
            if (list[0]) {
                list[0].forEach(function(arr) {
                    t += (t != "" ? "<hr>" : "") + formatListaEntry(template, arr);
                });
            }
            if (t != "") txt += "<div class=ramki>Ostatnie teksty - " + rodzaj + "</div><div class=ramki>" + t + "</div>";
        }
        text = text.replace("<!--TEXT-LIST-->", txt);

        if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
            res.setHeader('Content-Encoding', 'deflate');
            res.end(zlib.deflateSync(text));
        } else {
            res.end(text);
        }
    });
}

// for example opowiadania/pokaz/1
function pokazStrona(req, res, params, id, userName) {
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

        text = text.replace(/<!--TITLE-->/g, arr["Title"])
            .replace("<!--USER-->", addUserLink(arr["Author"]))
            .replace("<!--TEXT-->", arr["Text"])
            .replace("<!--TYPE-->", arr["Type"])
            .replace("<!--WHEN-->", formatDate(arr["When"]));

        var lu = arr["When"];
        if (arr["Comments"]) {
            const template0 = getFileContentSync('\\internal\\comment.txt');
            var txt = "";
            arr["Comments"].forEach(function(comment) {
                txt += template0.replace("<!--USER-->", addUserLink(comment["Author"]))
                    .replace("<!--TITLE-->", comment["Title"])
                    .replace("<!--WHEN-->", formatDate(comment["When"]))
                    .replace("<!--TEXT-->", comment["Text"]);
                lu = comment["When"];
            });
            text = text.replace("<!--COMMENTS-->", txt);
        }
        text = text.replace("<!--LASTUPDATE-->", formatDate(lu));

        if (userName != "") {
            text = text.replace("<!--COMMENTEDIT-->", getFileContentSync('\\internal\\commentedit.txt'))
                .replace(/<!--PAGEID-->/g, id[2]) //many entries
                .replace("<!--OBJECT-->", "teksty")
                .replace("<!--LOGIN-EDIT-->", "<div align=right><a href=\"?q=" +
                    params["q"].replace("pokaz", "zmien") + "\">Edycja</a></div>");
        }

        if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
            res.setHeader('Content-Encoding', 'deflate');
            res.end(zlib.deflateSync(text));
        } else {
            res.end(text);
        }
    });
}

function formatListaEntry(template, arr) {
    Object.keys(podstronyType).forEach(function(entry) {
        if (podstronyType[entry].includes(arr["Type"])) {
            template = template.replace("<!--TITLE-->",
                "<a href=\"?q=" + entry + "/pokaz/" + arr["filename"] + "\">" + arr["Title"] + "</a>");
        }
    });
    if (arr["commentsnum"] != "0") {
        template = template.replace("<!--COMMENTSWHEN-->", "(ostatni " + formatDate(arr["commentswhen"]) + ")");
    }
    return template.replace("<!--USER-->", addUserLink(arr["Author"]))
        .replace("<!--TYPE-->", arr["Type"])
        .replace("<!--COMMENTSNUM-->", arr["commentsnum"])
        .replace("<!--WHEN-->", formatDate(arr["When"]));
}

function pokazListaMain(req, res, page, params, userName) {
    var text = genericReplace(req, res, getFileContentSync('\\internal\\main.txt'), userName)
        .replace("<!--TITLE-->", "");

    const template = getFileContentSync('\\internal\\listentry.txt');

    const listGlue = getPageList(page,
        null,
        new Array("biblioteka"),
        null,
        "przyklejonegłówna",
        null,
        "ostatni",
        userName,
        "0");

    var txt = "";
    if (listGlue[0]) {
        listGlue[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListaEntry(template, arr);
        });
    }
    text = text.replace("<!--LIST-GLUE-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");

    const list = getPageList(page,
        null,
        new Array("biblioteka"),
        null,
        "główna",
        "przyklejonegłówna",
        "ostatni",
        userName,
        "0");

    txt = "";
    if (list[0]) {
        list[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListaEntry(template, arr);
        });
    }
    text = text.replace("<!--LIST-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");

    console.log("page num is " + page);
    text = text.replace("<!--PREVLINK-->", (page != 0) ?
            "<a href=\"?q=/" + (page - 1) + "\">&lt; Prev page</a>" : "")
        .replace("<!--NEXTLINK-->", ((page + 1) * onThePage < list[1]) ?
            "<a href=\"?q=/" + (page + 1) + "\">Next page &gt;</a>" : "");

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
        res.setHeader('Content-Encoding', 'deflate');
        res.end(zlib.deflateSync(text));
    } else {
        res.end(text);
    }
}

function buildURL(tekst, rodzaj, typ, status, page, sorttype, tax) {
    return "<a href=\"?q=" + rodzaj + "/" + typ + "/" + status +
        (page != 0 ? "/" + page : "") +
        (sorttype != "" ? "&s=" + sorttype : "") +
        (tax != "" ? "&t=" + tax : "") +
        "\">" + tekst + "</a>";
}

// rodzaj/typ/status
function pokazLista(req, res, params, id, userName, userLevel) {
    const rodzaj = id[1];
    const typ = id[2] ? id[2] : "";
    const status = id[3] ? id[3] : "";
    const sortLevel = params["s"] ? params["s"] : "";
    const tax = params["t"] ? params["t"] : "";

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

    const list = getPageList(pageNum,
        typ ? new Array(typ) : podstronyType[rodzaj],
        status ? new Array(status) : podstronyState[rodzaj],
        tax,
        null,
        "przyklejone",
        sortLevel == "" ? "ostatni" : sortLevel,
        userName,
        userLevel);

    if (pageNum * onThePage > list[1]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    res.statusCode = 200;
    res.setHeader('Cache-Control', 'must-revalidate');
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');

    var text = genericReplace(req, res, getFileContentSync('\\internal\\list.txt'), userName)
        .replace("<!--TITLE-->", "")
        .replace("<!--RODZAJ-->", rodzaj)
        .replace("<!--CRITERIA-->", getFileContentSync("\\internal\\criteria.txt"))
        .replace("<!--PREVLINK-->", (pageNum != 0) ?
            buildURL("&lt; Prev page", rodzaj, typ, status, (pageNum - 1), sortLevel, tax) : "")
        .replace("<!--NEXTLINK-->", ((pageNum + 1) * onThePage < list[1]) ?
            buildURL("Next page &gt;", rodzaj, typ, status, (pageNum + 1), sortLevel, tax) : "");

    if (userName != "") {
        text = text.replace("<!--LOGIN-NEW-->", "<div align=right><a href=\"?q=" + rodzaj + "/dodaj\">Nowy tekst</a></div>");
    }

    var num = 0;
    var txt = typ ? buildURL("wszystkie", rodzaj, "", status, pageNum, sortLevel, tax) : "<b>wszystkie</b>";
    podstronyType[rodzaj].forEach(function(t) {
        txt += (txt != "" ? " | " : "") +
            (typ == t ? "<b>" + t + "</b>" : buildURL(t, rodzaj, t, status, pageNum, sortLevel, tax));
        num++;
    });
    if (num != 1) text = text.replace("<!--TYPE-->", "<tr><td align=right>Rodzaj:</td><td>" + txt + "</td></tr>");

    num = 0;
    txt = status ? buildURL("wszystkie", rodzaj, typ, "", pageNum, sortLevel, tax) : "<b>wszystkie</b>";
    podstronyState[rodzaj].forEach(function(s) {
        if (userName == "" && s == "szkic") return;
        txt += (txt != "" ? " | " : "") +
            (status == s ? "<b>" + s + "</b>" : buildURL(s, rodzaj, typ, s, pageNum, sortLevel, tax));
        num++;
    });
    if (num != 1) text = text.replace("<!--STATE-->", "<tr><td align=right>Status:</td><td>" + txt + "</td></tr>");

    txt = tax ? buildURL("wszystkie", rodzaj, typ, status, pageNum, sortLevel, "") : "<b>wszystkie</b>";
    taxonomy.forEach(function(t) {
        txt += (txt != "" ? " | " : "") +
            (tax == t ? "<b>" + t + "</b>" : buildURL(t, rodzaj, typ, status, pageNum, sortLevel, t));
    });
    text = text.replace("<!--TAXONOMY-->", txt);

    txt = "";
    sortParam.forEach(function(s) {
        txt += (txt != "" ? " | " : "") +
            ((!sortLevel && s == "ostatni") || (sortLevel == s) ?
                "<b>" + s + "</b>" : buildURL(s, rodzaj, typ, status, pageNum, s, tax));
    });
    text = text.replace("<!--SORTBY-->", txt);

    const template = getFileContentSync('\\internal\\listentry.txt');

    const listGlue = getPageList(0,
        podstronyType[rodzaj],
        new Array("biblioteka"),
        null,
        "przyklejone",
        null,
        "ostatni",
        userName,
        userLevel);

    txt = "";
    if (listGlue[0]) {
        listGlue[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListaEntry(template, arr);
        });
    }
    text = text.replace("<!--LIST-GLUE-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");

    txt = "";
    if (list[0]) {
        list[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListaEntry(template, arr);
        });
    }
    text = text.replace("<!--LIST-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");

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
        res.setHeader('Content-Type', 'text/' +
            (req.url.includes('.js') ? 'javascript' : 'css') + '; charset=UTF-8');
        //        res.setHeader('Cache-Control', 'must-revalidate');
        //        res.setHeader('Last-Modified', 'Wed, 21 Oct 2015 07:28:00 GMT');
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
            var id = req.headers['referer'].match(/.*chat\/pokaz\/([0-9]+)$/);
            if (id && fs.existsSync(__dirname + "\\chat\\" + id[1] + ".txt")) {
                res.writeHead(200, {
                    'Cache-Control': 'no-cache',
                    'Content-Type': 'text/event-stream',
                    'Connection': 'keep-alive',
                });
                res.write("event: c\n");
                res.write("data: \n\n");

                const session = crypto.randomBytes(32).toString('base64');
                callbackChat[id[1]][session] = res;
                res.on('close', function() {
                    delete callbackChat[id[1]][session];
                });
                setTimeout(function() {
                    res.end();
                }, 60000); //60 seconds

                return;
            }
            var id = req.headers['referer'].match(/.*([a-ząż]+)\/pokaz\/([0-9]+)$/);
            if (id && fs.existsSync(__dirname + "\\teksty\\" + id[2] + ".txt")) {
                res.writeHead(200, {
                    'Cache-Control': 'no-cache',
                    'Content-Type': 'text/event-stream',
                    'Connection': 'keep-alive',
                });
                res.write("event: c\n");
                res.write("data: \n\n");

                const session = crypto.randomBytes(32).toString('base64');
                callbackText[id[2]][session] = res;
                res.on('close', function() {
                    delete callbackText[id[2]][session];
                });
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
            if (params["q"] == "newuser") {
                zmienDodajUser(req, res, params, userName, getUserLevelUserName(userName));
                return;
            }
            if (params["q"] == "logingoogle") {
                zmienDodajUserGoogle(req, res, params, userName, getUserLevelUserName(userName));
                return;
            }
            console.log(params["q"]);
            var id = params["q"].match(/^verifymail\/([A-Za-z0-9+\/=]+)$/);
            if (id) {
                console.log("ma match");
                verifyMail2(req, res, params, id, userName, getUserLevelUserName(userName));
                return;
            }
            console.log("nie ma match");
            var id = params["q"].match(/^chat\/pokaz\/([0-9]+)$/);
            if (id) {
                pokazChat(req, res, params, id, userName);
                return;
            }
            if (userName != "") {
                // for example opowiadania/zmien/1
                var id = params["q"].match(/^([a-ząż]+)\/zmien\/([0-9]+)$/);
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
            var id = params["q"].match(/^profil\/pokaz\/([0-9]+)$/);
            if (id) {
                pokazProfil(req, res, params, id, userName, getUserLevelUserName(userName));
                return;
            }
            // for example opowiadania/pokaz/1
            var id = params["q"].match(/^([a-ząż]+)\/pokaz\/([0-9]+)$/);
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

process.on('exit', function(code) {
    switch (code) {
        case 1:
            return console.log("Non unique nicknames");
        default:
            return;
    }
});

fs.readdirSync(__dirname + '\\teksty').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    addToCache(file.replace(".txt", ""));
})

fs.readdirSync(__dirname + '\\uzytkownicy').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    arr = decodeFileContent(readFileContentSync('\\uzytkownicy\\' + file), false);
    if (cacheUsers[arr["Author"]]) {
        process.exit(1); // duplicate user
    }
    cacheUsers[arr["Author"]] = new Array(file.replace(".txt", ""), arr);
})

fs.readdirSync(__dirname + '\\chat').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    cacheChat[file.replace(".txt", "")] = decodeFileContent(readFileContentSync('\\chat\\' + file), false);
    cacheChat[file.replace(".txt", "")]["filename"] = file.replace(".txt", "");
    callbackChat[file.replace(".txt", "")] = new Array();
})

//http.createServer(onRequestHandler).listen
http2.createSecureServer({
    key: fs.readFileSync(__dirname + '\\internal\\localhost-privkey.pem'),
    cert: fs.readFileSync(__dirname + '\\internal\\localhost-cert.pem')
}, onRequestHandler).listen(port, hostname, () => {
    console.log(`Server running at https://${hostname}:${port}/`);
});