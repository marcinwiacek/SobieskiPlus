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
var callbackOther = new Array();

var nonLogged = new Array();
var logged = new Array();
var verifyToken = new Array();
var remindToken = new Array();

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
                    if (x.length >= 2) {
                        // When we get Who for <!--change--> we can override author name
                        if (x[0] != "Who" || (x[0] == "Who" && !arr["Who"])) {
                            arr[x[0]] = line.substring(x[0].length + 1, line.length);
                        }
                    }
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

function addToTextCache(name) {
    cacheTexts[name] = decodeFileContent(readFileContentSync('\\teksty\\' + name + '.txt'), false);
    cacheTexts[name]["filename"] = name;
    callbackText[name] = new Array();
}

function addToChatCache(name, tekst) {
    console.log("cache chat " + name);
    cacheChat[name] = tekst;
    cacheChat[name]["filename"] = name;
    callbackChat[name] = new Array();
}

var months = new Array("Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec");

function formatDate(date) {
    const d = new Date(date);
    return ret = d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ' ' +
        (d.getHours() < 10 ? "0" : "") + d.getHours() + ':' +
        (d.getMinutes() < 10 ? "0" : "") + d.getMinutes() + ':' +
        (d.getSeconds() < 10 ? "0" : "") + d.getSeconds();
}

function getPageList(pageNum, typeList, stateList, taxonomy, specialtaxonomyplus, specialtaxonomyminus, sortLevel, userName, userLevel, forUser) {
    var result = new Array();
    const plus = specialtaxonomyplus ? specialtaxonomyplus.split(",") : null;
    const minus = specialtaxonomyminus ? specialtaxonomyminus.split(",") : null;
    const tax = taxonomy ? taxonomy.split(",") : null;

    cacheTexts.forEach((entry, key) => {
        if ((typeList && !typeList.includes(entry["Type"])) ||
            !stateList.includes(entry["State"]) ||
            (entry["State"] == "szkic" && userName != entry["Who"])) return;

        if (forUser && entry["Who"] != forUser) return;

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
            var x = a["Who"].localeCompare(b["Who"]);
            return (x == 0) ? (a["When"] > b["When"] ? -1 : 1) : x;
        });
    }

    if (specialtaxonomyplus && specialtaxonomyplus.includes("przyklejone")) {
        return new Array(result);
    } else {
        return new Array(result.slice(pageNum * onThePage, (pageNum + 1) * onThePage), result.length);
    }
}

function sendHTMLHead(res) {
    res.statusCode = 200;
    //    res.setHeader('Cache-Control', 'no-store');
    //  res.setHeader('Cache-Control', 'must-revalidate');
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
}

function sendHTMLBody(req, res, text) {
    if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
        res.setHeader('Content-Encoding', 'deflate');
        res.end(zlib.deflateSync(text));
    } else {
        res.end(text);
    }
}

function sendHTML(req, res, text) {
    sendHTMLHead(res);
    sendHTMLBody(req, res, text);
}

function updateComment(comment, res) {
    console.log("jest callback");

    const template = getFileContentSync('\\internal\\comment.txt')
        .replace("<!--USER-->", addUserLink(comment["Who"]))
        .replace("<!--WHEN-->", formatDate(comment["When"]))
        .replace("<!--TEXT-->", comment["Text"]);

    res.write("event: c\n");
    res.write("data: " + encodeURI(template) + "\n\n");
}

async function sendVerificationMail(mail, username) {
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

async function sendMailHaslo(mail, token) {
    let info = await smtp.sendMail({
        from: 'marcin@mwiacek.com',
        to: mail,
        subject: "Zmien haslo",
        text: "Link jest ważny przez godzinę: q=changepass/" + token +
            "\n Jeżeli straci ważność, spróbuj użyć funkcji przypominania i dostaniesz kolejny mail"
    });
    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
}

// chat or comment to the text
function parsePOSTUploadComment(params, req, res, userName, isChat) {
    const folder = isChat ? "chat" : "teksty";

    //checking for login
    //checking for correct filename protection
    if (fs.existsSync(__dirname + "\\" + folder + "\\" + params["tekst"] + ".txt")) {
        const t = Date.now();
        fs.appendFileSync(__dirname + "\\" + folder + "\\" + params["tekst"] + ".txt",
            "\n<!--comment-->\n" +
            "When:" + formatDate(t) + "\n" +
            "Who:" + userName + "\n\n" +
            params["comment"]
        );

        comment = new Array();
        comment["Who"] = userName;
        comment["When"] = t;
        comment["Text"] = params["comment"];

        if (isChat) {
            for (var index in callbackChat[params["tekst"]]) {
                updateComment(comment, callbackChat[params["tekst"]][index][0]);
            }
        } else {
            cacheTexts[params["tekst"]]["commentswhen"] = t;
            cacheTexts[params["tekst"]]["commentsnum"]++;

            for (var index in callbackText[params["tekst"]]) {
                updateComment(comment, callbackText[params["tekst"]][index][0]);
            }
        }
        res.statusCode = 200;
    } else {
        res.statusCode = 404;
    }
    res.setHeader('Content-Type', 'text/plain');
    res.end();
}

function parsePOSTUploadNewText(params, req, res, userName) {
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
                "Who:" + userName + "\n\n" +
                (params["teaser"] ? params["teaser"] + "\n<!--teaser-->\n" : "") +
                params["text"], 'utf8');
            addToTextCache(id);
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
}

function parsePOSTUploadUpdatedText(params, req, res, userName) {
    if (!params["text"] && !params["teaser"] && !params["state"] && !params["type"] &&
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

        if (params["teaser"] || params["text"]) {
            cacheTexts[params["tekst"]]["Text"] =
                (params["teaser"] ? params["teaser"] + "\n<!--teaser-->\n" :
                    (cacheTexts[params["tekst"]]["Text"].search('<!--teaser-->') ?
                        cacheTexts[params["tekst"]]["Text"].substr(0, cacheTexts[params["tekst"]]["Text"].search('<!--teaser-->')) + "\n<!--teaser-->\n" :
                        "")) +
                (params["text"] ? params["text"] :
                    (cacheTexts[params["tekst"]]["Text"].search('<!--teaser-->') ?
                        cacheTexts[params["tekst"]]["Text"].substr(cacheTexts[params["tekst"]]["Text"].search('<!--teaser-->') + 13) :
                        cacheTexts[params["tekst"]]["Text"]));

            txt += "\n" + cacheTexts[params["tekst"]]["Text"];
        }

        fs.appendFileSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt",
            "\n<!--change-->\n" +
            "When:" + formatDate(t) + "\n" +
            "Who:" + userName + "\n" +
            txt
        );

        //update cache
        if (params["title"]) cacheTexts[params["tekst"]]["Title"] = params["title"];
        if (params["state"]) cacheTexts[params["tekst"]]["State"] = params["state"];
        if (params["type"]) cacheTexts[params["tekst"]]["Type"] = params["type"];
        if (params["taxonomy"]) cacheTexts[params["tekst"]]["Taxonomy"] = params["taxonomy"];
        if (params["specialtaxonomy"]) cacheTexts[params["tekst"]]["SpecialTaxonomy"] = params["specialtaxonomy"];
        cacheTexts[params["tekst"]]["When"] = t;
        cacheTexts[params["tekst"]]["Who"] = userName;
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end();
        return;
    }
}

function parsePOSTCreateChat(params, req, res, userName) {
    wrong = false;
    params["users"].split(',').forEach(function(user) {
        if (!cacheUsers[user]) {
            wrong = true;
        }
    });
    if (wrong) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end();
        return;
    }

    const txt = "Title:" + params["title"] + "\n" +
        "When:" + formatDate(Date.now()) + "\n" +
        "Who:" + params["users"] + "\n";
    var id = 1;
    while (1) {
        var fd;
        try {
            fd = fs.openSync(__dirname + "\\chat\\" + id + ".txt", 'wx');
            fs.appendFileSync(fd, txt, 'utf8');
            addToChatCache(id.toString(), decodeFileContent(txt, true));
            break;
        } catch (err) {
            id++;
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
        }
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end(id.toString());
}

function parsePOSTCreateUser(params, req, res, userName) {
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
            var txt = "Who:" + params["username"] + "\n" +
                (params["typ"] == "w" ? "Pass:" + params["pass"] + "\n" : "") +
                "Mail:" + params["mail"] + "\n" +
                "When:" + formatDate(Date.now()) + "\n" +
                (params["typ"] != "g" ? "ConfirmMail:0\n" : "") +
                (params["typ"] == "g" ? "Type:google\n" : "") +
                (id == 1 ? "Level:2\n" : "Level:1\n");
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
            sendVerificationMail(params["mail"], params["username"]);
        }
    }
    console.log(id);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end(id.toString());
}

function parsePOSTEditUser(params, req, res, userName) {
    if (params["typ"] != "g" && params["typ"] != "w") {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end();
        return;
    }
    var t = Date.now();
    var txt = "\n<!--change-->\n" +
        (params["typ"] == "w" && params["pass"] ? "Pass:" + params["pass"] + "\n" : "") +
        (params["typ"] == "g" ? "Type:google\n" : "Type:wlasny\n") +
        "Mail:" + params["mail"] + "\n" +
        "When:" + formatDate(t) + "\n";
    fs.appendFileSync(__dirname + "\\uzytkownicy\\" + cacheUsers[userName][0] + ".txt", txt);

    if (params["typ"] == "w" && params["pass"] != "") cacheUsers[userName][1]["Pass"] = params["pass"];
    cacheUsers[userName][1]["Type"] = (params["typ"] == "g" ? "google\n" : "wlasny");
    cacheUsers[userName][1]["Mail"] = params["mail"];
    cacheUsers[userName][1]["When"] = t;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end();
}

async function parsePOSTLogin(params, req, res, userName) {
    console.log("probuje login");
    var found = "-";
    fs.readdirSync(__dirname + '\\uzytkownicy').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
        if (found != "-") return;
        var arr = decodeFileContent(readFileContentSync('\\uzytkownicy\\' + file), false);
        nonLogged.forEach(function(session) {
            if (found != "-") return;
            if (!arr["Type"] || arr["Type"] == "wlasny") {
                usr = crypto.createHash('sha256').update(session + arr["Who"]).digest("hex");
                if (usr != params["user"]) return;
                pass = crypto.createHash('sha256').update(session + arr["Pass"]).digest("hex");
                if (pass != params["password"]) return;
                const salt = crypto.randomBytes(32).toString('base64');
                if (params["typ"] != "g" && arr["ConfirmMail"] == "0") {
                    sendVerificationMail(arr["Mail"], arr["Who"]);
                    found = "Konto niezweryfikowane. Kliknij na link w mailu";
                } else {
                    logged.push(new Array(salt, arr["Who"], file));
                    console.log("jest login");
                    res.setHeader('Set-Cookie', 'login=' + salt);
                    found = "";
                }
            }
        });
    });

    res.statusCode = (found == "") ? 200 : 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end(found);
}

async function parsePOSTGoogleLogin(params, req, res, userName) {
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
                logged.push(new Array(salt, arr["Who"], file, params["id"]));
                console.log("jest login2");
                res.setHeader('Set-Cookie', 'login=' + salt);
                found = true;
            }
        });
    });

    res.statusCode = found ? 200 : 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end();
}

async function parsePOSTRemind(params, req, res, userName) {
    found = false;
    remindToken.forEach(function(session) {
        if (found) return;
        if (session[1] < Date.now()) {
            return;
        }
        fs.readdirSync(__dirname + '\\uzytkownicy').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
            if (found) return;
            var arr = decodeFileContent(readFileContentSync('\\uzytkownicy\\' + file), false);
            usr = crypto.createHash('sha256').update(session[0] + arr["Who"]).digest("hex");
            if (usr != params["token1"]) return;
            pass = crypto.createHash('sha256').update(session[0] + arr["Mail"]).digest("hex");
            if (pass != params["token2"]) return;

            session[2] = encodeURIComponent(crypto.randomBytes(32).toString('base64'));
            session[3] = arr["Who"];
            session[4] = file;
            sendMailHaslo(arr["Mail"], session[2]);
            found = true;
        });
    });

    res.statusCode = found ? 200 : 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end();
}

function parsePOSTChangePass(params, req, res, userName) {
    found = false;
    remindToken.forEach(function(session) {
        console.log(session[1] + " " + Date.now());
        console.log(params["hash"] + " " + session[2]);
        if (found) return;
        if (session[1] < Date.now()) return;
        if (params["hash"] == session[2]) {
            fs.appendFileSync(__dirname + "\\uzytkownicy\\" + session[4],
                "\n<!--change-->\n" +
                "When:" + formatDate(Date.now()) + "\n" +
                "Pass:" + params["token"] + "\n"
            );
            cacheUsers[session[3]][1]["Pass"] = params["token"];
            found = true;
        }
    });
    res.statusCode = found ? 200 : 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end();
}

function parsePOSTVerifyMail(params, req, res, userName) {
    found = false;
    verifyToken.forEach(function(session) {
        if (found) return;
        if (session[2] < Date.now()) return;
        if (!cacheUsers[session[1]][1]["Type"] || cacheUsers[session[1]][1]["Type"] == "wlasny") {
            if (cacheUsers[session[1]][1]["ConfirmMail"] == "0") {
                token = crypto.createHash('sha256').update(session[3] + cacheUsers[session[1]][1]["Pass"]).digest("hex");
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
}

function parsePOSTLogout(params, req, res, userName) {
    res.setHeader('Set-Cookie', 'login=; expires=Sun, 21 Dec 1980 14:14:14 GMT');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    logged.forEach(function(cookieInfo, index) {
        if ("login=" + cookieInfo[0] == req.headers['cookie']) {
            logged.splice(index, 1);
        }
    });
    res.end();
}

async function parsePOSTforms(params, req, res, userName) {
    console.log(params);
    if (params["upload_comment"] && params["obj"] && params["tekst"] && params["comment"]) {
        if (params["obj"] == "chat") {
            parsePOSTUploadComment(params, req, res, userName, true);
            return;
        } else if (params["obj"] == "teksty") {
            parsePOSTUploadComment(params, req, res, userName, false);
            return;
        }
    } else if (params["upload_text"] && params["tekst"]) {
        if (params["tekst"] == "0") {
            parsePOSTUploadNewText(params, req, res, userName);
            return;
        }
        parsePOSTUploadUpdatedText(params, req, res, userName);
        return;
    } else if (params["new_chat"] && params["title"] && params["users"]) {
        parsePOSTCreateChat(params, req, res, userName);
        return;
    } else if (params["remind"] && params["token1"] && params["token2"]) {
        parsePOSTRemind(params, req, res, userName);
        return;
    } else if (params["changepass"] && params["hash"] && params["token"]) {
        parsePOSTChangePass(params, req, res, userName);
        return;
    } else if (params["verify"] && params["token"]) {
        parsePOSTVerifyMail(params, req, res, userName);
        return;
    } else if (params["new_user"] && params["username"] && params["typ"] && params["mail"]) {
        parsePOSTCreateUser(params, req, res, userName);
        return;
    } else if (params["edit_user"] && params["typ"] && params["mail"] && userName != "") {
        parsePOSTEditUser(params, req, res, userName);
        return;
    } else if (params["login"] && params["user"] && params["password"] && userName == "") {
        parsePOSTLogin(params, req, res, userName);
        return;
    } else if (enableGoogleWithToken && params["glogin"] && params["id"] && userName == "") {
        parsePOSTGoogleLogin(params, req, res, userName);
        return;
    } else if (params["logout"] && userName != "") {
        parsePOSTLogout(params, req, res, userName);
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

function showPassReminderPage(req, res, params, userName, userLevel) {
    var x = encodeURIComponent(crypto.randomBytes(32).toString('base64'));
    remindToken.push(new Array(x, Date.now() + 1000 * 60 * 60, "", "", ""));

    sendHTML(req, res, genericReplace(req, res, getFileContentSync('\\internal\\remind1.txt'), userName)
        .replace("<!--HASH-->", x));
}

function showChangePasswordPage(req, res, params, id, userName, userLevel) {
    found = false;
    remindToken.forEach(function(session) {
        if (session[1] < Date.now()) {
            return;
        }
        if (id[1] == decodeURIComponent(session[2])) {
            salt = crypto.randomBytes(32).toString('base64');
            session[2] = salt;
            found = true;
        }
    });

    if (!found) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    sendHTML(req, res, genericReplace(req, res, getFileContentSync('\\internal\\remind2.txt'), userName).replace("<!--HASH-->", salt));
}

function showMailVerifyPage(req, res, params, id, userName, userLevel) {
    found = false;
    verifyToken.forEach(function(session) {
        if (found) return;
        if (session[2] < Date.now()) return;
        if (id[1] == decodeURIComponent(session[0])) {
            if (!cacheUsers[session[1]][1]["Type"] || cacheUsers[session[1]][1]["Type"] == "wlasny") {
                console.log(cacheUsers[session[1]][1]["ConfirmMail"]);
                if (cacheUsers[session[1]][1]["ConfirmMail"] == 0) {
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

    sendHTML(req, res, genericReplace(req, res, getFileContentSync('\\internal\\verify.txt'), userName).replace("<!--HASH-->", salt));
}

function showAddChangeUserPage(req, res, params, userName, userLevel) {
    if (params["q"] == "profil/zmien" && userName == "") {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    var text = genericReplace(req, res, getFileContentSync('\\internal\\useredit.txt'), userName);

    if (params["q"] == "profil/zmien") {
        if (!cacheUsers[userName][1]["Type"] || cacheUsers[userName][1]["Type"] == "wlasny") {
            text = text.replace("<!--CHECKED-WLASNE-->", " checked")
                .replace("<!--CHECKED-GOOGLE-->", "");
        } else {
            text = text.replace("<!--CHECKED-WLASNE-->", "")
                .replace("<!--CHECKED-GOOGLE-->", " checked");
        }
        text = text.replace("<!--USER-PARAMS-->", " value=\"" + cacheUsers[userName][1]["Who"] + "\" placeholder=\"Cannot be empty\" readonly ")
            .replace("<!--MAIL-PARAMS-->", " value=\"" + cacheUsers[userName][1]["Mail"] + "\" placeholder=\"Cannot be empty\"")
            .replace(/<!--PASS-PARAMS-->/g, " placeholder=\"Leave empty if you don't want to change it\"")
            .replace(/<!--OPERATION-->/g, "edit_user");
    } else {
        text = text.replace("<!--CHECKED-WLASNE-->", " checked")
            .replace("<!--CHECKED-GOOGLE-->", "")
            .replace("<!--USER-PARAMS-->", " value=\"\" placeholder=\"Cannot be empty\"")
            .replace("<!--MAIL-PARAMS-->", " value=\"\" placeholder=\"Cannot be empty\"")
            .replace(/<!--PASS-PARAMS-->/g, " placeholder=\"Cannot be empty\"")
            .replace(/<!--OPERATION-->/g, "new_user");
    }

    sendHTML(req, res, text);
}

function loginGoogle(req, res, params, userName, userLevel) {
    sendHTML(req, res, genericReplace(req, res, getFileContentSync('\\internal\\logingoogle.txt'), userName)
        .replace("<!--SIGN-IN-TOKEN-->", GoogleSignInToken));
}

// for example opowiadania/dodaj
// for example opowiadania/zmien/1
function showAddChangeTextPage(req, res, params, id, userName, userLevel) {
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
        text = text.replace("<!--TEASER-->",
                (arr["Text"].search('<!--teaser-->') ?
                    arr["Text"].substr(0, arr["Text"].search('<!--teaser-->')) : ""))
            .replace("<!--TEXT-->",
                (arr["Text"].search('<!--teaser-->') ?
                    arr["Text"].substr(arr["Text"].search('<!--teaser-->') + 13) : arr["Text"]))
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

    sendHTML(req, res, text);
}

function showAddChatPage(req, res, params, userName) {
    if (userName == "") {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    var txt = "<select id=\"users\" name=\"users\" size=5 multiple>";
    for (var index in cacheUsers) {
        txt += addOption(cacheUsers[index][1]["Who"], cacheUsers[index][1]["Who"] == userName);
    }

    sendHTML(req, res, genericReplace(req, res, getFileContentSync('\\internal\\addchat.txt'), userName)
        .replace("<!--USERS-LIST-->", txt + "</select>"));
}

function showChatPage(req, res, params, id, userName) {
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

        if (arr["Who"] && !arr["Who"].split(",").includes(userName)) {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }

        sendHTMLHead(res);

        var text = getFileContentSync('\\internal\\chat.txt');
        text = genericReplace(req, res, text, userName)
            .replace(/<!--TITLE-->/g, arr["Title"]); // multiple

        if (arr["Who"]) {
            txt = "";
            arr["Who"].split(",").forEach(function(autor) {
                txt += (txt != "" ? "," : "") + addUserLink(autor);
            });
            text = text.replace("<!--USERS-->", txt);
        }

        if (arr["Comments"]) {
            const template0 = getFileContentSync('\\internal\\comment.txt');
            var txt = "";
            arr["Comments"].reverse().forEach(function(comment) {
                txt += template0.replace("<!--USER-->", addUserLink(comment["Who"]))
                    .replace("<!--WHEN-->", formatDate(comment["When"]))
                    .replace("<!--TEXT-->", comment["Text"]);
            });
            text = text.replace("<!--COMMENTS-->", txt);
        }

        sendHTMLBody(req, res, text.replace("<!--COMMENTEDIT-->", getFileContentSync('\\internal\\commentedit.txt'))
            .replace(/<!--PAGEID-->/g, id[1]) //many entries
            .replace("<!--OBJECT-->", "chat"));
    });
}

function getChatList(pageNum, userName) {
    var result = new Array();

    cacheChat.forEach((entry, key) => {
        if (!entry["Who"] || entry["Who"].split(",").includes(userName)) {
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
    if (arr["Who"]) {
        txt = "";
        arr["Who"].split(",").forEach(entry => {
            txt += (txt != "" ? ", " : "") + addUserLink(entry);
        });
        template = template.replace("<!--USER-->", txt);
    }
    return template.replace("<!--TYPE-->", "")
        .replace("<!--COMMENTSNUM-->", arr["commentsnum"]);
}

// for example profil/pokaz/1
function showProfilePage(req, res, params, id, userName, userLevel) {
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
            .replace(/<!--TITLE-->/g, arr["Who"])
            .replace("<!--USER-->", arr["Who"]);

        if (userName == arr["Who"]) {
            text = text.replace("<!--USER-EDIT-->", "<a href=?q=profil/zmien>Edycja</a>");
        }
        if (userName != "") {
            text = text.replace("<!--ADD-CHAT-->", "<a href=?q=chat/dodaj>Dodaj</a>");
        }

        const template = getFileContentSync('\\internal\\listentry.txt');

        const list = getChatList(0, userName);
        txt = "";
        if (list[0]) {
            list[0].forEach(function(arr) {
                txt += (txt != "" ? "<hr>" : "") + formatChatEntry(template, arr);
            });
        }
        text = text.replace("<!--CHAT-LIST-->", txt != "" ? "<hr>" + txt : "");

        txt = "";
        new Array(new Array("biblioteka"),
            (userName == "") ? new Array("beta", "poczekalnia") : new Array("beta", "poczekalnia", "szkic")).forEach(function(type) {
            for (var rodzaj in podstronyType) {
                const list = getPageList(0,
                    podstronyType[rodzaj], type,
                    null,
                    null, null,
                    "ostatni",
                    userName, userLevel,
                    arr["Who"]);
                var t = "";
                if (list[0]) {
                    list[0].forEach(function(arr) {
                        t += (t != "" ? "<hr>" : "") + formatListaEntry(template, arr);
                    });
                }
                if (t != "") {
                    txt += "<div class=ramki>Ostatnie teksty (";
                    type.forEach(function(typ) {
                        txt += typ + " ";
                    });
                    txt += ") - " + rodzaj + "<hr>" + t + "</div>";
                }
            }
        });

        sendHTMLBody(req, res, text.replace("<!--TEXT-LIST-->", txt));
    });
}

// for example opowiadania/pokaz/1
function showTextPage(req, res, params, id, userName) {
    if (!podstronyType[id[1]]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    readFileContentSync('\\teksty\\' + id[2] + '.txt', (data) => {
        var arr = decodeFileContent(data, true);
        if (!podstronyType[id[1]].includes(arr["Type"]) || (arr["State"] == "szkic" && userName != arr["Who"])) {
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
            .replace("<!--USER-->", addUserLink(arr["Who"]))
            .replace("<!--TEASER-->",
                (arr["Text"].search('<!--teaser-->') ?
                    arr["Text"].substr(0, arr["Text"].search('<!--teaser-->')) : ""))
            .replace("<!--TEXT-->",
                (arr["Text"].search('<!--teaser-->') ?
                    arr["Text"].substr(arr["Text"].search('<!--teaser-->') + 13) : arr["Text"]))
            .replace("<!--TYPE-->", arr["Type"])
            .replace("<!--WHEN-->", formatDate(arr["When"]));

        var lu = arr["When"];
        if (arr["Comments"]) {
            const template0 = getFileContentSync('\\internal\\comment.txt');
            var txt = "";
            arr["Comments"].forEach(function(comment) {
                txt += template0.replace("<!--USER-->", addUserLink(comment["Who"]))
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

        sendHTMLBody(req, res, text);
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
    return template.replace("<!--USER-->", addUserLink(arr["Who"]))
        .replace("<!--TYPE-->", arr["Type"])
        .replace("<!--COMMENTSNUM-->", arr["commentsnum"])
        .replace("<!--WHEN-->", formatDate(arr["When"]));
}

function showMainPage(req, res, page, params, userName) {
    var text = genericReplace(req, res, getFileContentSync('\\internal\\main.txt'), userName)
        .replace("<!--TITLE-->", "");

    const template = getFileContentSync('\\internal\\listentry.txt');

    const listGlue = getPageList(page,
        null, new Array("biblioteka"),
        null,
        "przyklejonegłówna", null,
        "ostatni",
        userName, "0",
        null);

    var txt = "";
    if (listGlue[0]) {
        listGlue[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListaEntry(template, arr);
        });
    }
    text = text.replace("<!--LIST-GLUE-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");

    const list = getPageList(page,
        null,
        new Array("biblioteka"), null,
        "główna", "przyklejonegłówna",
        "ostatni",
        userName, "0",
        null);

    txt = "";
    if (list[0]) {
        list[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListaEntry(template, arr);
        });
    }
    text = text.replace("<!--LIST-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "")
        .replace("<!--PREVLINK-->", (page != 0) ?
            "<a href=\"?q=/" + (page - 1) + "\">&lt; Prev page</a>" : "")
        .replace("<!--NEXTLINK-->", ((page + 1) * onThePage < list[1]) ?
            "<a href=\"?q=/" + (page + 1) + "\">Next page &gt;</a>" : "");

    sendHTML(req, res, text);
}

function buildURL(tekst, rodzaj, typ, status, page, sorttype, tax) {
    return "<a href=\"?q=" + rodzaj + "/" + typ + "/" + status +
        (page != 0 ? "/" + page : "") +
        (sorttype != "" ? "&s=" + sorttype : "") +
        (tax != "" ? "&t=" + tax : "") +
        "\">" + tekst + "</a>";
}

// rodzaj/typ/status
function showListPage(req, res, params, id, userName, userLevel) {
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
        typ ? new Array(typ) : podstronyType[rodzaj], status ? new Array(status) : podstronyState[rodzaj],
        tax,
        null, "przyklejone",
        sortLevel == "" ? "ostatni" : sortLevel,
        userName, userLevel,
        null);

    if (pageNum * onThePage > list[1]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    sendHTMLHead(res);

    var text = genericReplace(req, res, getFileContentSync('\\internal\\list.txt'), userName)
        .replace("<!--TITLE-->", rodzaj + (typ != "" ? "/" + typ : "") + (status != "" ? "/" + status : ""))
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
        podstronyType[rodzaj], new Array("biblioteka"),
        null,
        "przyklejone", null,
        "ostatni",
        userName, userLevel,
        null);

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

    sendHTMLBody(req, res, text.replace("<!--LIST-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : ""));
}

function addToCallback(res, id, arra, userName) {
    res.writeHead(200, {
        'Cache-Control': 'no-cache',
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
    });
    res.write("event: c\n");
    res.write("data: \n\n");
    console.log("dodaje callback");
    const session = crypto.randomBytes(32).toString('base64');
    arra[id][session] = new Array(res, userName);
    res.on('close', function() {
        console.log("usuwa callback");
        delete arra[id][session];
    });
    setTimeout(function() {
        res.end();
    }, 60000); //60 seconds
}

const onRequestHandler = (req, res) => {
    if (req.url == "/external/styles.css" || req.url == "/external/dark.css" || req.url == "/external/sha256.js" ||
        req.url == "/external/suneditor.min.css" || req.url == "/external/suneditor.min.js") {
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
    } else if (req.url == "/favicon.ico") {
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
                addToCallback(res, id[1], callbackChat, userName);
                return;
            }
            var id = req.headers['referer'].match(/.*([a-ząż]+)\/pokaz\/([0-9]+)$/);
            if (id && fs.existsSync(__dirname + "\\teksty\\" + id[2] + ".txt")) {
                addToCallback(res, id[2], callbackText, userName);
                return;
            }
            addToCallback(res, id[1], callbackOther, userName);
            return;
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
                if (params["q"] == "profil/zmien") {
                    showAddChangeUserPage(req, res, params, userName, getUserLevelUserName(userName));
                    return;
                } else if (params["q"] == "chat/dodaj") {
                    showAddChatPage(req, res, params, userName);
                    return;
                }
                var id = params["q"].match(/^chat\/pokaz\/([0-9]+)$/);
                if (id) {
                    showChatPage(req, res, params, id, userName);
                    return;
                }
                // for example opowiadania/dodaj
                id = params["q"].match(/^([a-ząż]+)\/dodaj$/);
                if (id) {
                    showAddChangeTextPage(req, res, params, id, userName, getUserLevelUserName(userName));
                    return;
                }
                // for example opowiadania/zmien/1
                id = params["q"].match(/^([a-ząż]+)\/zmien\/([0-9]+)$/);
                if (id) {
                    showAddChangeTextPage(req, res, params, id, userName, getUserLevelUserName(userName));
                    return;
                }
            }
            if (params["q"] == "profil/dodaj") {
                showAddChangeUserPage(req, res, params, userName, getUserLevelUserName(userName));
                return;
            } else if (params["q"] == "logingoogle") {
                loginGoogle(req, res, params, userName, getUserLevelUserName(userName));
                return;
            } else if (params["q"] == "haslo/zmien/1") {
                showPassReminderPage(req, res, params, userName, getUserLevelUserName(userName));
                return;
            }
            var id = params["q"].match(/^changepass\/([A-Za-z0-9+\/=]+)$/);
            if (id) {
                showChangePasswordPage(req, res, params, id, userName, getUserLevelUserName(userName));
                return;
            }
            var id = params["q"].match(/^verifymail\/([A-Za-z0-9+\/=]+)$/);
            if (id) {
                showMailVerifyPage(req, res, params, id, userName, getUserLevelUserName(userName));
                return;
            }
            id = params["q"].match(/^profil\/pokaz\/([0-9]+)$/);
            if (id) {
                showProfilePage(req, res, params, id, userName, getUserLevelUserName(userName));
                return;
            }
            // for example opowiadania/pokaz/1
            id = params["q"].match(/^([a-ząż]+)\/pokaz\/([0-9]+)$/);
            if (id) {
                showTextPage(req, res, params, id, userName);
                return;
            }
            // lista - for example opowiadania//biblioteka/1
            id = params["q"].match(/^([a-ząż]+)\/([a-złąż]+)?\/([a-z]+)?(\/{1,1}[0-9]*)?$/);
            if (id) {
                showListPage(req, res, params, id, userName, getUserLevelUserName(userName));
                return;
            }
            // main page with page number
            id = params["q"].match(/^(\/{1,1}[0-9]*)?$/);
            if (id) {
                showMainPage(req, res, parseInt(id[1].substring(1)), params, userName);
                return;
            }
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }
        showMainPage(req, res, 0, new Array(), userName);
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

if (!fs.existsSync(__dirname + '\\teksty')) fs.mkdirSync(__dirname + '\\teksty');
fs.readdirSync(__dirname + '\\teksty').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    addToTextCache(file.replace(".txt", ""));
})

if (!fs.existsSync(__dirname + '\\uzytkownicy')) fs.mkdirSync(__dirname + '\\uzytkownicy');
fs.readdirSync(__dirname + '\\uzytkownicy').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    arr = decodeFileContent(readFileContentSync('\\uzytkownicy\\' + file), false);
    if (cacheUsers[arr["Who"]]) {
        process.exit(1); // duplicate user
    }
    cacheUsers[arr["Who"]] = new Array(file.replace(".txt", ""), arr);
})

if (!fs.existsSync(__dirname + '\\chat')) fs.mkdirSync(__dirname + '\\chat');
fs.readdirSync(__dirname + '\\chat').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    addToChatCache(file.replace(".txt", ""), decodeFileContent(readFileContentSync('\\chat\\' + file), false));
})

//http.createServer(onRequestHandler).listen
http2.createSecureServer({
    key: fs.readFileSync(__dirname + '\\internal\\localhost-privkey.pem'),
    cert: fs.readFileSync(__dirname + '\\internal\\localhost-cert.pem')
}, onRequestHandler).listen(port, hostname, () => {
    console.log(`Server running at https://${hostname}:${port}/`);
});