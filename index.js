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

let smtp = "";
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

const months = ["Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let cacheID = 1; //ID for new files - cache
let cacheTexts = [];
let cacheUsers = [];
let cacheFiles = [];
let cacheChat = [];

let callbackChat = [];
let callbackText = [];
let callbackOther = [];

let verifyToken = [];
let remindToken = [];
let sessions = [];

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
        let x = fs.readFileSync(path.normalize(__dirname + fileName), 'utf8');
        if (x.charCodeAt(0) == 65279) x = x.substring(1);
        return x;
    }
}

function getFileContentSync(fileName) {
    if (!cacheFiles[fileName]) {
        let t = readFileContentSync(fileName.replace("_gzip", "").replace("_deflate", ""));
        // CAN'T USE // comments in JS !!!! Use /* */ instead.
        //        t = t.replace(/(\r\n|\n|\r)/gm, "");
        if (fileName.includes("_gzip")) {
            cacheFiles[fileName] = zlib.gzipSync(t);
        } else if (fileName.includes("_deflate")) {
            cacheFiles[fileName] = zlib.deflateSync(t);
        } else {
            cacheFiles[fileName] = t;
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

//fields starting from big char are read from memory
function decodeFileContent(txt, onlyHeaders) {
    let arr = [];
    let level = DecodingLevel.MainHeaders;
    let comment = null;
    arr["commentsnum"] = 0; // for cache we don't want comments in memory; just number
    arr["commentswhen"] = 0; // for cache we don't want comments in memory; just number
    let t = "";
    txt.split(/\r?\n/).forEach(function(line) {
        if (line == "<!--comment-->") {
            if (comment != null) {
                if (!arr["Comments"]) arr["Comments"] = [];
                comment["When"] = Date.parse(comment["When"]);
                if (!onlyHeaders) arr["Comments"].push(comment);
                arr["commentsnum"]++;
                arr["commentswhen"] = comment["When"];
            }
            level = DecodingLevel.CommentHeaders;
            comment = [];
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
                    if (!onlyHeaders && t != "") {
                        if (!arr["OldText"]) arr["OldText"] = [];
                        let oldtext = [];
                        oldtext["Text"] = t;
                        oldtext["When"] = Date.parse(arr["When"]);
                        arr["OldText"].push(oldtext);
                        t = "";
                    }
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
                if (!onlyHeaders && line != "") t += line + "\n";
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
                if (!onlyHeaders) comment["Text"] += line + "\n";
                break;
        }
    });
    if (comment != null) {
        if (!arr["Comments"]) arr["Comments"] = [];
        comment["When"] = Date.parse(comment["When"]);
        if (!onlyHeaders) arr["Comments"].push(comment);
        arr["commentsnum"]++;
        arr["commentswhen"] = comment["When"];
    }
    arr["When"] = Date.parse(arr["When"]);

    if (t != "") {
        if (!arr["OldText"]) arr["OldText"] = [];
        let oldtext = [];
        oldtext["Text"] = t;
        oldtext["When"] = arr["When"];
        arr["OldText"].push(oldtext);
    }

    return arr;
}

function addToTextCache(name) {
    cacheTexts[name] = decodeFileContent(readFileContentSync('\\texts\\' + name + '.txt'), true);
    cacheTexts[name]["filename"] = name;
    callbackText[name] = [];
}

function addToChatCache(name, tekst) {
    cacheChat[name] = tekst;
    cacheChat[name]["filename"] = name;
    callbackChat[name] = [];
}

function formatDate(date) {
    const d = new Date(date);
    return ret = d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ' ' +
        (d.getHours() < 10 ? "0" : "") + d.getHours() + ':' +
        (d.getMinutes() < 10 ? "0" : "") + d.getMinutes() + ':' +
        (d.getSeconds() < 10 ? "0" : "") + d.getSeconds();
}

function getPageList(pageNum, typeList, stateList, taxonomy, specialtaxonomyplus, specialtaxonomyminus, sortLevel, userName, userLevel, forUser) {
    let result = [];
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
                let bad = false;
                tax.forEach(function(special) {
                    if (!entry["Taxonomy"].split(",").includes(special)) bad = true;
                });
                if (bad) return;
            }
        } else {
            if (tax) return;
        }

        if (entry["SpecialTaxonomy"]) {
            let bad = false;
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
            let x = a["Who"].localeCompare(b["Who"]);
            return (x == 0) ? (a["When"] > b["When"] ? -1 : 1) : x;
        });
    }

    if (specialtaxonomyplus && specialtaxonomyplus.includes("przyklejone")) {
        return [result];
    } else {
        return [result.slice(pageNum * onThePage, (pageNum + 1) * onThePage), result.length];
    }
}

function sendHTMLHead(res) {
    res.statusCode = 200;
    //    res.setHeader('Cache-Control', 'no-store');
    //  res.setHeader('Cache-Control', 'must-revalidate');
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
}

function sendHTMLBody(req, res, text) {
    //  if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('gzip')) {
    //      res.setHeader('Content-Encoding', 'gzip');
    //      res.end(zlib.gzipSync(text));
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

function sendReloadToPage(res) {
    res.write("event: r\n");
    res.write("data:\n\n");
}

// forcing pages reload after changing concrete text
// we refresh lists, main page and text page
function sendAllReloadsAfterTextChangeToPage(arr) {
    for (let index0 in callbackOther) {
        let found = false;
        //list page
        let id0 = index0.match(/^([a-ząż]+)\/([a-złąż]+)?\/([a-z]+)?(\/{1,1}[0-9]*)?$/);
        if (id0) {
            //it can be more granular            
            if (podstronyType[id0[1]].includes(arr["Type"])) found = true;
        } else {
            //it can be more granular            
            id0 = index0.match(/^(\/{1,1}[0-9]*)?$/);
            if (id0) found = true;
        }
        if (found) {
            for (let index in callbackOther[index0]) {
                sendReloadToPage(callbackOther[index0][index][0]);
            }
        }
    }
    for (let index in callbackText[arr["filename"]]) {
        sendReloadToPage(callbackText[arr["filename"]][index][0]);
    }
}

function sendCommentToPage(comment, res) {
    console.log("jest callback");

    const template = getFileContentSync('\\internal\\comment.txt')
        .replace("<!--USER-->", addUserLink(comment["Who"]))
        .replace("<!--WHEN-->", formatDate(comment["When"]))
        .replace("<!--TEXT-->", comment["Text"]);

    res.write("event: c\n");
    res.write("data: " + encodeURI(template) + "\n\n");
}

async function sendVerificationMail(mail, username) {
    let x = encodeURIComponent(crypto.randomBytes(32).toString('base64'));
    let info = await smtp.sendMail({
        from: 'marcin@mwiacek.com',
        to: mail,
        subject: "Zweryfikuj swoje konto w systemie",
        text: "Link jest ważny przez godzinę: q=verifymail/" + x +
            "\n Jeżeli straci ważność, spróbuj się zalogować i dostaniesz kolejny mail"
    });
    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
    verifyToken.push([x, username, Date.now() + 1000 * 60 * 60, ""]);
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
    const folder = isChat ? "chat" : "texts";

    //checking for login
    //checking for correct filename protection
    if (!fs.existsSync(__dirname + "\\" + folder + "\\" + params["tekst"] + ".txt")) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end();
        return;
    }

    const t = Date.now();
    fs.appendFileSync(__dirname + "\\" + folder + "\\" + params["tekst"] + ".txt",
        "<!--comment-->\n" +
        "When:" + formatDate(t) + "\n" +
        "Who:" + userName + "\n\n" +
        params["comment"] + "\n"
    );

    comment = [];
    comment["Who"] = userName;
    comment["When"] = t;
    comment["Text"] = params["comment"];

    if (isChat) {
        for (let index in callbackChat[params["tekst"]]) {
            sendCommentToPage(comment, callbackChat[params["tekst"]][index][0]);
        }

        //inform other users about new chat
        if (cacheChat[params["tekst"]]["Who"].split(',').includes(userName)) {
            console.log('jest chat1');
            for (let index0 in callbackOther) {
                console.log('jest chat2');
                for (let index in callbackOther[index0]) {
                    console.log('jest chat3: ' + callbackOther[index0][index][1] + ' ' + userName + ' ' + cacheChat[params["tekst"]]["Who"]);
                    if (callbackOther[index0][index][1] != userName &&
                        cacheChat[params["tekst"]]["Who"].split(',').includes(callbackOther[index0][index][1])) {
                        callbackOther[index0][index][0].write("event: m\n");
                        callbackOther[index0][index][0].write("data:\n\n");
                    }
                }
            }
        }
    } else {
        cacheTexts[params["tekst"]]["commentswhen"] = t;
        cacheTexts[params["tekst"]]["commentsnum"]++;

        for (let index in callbackText[params["tekst"]]) {
            sendCommentToPage(comment, callbackText[params["tekst"]][index][0]);
        }
    }
    res.statusCode = 200;
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
    let id = cacheID;
    while (1) {
        let fd;
        try {
            txt = "";
            if (params["taxonomy"]) txt += "Taxonomy:" + params["taxonomy"] + "\n";
            if (params["specialtaxonomy"]) txt += "SpecialTaxonomy:" + params["specialtaxonomy"] + "\n";

            fd = fs.openSync(__dirname + "\\texts\\" + id + ".txt", 'wx');
            fs.appendFileSync(fd,
                "Title:" + params["title"] + "\n" +
                "State:" + params["state"] + "\n" +
                "Type:" + params["type"] + "\n" +
                txt +
                "When:" + formatDate(Date.now()) + "\n" +
                "Who:" + userName + "\n\n" +
                (params["teaser"] ? params["teaser"] + "\n<!--teaser-->\n" : "") +
                params["text"] + "\n", 'utf8');
            addToTextCache(id);
            sendAllReloadsAfterTextChangeToPage(id);
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
    if (params["teaser"] || params["teaser"] == '') console.log('jest teaser1');
    if (params["teaser"]) console.log('jest teaser2');
    if (!params["version"] ||
        (!(params["teaser"] || params["teaser"] == '') &&
            !params["text"] && !params["state"] && !params["type"] &&
            !params["title"] && !params["taxonomy"] && !params["specialtaxonomy"])) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end();
        return;
    }
    if (fs.existsSync(__dirname + "\\texts\\" + params["tekst"] + ".txt")) {
        if (cacheTexts[params["tekst"]]["When"] != params["version"]) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain');
            res.end("Tekst był zmieniany w międzyczasie. Twoja wersja nie została zapisana!");
            return;
        }

        const t = Date.now();

        txt = "";
        if (params["title"]) txt += "Title:" + params["title"] + "\n";
        if (params["state"]) txt += "State:" + params["state"] + "\n";
        if (params["type"]) txt += "Type:" + params["type"] + "\n";
        if (params["taxonomy"]) txt += "Taxonomy:" + params["taxonomy"] + "\n";
        if (params["specialtaxonomy"]) txt += "SpecialTaxonomy:" + params["specialtaxonomy"] + "\n";
        if (params["teaser"] || params["teaser"] == '') {
            console.log("teaser we have");
            txt += (params["teaser"] != "" ? "\n" : "") + params["teaser"] + "\n<!--teaser-->\n";
        }
        if (params["text"]) {
            if (!(params["teaser"] || params["teaser"] == '')) txt += "\n";
            txt += params["text"] + "\n";
        }

        fs.appendFileSync(__dirname + "\\texts\\" + params["tekst"] + ".txt",
            "<!--change-->\n" +
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

        sendAllReloadsAfterTextChangeToPage(cacheTexts[params["tekst"]]);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end(t.toString());
        return;
    }
}

function parsePOSTCreateChat(params, req, res, userName) {
    wrong = false;
    params["users"].split(',').forEach(function(user) {
        if (!cacheUsers[user]) wrong = true;
    });
    if (wrong) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end();
        return;
    }

    const txt = "Title:" + params["title"] + "\n" +
        "When:" + formatDate(Date.now()) + "\n" +
        "Who:" + params["users"] + "," + userName + "\n" +
        "Sub:" + params["users"] + "," + userName + "\n";
    let id = 1;
    while (1) {
        let fd;
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

function parsePOSTSubscribeChat(params, req, res, userName) {
    wrong = false;
    params["users"].split(',').forEach(function(user) {
        if (!cacheUsers[user]) wrong = true;
    });
    if (wrong) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end();
        return;
    }

    const txt = "Title:" + params["title"] + "\n" +
        "When:" + formatDate(Date.now()) + "\n" +
        "Who:" + params["users"] + "," + userName + "\n" +
        "Sub:" + params["users"] + "," + userName + "\n";
    let id = 1;
    while (1) {
        let fd;
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

    let id = 1;
    while (1) {
        let fd;
        try {
            let txt = "Who:" + params["username"] + "\n" +
                (params["typ"] == "w" ? "Pass:" + params["pass"] + "\n" : "") +
                "Mail:" + params["mail"] + "\n" +
                "When:" + formatDate(Date.now()) + "\n" +
                (params["typ"] != "g" ? "ConfirmMail:0\n" : "") +
                (params["typ"] == "g" ? "Type:google\n" : "") +
                (id == 1 ? "Level:2\n" : "Level:1\n");
            fd = fs.openSync(__dirname + "\\users\\" + id + ".txt", 'wx');
            fs.appendFileSync(fd, txt, 'utf8');
            cacheUsers[params["username"]] = [id, decodeFileContent(txt, true)];
            break;
        } catch (err) {
            id++;
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
        }
    }
    if (params["typ"] != "g") {
        if (mailSupport) sendVerificationMail(params["mail"], params["username"]);
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
    let t = Date.now();
    let txt = "<!--change-->\n" +
        (params["typ"] == "w" && params["pass"] ? "Pass:" + params["pass"] + "\n" : "") +
        (params["typ"] == "g" ? "Type:google\n" : "Type:wlasny\n") +
        "Mail:" + params["mail"] + "\n" +
        "When:" + formatDate(t) + "\n";
    fs.appendFileSync(__dirname + "\\users\\" + cacheUsers[userName][0] + ".txt", txt);

    if (params["typ"] == "w" && params["pass"] != "") cacheUsers[userName][1]["Pass"] = params["pass"];
    cacheUsers[userName][1]["Type"] = (params["typ"] == "g" ? "google\n" : "wlasny");
    cacheUsers[userName][1]["Mail"] = params["mail"];
    cacheUsers[userName][1]["When"] = t;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end();
}

function tryOwnLogin(req, params, googleMail) {
    let found = null;
    for (let index in cacheUsers) {
        if (found) return;
        arr = cacheUsers[index][1];
        sessions.forEach(function(session, index) {
            if (found) return;
            if (session[1] < Date.now()) {
                if (session[4] != null) clearTimeout(session[4]);
                sessions.splice(index, 1);
                return;
            }
            req.headers['cookie'].split("; ").forEach(function(cookie) {
                if ("session=" + session[0] == cookie && session[2] == "") {
                    console.log("probuje sesje " + session[0]);
                    if (googleMail) {
                        console.log(googleMail + " vs " + arr["Mail"]);
                        //fixme check if verified
                        if (arr["Type"] == "google" && googleMail == arr["Mail"]) {
                            console.log("jest login");
                            session[2] = arr["Who"];
                            console.log("found");
                            found = "";
                        }
                    } else {
                        if (!arr["Type"] || arr["Type"] == "wlasny") {
                            usr = crypto.createHash('sha256').update(session[0] + arr["Who"]).digest("hex");
                            if (usr != params["user"]) return;
                            pass = crypto.createHash('sha256').update(session[0] + arr["Pass"]).digest("hex");
                            if (pass != params["password"]) return;
                            if (params["typ"] != "g" && arr["ConfirmMail"] == "0") {
                                sendVerificationMail(arr["Mail"], arr["Who"]);
                                found = "Konto niezweryfikowane. Kliknij na link w mailu";
                            } else {
                                console.log("jest login");
                                session[2] = arr["Who"];
                                found = "";
                            }
                        }
                    }
                }
            });
        });
    }
    return found;
}

async function parsePOSTLogin(params, req, res, userName) {
    console.log("probuje login");
    const found = tryOwnLogin(req, params, "");
    res.statusCode = (found == "") ? 200 : 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end(found);
}

async function parsePOSTGoogleLogin(params, req, res, userName) {
    // this is not preffered version according to Google, but good enough for this milestone
    const premise = new Promise((resolve, reject) => {
        https.get('https://oauth2.googleapis.com/tokeninfo?id_token=' + params["id"], (resp) => {
            let data = '';
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
    const found = tryOwnLogin(req, params, json.email);
    res.statusCode = (found == "") ? 200 : 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end(found);
}

function parsePOSTLogout(params, req, res, userName) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');

    console.log("logout try");
    sessions.forEach(function(session, index) {
        if (session[1] < Date.now()) {
            if (session[3] != null) clearTimeout(session[3]);
            sessions.splice(index, 1);
            return;
        }
        req.headers['cookie'].split("; ").forEach(function(cookie) {
            console.log("checking session " + session[0] + " " + cookie);
            if ("session=" + session[0] == cookie) {
                session[2] = '';
            }
        });
    });

    res.end();
}

async function parsePOSTRemind(params, req, res, userName) {
    found = false;
    remindToken.forEach(function(session, index) {
        if (found) return;
        if (session[1] < Date.now()) {
            remindToken.splice(index, 1);
            return;
        }
        for (let index in cacheUsers) {
            if (found) return;
            arr = cacheUsers[index][1];
            usr = crypto.createHash('sha256').update(session[0] + arr["Who"]).digest("hex");
            if (usr != params["token1"]) return;
            pass = crypto.createHash('sha256').update(session[0] + arr["Mail"]).digest("hex");
            if (pass != params["token2"]) return;

            session[2] = encodeURIComponent(crypto.randomBytes(32).toString('base64'));
            session[3] = arr["Who"];
            session[4] = file;
            sendMailHaslo(arr["Mail"], session[2]);
            found = true;

        }
    });

    res.statusCode = found ? 200 : 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end();
}

function parsePOSTChangePass(params, req, res, userName) {
    found = false;
    remindToken.forEach(function(session, index) {
        console.log(session[1] + " " + Date.now());
        console.log(params["hash"] + " " + session[2]);
        if (found) return;
        if (session[1] < Date.now()) {
            remindToken.splice(index, 1);
            return;
        }
        if (params["hash"] == session[2]) {
            fs.appendFileSync(__dirname + "\\users\\" + session[4],
                "<!--change-->\n" +
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
    verifyToken.forEach(function(session, index) {
        if (found) return;
        if (session[2] < Date.now()) {
            verifyToken.splice(index, 1);
            return;
        }
        if (!cacheUsers[session[1]][1]["Type"] || cacheUsers[session[1]][1]["Type"] == "wlasny") {
            if (cacheUsers[session[1]][1]["ConfirmMail"] == "0") {
                token = crypto.createHash('sha256').update(session[3] + cacheUsers[session[1]][1]["Pass"]).digest("hex");
                if (token != params["token"]) return;
                console.log("verified" + session[0]);
                fs.appendFileSync(__dirname + "\\users\\" + cacheUsers[session[1]][0] + ".txt",
                    "<!--change-->\n" +
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

async function parsePOSTforms(params, req, res, userName) {
    console.log(params);
    if (userName != "") {
        if (params["upload_comment"] && params["obj"] && params["tekst"] && params["comment"]) {
            if (params["obj"] == "chat") {
                parsePOSTUploadComment(params, req, res, userName, true);
                return;
            } else if (params["obj"] == "texts") {
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
        } else if (params["edit_user"] && params["typ"] && params["mail"]) {
            parsePOSTEditUser(params, req, res, userName);
            return;
        }
    } else { // UserName == ""
        if (params["login"] && params["user"] && params["password"]) {
            parsePOSTLogin(params, req, res, userName);
            return;
        } else if (enableGoogleWithToken && params["glogin"] && params["id"]) {
            parsePOSTGoogleLogin(params, req, res, userName);
            return;
        }
    }
    if (params["logout"]) {
        parsePOSTLogout(params, req, res, userName);
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
        .replace("<!--JSASYNC-->", getFileContentSync('\\internal\\jsasync.txt'));

    if (userName == "") {
        return text.replace("<!--LOGIN-LOGOUT-->", getFileContentSync('\\internal\\login.txt'));
    } else {
        return text.replace("<!--ID-USER-->", cacheUsers[userName][0])
            .replace("<!--LOGIN-LOGOUT-->", getFileContentSync('\\internal\\logout' +
                    (cacheUsers[userName][1]["Type"] == "google" ? "google" : "") + '.txt')
                .replace(/<!--SIGN-IN-TOKEN-->/g, GoogleSignInToken));
    }
}

function addRadio(idname, value, checked) {
    return "<input type=\"radio\" name=\"" + idname + "\" id=" + idname + value + " value=\"" + value + "\"" +
        (checked ? " checked" : "") + "><label for=\"" + idname + value + "\">" + value + "</label>";
}

function addOption(idnamevalue, selected) {
    return "<option value=\"" + idnamevalue + "\"" + (selected ? " selected" : "") + ">" + idnamevalue + "</option>";
}

function addUserLink(name) {
    return "<a href=\"?q=profil/pokaz/" + cacheUsers[name][0] + "\">" + name + "</a>";
}

function showPassReminderPage(req, res, params, userName, userLevel) {
    let x = encodeURIComponent(crypto.randomBytes(32).toString('base64'));
    remindToken.push([x, Date.now() + 1000 * 60 * 60, "", "", ""]);

    sendHTML(req, res, genericReplace(req, res, getFileContentSync('\\internal\\passremind.txt'), userName)
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

    sendHTML(req, res, genericReplace(req, res, getFileContentSync('\\internal\\passchange.txt'), userName).replace("<!--HASH-->", salt));
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

    sendHTML(req, res, genericReplace(req, res, getFileContentSync('\\internal\\verifymail.txt'), userName).replace("<!--HASH-->", salt));
}

function showLoginGooglePage(req, res, params, userName, userLevel) {
    sendHTML(req, res, genericReplace(req, res, getFileContentSync('\\internal\\logingoogle.txt'), userName)
        .replace("<!--SIGN-IN-TOKEN-->", GoogleSignInToken));
}

function showAddChatPage(req, res, params, userName) {
    if (userName == "") {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    let txt = "<select id=\"users\" name=\"users\" size=5 multiple>";
    for (let index in cacheUsers) {
        if (cacheUsers[index][1]["Who"] != userName) {
            txt += addOption(cacheUsers[index][1]["Who"], false);
        }
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

        let arr = decodeFileContent(data, false);

        if (arr["Who"] && !arr["Who"].split(",").includes(userName)) {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }

        sendHTMLHead(res);

        let text = genericReplace(req, res, getFileContentSync('\\internal\\chat.txt'), userName)
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
            let txt = "";
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
    let result = [];

    cacheChat.forEach((entry, key) => {
        if (!entry["Who"] || entry["Who"].split(",").includes(userName)) {
            result.push(entry);
        }
    });

    result.sort(function(a, b) {
        return (a["commentswhen"] == b["commentswhen"]) ? 0 : (a["commentswhen"] < b["commentswhen"] ? -1 : 1);
    });

    return [result.slice(pageNum * onThePage, (pageNum + 1) * onThePage), result.length];
}

function formatChatEntry(template, arr, userName) {
    template = template.replace("<!--TITLE-->",
        "<a href=\"?q=chat/pokaz/" + arr["filename"] + "\">" + arr["Title"] + "</a>");
    if (arr["commentsnum"] != "0") {
        template = template.replace("<!--COMMENTSWHEN-->", "(ostatni " + formatDate(arr["commentswhen"]) + ")");
    }
    //    template = template.replace("<!--SUB-->", "<a href=javascript:sub(" + arr["filename"] + "," +
    //        !arr["Sub"].split(",").includes(userName) + ");>" + (arr["Sub"].split(",").includes(userName) ? "on" : "off") + "</a>");
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

function showAddChangeProfilePage(req, res, params, userName, userLevel) {
    if (params["q"] == "profil/zmien" && userName == "") {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    sendHTMLHead(res);

    let text = genericReplace(req, res, getFileContentSync('\\internal\\useredit.txt'), userName);

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

    sendHTMLBody(req, res, text);
}

// for example profil/pokaz/1
function showProfilePage(req, res, params, id, userName, userLevel) {
    readFileContentSync('\\users\\' + id[1] + '.txt', (data) => {
        if (data == "") {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }

        let arr = decodeFileContent(data, false);

        sendHTMLHead(res);
        res.setHeader('Cache-Control', 'no-store');

        let text = genericReplace(req, res, getFileContentSync('\\internal\\user.txt'), userName)
            .replace(/<!--TITLE-->/g, arr["Who"])
            .replace("<!--USER-->", arr["Who"]);

        if (userName == arr["Who"]) {
            text = text.replace("<!--USER-EDIT-->", "<a href=\"?q=profil/zmien\">Edycja</a>");
        }

        const template = getFileContentSync('\\internal\\listentry.txt');

        if (userName != "") {
            const list = getChatList(0, userName);
            txt = "";
            if (list[0]) {
                list[0].forEach(function(arr) {
                    txt += (txt != "" ? "<hr>" : "") + formatChatEntry(template, arr, userName);
                });
            }
            text = text.replace("<!--CHAT-LIST-->", txt != "" ? "<div class=ramki><table width=100%>" +
                "<tr><td>" + (userName == arr["Who"] ? "Ostatnie chaty" : "Ostatnie chaty z Tobą") + "</td>" +
                "<td align=right><a href=\"?q=chat/dodaj\">Dodaj</a></td></tr></table><hr>" + txt + "</div>" : "");

        }
        txt = "";
        ((userName == "") ? ["beta", "poczekalnia"] : ["beta", "poczekalnia", "szkic"]).forEach(function(type) {
            for (let rodzaj in podstronyType) {
                const list = getPageList(0,
                    podstronyType[rodzaj], type,
                    null,
                    null, null,
                    "ostatni",
                    userName, userLevel,
                    arr["Who"]);
                let t = "";
                if (list[0]) {
                    list[0].forEach(function(arr) {
                        t += (t != "" ? "<hr>" : "") + formatListEntry(template, arr);
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

// for example opowiadania/dodaj
// for example opowiadania/zmien/1
function showAddChangeTextPage(req, res, params, id, userName, userLevel) {
    if (userLevel == "0" || !podstronyType[id[1]]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }
    let arr;
    if (id[2]) {
        arr = decodeFileContent(readFileContentSync('\\texts\\' + id[2] + '.txt'), false);
        if (!podstronyType[id[1]].includes(arr["Type"])) {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }
    }

    sendHTMLHead(res);

    let text = genericReplace(req, res, getFileContentSync('\\internal\\entryedit.txt'), userName)
        .replace("<!--RODZAJ-->", id[1]);
    if (id[2]) { //edit
        let teaser_text = "";
        let main_text = "";
        arr["OldText"].forEach(function(t0) {
            let t = t0["Text"].slice(0, -1);
            if (t.search('<!--teaser-->') != -1) teaser_text = t.substr(0, t.search('<!--teaser-->') - 1);
            let x = (t.search('<!--teaser-->') != -1 ? t.substr(t.search('<!--teaser-->') + 14) : t);
            if (x != "") main_text = x;
        });

        text = text.replace("<!--TEASER-->", teaser_text)
            .replace("<!--TEXT-->", main_text)
            .replace(/<!--TITLE-->/g, arr["Title"]) //many entries
            .replace("<!--VERSION-->", arr["When"])
            .replace(/<!--PAGEID-->/g, id[2]); //many entries
    } else { //new page
        text = text.replace(/<!--TITLE-->/g, "") //many entries
            .replace("<!--VERSION-->", 0)
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

    sendHTMLBody(req, res, text);
}

// for example opowiadania/pokaz/1
function showTextPage(req, res, params, id, userName) {
    if (!podstronyType[id[1]]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    readFileContentSync('\\texts\\' + id[2] + '.txt', (data) => {
        let arr = decodeFileContent(data, false);
        if (!podstronyType[id[1]].includes(arr["Type"]) || (arr["State"] == "szkic" && userName != arr["Who"])) {
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
        }

        sendHTMLHead(res);
        res.setHeader('Cache-Control', 'no-store');

        let teaser_text = "";
        let main_text = "";
        let when_first = 0;
        arr["OldText"].forEach(function(t0) {
            if (when_first == 0) when_first = t0["When"];
            let t = t0["Text"].slice(0, -1);
            if (t.search('<!--teaser-->') != -1) teaser_text = t.substr(0, t.search('<!--teaser-->') - 1);
            let x = (t.search('<!--teaser-->') != -1 ? t.substr(t.search('<!--teaser-->') + 14) : t);
            if (x != "") main_text = x;
        });

        let text = genericReplace(req, res, getFileContentSync('\\internal\\entry.txt'), userName)
            .replace(/<!--TITLE-->/g, arr["Title"])
            .replace("<!--USER-->", addUserLink(arr["Who"]))
            .replace("<!--TEASER-->", teaser_text)
            .replace("<!--TEXT-->", main_text)
            .replace("<!--TYPE-->", arr["Type"])
            .replace("<!--WHEN-->", formatDate(when_first))
            .replace("<!--WHEN2-->", (when_first != arr["When"] ? "Ostatnio zmienione: " + formatDate(arr["When"]) : ""));

        let lu = arr["When"];
        if (arr["Comments"]) {
            const template0 = getFileContentSync('\\internal\\comment.txt');
            let txt = "";
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
                .replace("<!--OBJECT-->", "texts")
                .replace("<!--LOGIN-EDIT-->", "<div align=right><a href=\"?q=" +
                    params["q"].replace("pokaz", "zmien") + "\">Edycja</a></div>");
        }

        sendHTMLBody(req, res, text);
    });
}

function formatListEntry(template, arr) {
    Object.keys(podstronyType).forEach(function(entry) {
        if (podstronyType[entry].includes(arr["Type"])) {
            template = template.replace("<!--TITLE-->",
                "<a href=\"?q=" + entry + "/pokaz/" + arr["filename"] + "\">" + arr["Title"] + "</a>");
        }
    });
    if (arr["commentsnum"] != "0") {
        template = template.replace("<!--COMMENTSWHEN-->", "(ostatni " + formatDate(arr["commentswhen"]) + ")");
    }
    let txt = "";
    if (arr["Taxonomy"]) {
        arr["Taxonomy"].split(",").forEach(function(tax) {
            if (txt != "") txt += ", ";
            txt += tax;
        });
    }
    return template.replace("<!--TAXONOMY-->", txt)
        .replace("<!--USER-->", addUserLink(arr["Who"]))
        .replace("<!--TYPE-->", arr["Type"])
        .replace("<!--COMMENTSNUM-->", arr["commentsnum"])
        .replace("<!--WHEN-->", formatDate(arr["When"]));
}

function showMainPage(req, res, page, params, userName) {
    sendHTMLHead(res);

    let text = genericReplace(req, res, getFileContentSync('\\internal\\main.txt'), userName)
        .replace("<!--TITLE-->", "");

    const template = getFileContentSync('\\internal\\listentry.txt');

    const listGlue = getPageList(page,
        null, ["biblioteka"],
        null,
        "przyklejonegłówna", null,
        "ostatni",
        userName, "0",
        null);

    let txt = "";
    if (listGlue[0]) {
        listGlue[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListEntry(template, arr);
        });
    }
    text = text.replace("<!--LIST-GLUE-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");

    const list = getPageList(page,
        null,
        ["biblioteka"], null,
        "główna", "przyklejonegłówna",
        "ostatni",
        userName, "0",
        null);

    txt = "";
    if (list[0]) {
        list[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListEntry(template, arr);
        });
    }
    text = text.replace("<!--LIST-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "")
        .replace("<!--PREVLINK-->", (page != 0) ?
            "<a href=\"?q=/" + (page - 1) + "\">&lt; Prev page</a>" : "")
        .replace("<!--NEXTLINK-->", ((page + 1) * onThePage < list[1]) ?
            "<a href=\"?q=/" + (page + 1) + "\">Next page &gt;</a>" : "");

    sendHTMLBody(req, res, text);
}

function buildURLForListPage(tekst, rodzaj, typ, status, page, sorttype, tax) {
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
        typ ? [typ] : podstronyType[rodzaj], status ? [status] : podstronyState[rodzaj],
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

    let text = genericReplace(req, res, getFileContentSync('\\internal\\list.txt'), userName)
        .replace("<!--TITLE-->", rodzaj + (typ != "" ? "/" + typ : "") + (status != "" ? "/" + status : ""))
        .replace("<!--RODZAJ-->", rodzaj)
        .replace("<!--CRITERIA-->", getFileContentSync("\\internal\\criteria.txt"))
        .replace("<!--PREVLINK-->", (pageNum != 0) ?
            buildURLForListPage("&lt; Prev page", rodzaj, typ, status, (pageNum - 1), sortLevel, tax) : "")
        .replace("<!--NEXTLINK-->", ((pageNum + 1) * onThePage < list[1]) ?
            buildURLForListPage("Next page &gt;", rodzaj, typ, status, (pageNum + 1), sortLevel, tax) : "");

    if (userName != "") {
        text = text.replace("<!--LOGIN-NEW-->", "<div align=right><a href=\"?q=" + rodzaj + "/dodaj\">Nowy tekst</a></div>");
    }

    let num = 0;
    let txt = typ ? buildURLForListPage("wszystkie", rodzaj, "", status, pageNum, sortLevel, tax) : "<b>wszystkie</b>";
    podstronyType[rodzaj].forEach(function(t) {
        txt += (txt != "" ? " | " : "") +
            (typ == t ? "<b>" + t + "</b>" : buildURLForListPage(t, rodzaj, t, status, pageNum, sortLevel, tax));
        num++;
    });
    if (num != 1) text = text.replace("<!--TYPE-->", "<tr><td align=right>Rodzaj:</td><td>" + txt + "</td></tr>");

    num = 0;
    txt = status ? buildURLForListPage("wszystkie", rodzaj, typ, "", pageNum, sortLevel, tax) : "<b>wszystkie</b>";
    podstronyState[rodzaj].forEach(function(s) {
        if (userName == "" && s == "szkic") return;
        txt += (txt != "" ? " | " : "") +
            (status == s ? "<b>" + s + "</b>" : buildURLForListPage(s, rodzaj, typ, s, pageNum, sortLevel, tax));
        num++;
    });
    if (num != 1) text = text.replace("<!--STATE-->", "<tr><td align=right>Status:</td><td>" + txt + "</td></tr>");

    txt = tax ? buildURLForListPage("wszystkie", rodzaj, typ, status, pageNum, sortLevel, "") : "<b>wszystkie</b>";
    taxonomy.forEach(function(t) {
        txt += (txt != "" ? " | " : "") +
            (tax == t ? "<b>" + t + "</b>" : buildURLForListPage(t, rodzaj, typ, status, pageNum, sortLevel, t));
    });
    text = text.replace("<!--TAXONOMY-->", txt);

    txt = "";
    sortParam.forEach(function(s) {
        txt += (txt != "" ? " | " : "") +
            ((!sortLevel && s == "ostatni") || (sortLevel == s) ?
                "<b>" + s + "</b>" : buildURLForListPage(s, rodzaj, typ, status, pageNum, s, tax));
    });
    text = text.replace("<!--SORTBY-->", txt);

    const template = getFileContentSync('\\internal\\listentry.txt');

    const listGlue = getPageList(0,
        podstronyType[rodzaj], ["biblioteka"],
        null,
        "przyklejone", null,
        "ostatni",
        userName, userLevel,
        null);

    txt = "";
    if (listGlue[0]) {
        listGlue[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListEntry(template, arr);
        });
    }
    text = text.replace("<!--LIST-GLUE-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");

    txt = "";
    if (list[0]) {
        list[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListEntry(template, arr);
        });
    }

    sendHTMLBody(req, res, text.replace("<!--LIST-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : ""));
}

function setRefreshSession(token, firstCall) {
    sessions.forEach(function(x, index) {
        if (x[0] == token) {
            if (x[3] != null) clearTimeout(x[3]);
            if (!firstCall) {
                newtoken = crypto.randomBytes(32).toString('base64');
                [callbackChat, callbackText, callbackOther].forEach(function(cc) {
                    for (let index0 in cc) {
                        for (let index in cc[index0]) {
                            if (cc[index0][index][2] == token) {
                                console.log("sending new token");
                                cc[index0][index][2] = newtoken;
                                cc[index0][index][0].write("event: s\n");
                                cc[index0][index][0].write("data: " + newtoken + "\n\n");
                            }
                        }
                    }
                });
            } else {
                newtoken = token;
            }
            console.log(token + " -> " + newtoken);
            x[0] = newtoken;
            x[3] = setTimeout(function() {
                setRefreshSession(newtoken, false);
            }, 30000); //30 seconds
            x[1] = Date.now() + 1000 * 50;
        }
    });
}

function addToCallback(req, res, id, arra, userName, other, token) {
    res.writeHead(200, {
        'Cache-Control': 'no-cache',
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
    });
    res.write("event: c\n");
    res.write("data: \n\n");
    console.log("dodaje callback");
    const session = crypto.randomBytes(32).toString('base64');
    if (other && !arra[id]) arra[id] = [];
    arra[id][session] = [res, userName, token];
    res.on('close', function() {
        console.log("usuwa callback");
        sessions.forEach(function(s, index) {
            if (s[1] < Date.now()) {
                if (s[3] != null) clearTimeout(s[3]);
                s.splice(index, 1);
                return;
            }
            if (s[0] == arra[id][session][2]) {
                console.log('delete refresh for session ' + s[0]);
                if (s[3] != null) clearTimeout(s[3]);
            }
        });
        delete arra[id][session];
    });
    setTimeout(function() {
        res.end();
    }, 60000); //60 seconds
    setRefreshSession(token, true);
}

const onRequestHandler = (req, res) => {
    if (req.url == "/external/styles.css" || req.url == "/external/dark.css" || req.url == "/external/sha256.js" ||
        req.url == "/external/suneditor.min.css" || req.url == "/external/suneditor.min.js") {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/' +
            (req.url.includes('.js') ? 'javascript' : 'css') + '; charset=UTF-8');
        //        res.setHeader('Cache-Control', 'must-revalidate');
        const stats = fs.statSync(path.normalize(__dirname + req.url));
        res.setHeader('Last-Modified', stats.mtime.toUTCString());
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

    console.log(' ');
    let userName = "";
    let c = true;
    //console.log(req.headers);
    if (req.headers['cookie']) {
        console.log(req.headers['cookie']);
        sessions.forEach(function(session, index) {
            if (session[1] < Date.now()) {
                console.log('usuwa sesje ' + session[0]);
                if (session[3] != null) clearTimeout(session[3]);
                sessions.splice(index, 1);
                return;
            }
            console.log('sprawdza sesje ' + session[0]);
            req.headers['cookie'].split("; ").forEach(function(cookie) {
                if ("session=" + session[0] == cookie) {
                    c = false;
                    if (session[2] != "") userName = session[2];
                }
            });
        });
    }
    console.log('user name is ' + userName);
    if (c) {
        const session = crypto.randomBytes(32).toString('base64');
        res.setHeader('Set-Cookie', 'session=' + session + '; SameSite=Strict; Secure');
        sessions.push([session, Date.now() + 1000 * 60, '', null]); // 60 seconds, non logged
        console.log("nowa sesja " + session);
    }

    if (req.method === 'GET') {
        const params = url.parse(req.url, true).query;
        console.log(req.url);

        //PUSH functionality
        //check field format
        if (params["sse"] && req.headers["cookie"]) {
            found = "";
            sessions.forEach(function(session, index) {
                if (session[1] < Date.now()) {
                    console.log('usuwa sesje ' + session[0]);
                    if (session[3] != null) clearTimeout(session[3]);
                    sessions.splice(index, 1);
                    return;
                }
                req.headers['cookie'].split("; ").forEach(function(cookie) {
                    if ("session=" + session[0] == cookie) {
                        console.log('znalazl sesje ' + found);
                        found = session[0];
                    }
                });
            });

            if (found != "") {
                //            console.log(req.headers);
                //fixme - we need checking URL beginning
                let id = req.headers['referer'].match(/.*chat\/pokaz\/([0-9]+)$/);
                if (id && fs.existsSync(__dirname + "\\chat\\" + id[1] + ".txt")) {
                    addToCallback(req, res, id[1], callbackChat, userName, false, found);
                    return;
                }
                id = req.headers['referer'].match(/.*([a-ząż]+)\/pokaz\/([0-9]+)$/);
                if (id && fs.existsSync(__dirname + "\\texts\\" + id[2] + ".txt")) {
                    addToCallback(req, res, id[2], callbackText, userName, false, found);
                    return;
                }
                const params = url.parse(req.headers['referer'], true).query;
                addToCallback(req, res, params["q"] ? params["q"] : "", callbackOther, userName, true, found);
            }
            return;
        }
        if (params["set"]) {
            if (params["set"] == "mobile1") {
                if (isMobile(req)) {
                    res.setHeader('Set-Cookie', 'mobile=; expires=Sun, 21 Dec 1980 14:14:14 GMT');
                } else {
                    res.setHeader('Set-Cookie', 'mobile=1; SameSite=Strict; Secure');
                }
            } else if (params["set"] == "mobile0") {
                if (!isMobile(req)) {
                    res.setHeader('Set-Cookie', 'mobile=; expires=Sun, 21 Dec 1980 14:14:14 GMT');
                } else {
                    res.setHeader('Set-Cookie', 'mobile=0; SameSite=Strict; Secure');
                }
            } else if (params["set"] == "dark1") {
                res.setHeader('Set-Cookie', 'dark=1; SameSite=Strict; Secure');
            } else if (params["set"] == "dark0") {
                res.setHeader('Set-Cookie', 'dark=0; SameSite=Strict; Secure');
            }
            res.statusCode = 302;
            res.setHeader('Location', req.headers['referer']);
            res.end();
            return;
        }
        if (params["q"]) {
            //must be before opowiadania/dodaj i opowiadania/zmien/1
            if (params["q"] == "profil/dodaj") {
                showAddChangeProfilePage(req, res, params, userName, getUserLevelUserName(userName));
                return;
            } else if (params["q"] == "haslo/zmien/1") {
                showPassReminderPage(req, res, params, userName, getUserLevelUserName(userName));
                return;
            }
            if (userName != "") {
                if (params["q"] == "profil/zmien") {
                    showAddChangeProfilePage(req, res, params, userName, getUserLevelUserName(userName));
                    return;
                } else if (params["q"] == "chat/dodaj") {
                    showAddChatPage(req, res, params, userName);
                    return;
                }
                let id = params["q"].match(/^chat\/pokaz\/([0-9]+)$/);
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
            if (params["q"] == "logingoogle") {
                showLoginGooglePage(req, res, params, userName, getUserLevelUserName(userName));
                return;
            }
            let id = params["q"].match(/^changepass\/([A-Za-z0-9+\/=]+)$/);
            if (id) {
                showChangePasswordPage(req, res, params, id, userName, getUserLevelUserName(userName));
                return;
            }
            id = params["q"].match(/^verifymail\/([A-Za-z0-9+\/=]+)$/);
            if (id) {
                showMailVerifyPage(req, res, params, id, userName, getUserLevelUserName(userName));
                return;
            }
            // must be before opowiadania/pokaz/1
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
        showMainPage(req, res, 0, [], userName);
        return;
    } else if (req.headers['content-type'] == "application/x-www-form-urlencoded") { // POST forms
        let body = "";
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
        case 2:
            return console.log("Non unique nicknames");
        default:
            return;
    }
});

if (!fs.existsSync(__dirname + '\\texts')) fs.mkdirSync(__dirname + '\\texts');
fs.readdirSync(__dirname + '\\texts').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    addToTextCache(file.replace(".txt", ""));
})

if (!fs.existsSync(__dirname + '\\users')) fs.mkdirSync(__dirname + '\\users');
fs.readdirSync(__dirname + '\\users').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    arr = decodeFileContent(readFileContentSync('\\users\\' + file), true);
    if (cacheUsers[arr["Who"]]) process.exit(2); // duplicate user
    cacheUsers[arr["Who"]] = [file.replace(".txt", ""), arr];
})

if (!fs.existsSync(__dirname + '\\chat')) fs.mkdirSync(__dirname + '\\chat');
fs.readdirSync(__dirname + '\\chat').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    addToChatCache(file.replace(".txt", ""), decodeFileContent(readFileContentSync('\\chat\\' + file), true));
})

//http.createServer(onRequestHandler).listen // delete secure from set-cookie when using this
http2.createSecureServer({
    key: fs.readFileSync(__dirname + '\\internal\\localhost-privkey.pem'),
    cert: fs.readFileSync(__dirname + '\\internal\\localhost-cert.pem')
}, onRequestHandler).listen(port, hostname, () => {
    console.log(`Server running at https://${hostname}:${port}/`);
});