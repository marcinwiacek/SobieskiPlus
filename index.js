//formatted with js-beautify
//for license ask marcin@mwiacek.com - for example all OSS licenses (like MIT, Apache and GPL2) can be discussed

const crypto = require('crypto');
const fs = require('fs');
//const http = require('http');
const http2 = require('http2');
const https = require('https');
const path = require('path');
const url = require('url');
const zlib = require('zlib');
const vm = require('vm')

vm.runInThisContext(fs.readFileSync(__dirname + '//config.js'));

let smtp = "";
//const nodemailer = require('nodemailer');
const nodemailer = require(path.normalize(process.argv[0].replace("node.exe", "") + '//node_modules//nodemailer'));
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

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let cacheTextsID = 1; //ID for new files - cache
let cacheTexts = [];
let cacheUsers = [];
let cacheChat = [];

let cacheFiles = [];

let mutexText = [];

let callbackChat = [];
let callbackText = [];
let callbackOther = [];
const CallbackField = {
    ResponseCallback: 0,
    UserName: 1,
    SessionToken: 2
}

let verifyToken = [];
let remindToken = [];
const TokenField = {
    Token: 0,
    UserName: 1,
    Expiry: 2,
    Token2FromMail: 3,
    Token3: 4 // not used in verifyToken
}

let sessions = [];
const SessionField = {
    SessionToken: 0,
    Expiry: 1,
    UserName: 2,
    RefreshCallback: 3
}

// This is semaphore with max. allowed parallel entries == 1
function Mutex() {
    let func = [];
    let num = 0;

    this.acquire = function() {
        console.log("acquire " + num);
        if (num < 1) {
            num++;
            return new Promise(resolve => {
                resolve();
            });
        }
        return new Promise(resolve => {
            func.push({
                resolve: resolve
            });
        });
    }

    this.release = function() {
        console.log("release " + num);
        num--;
        if (func.length == 0 || num == 1) return;
        num++;
        func.shift().resolve();
    }
}

function addToTextCache(fileID, tekst) {
    cacheTexts[fileID] = decodeSourceFile(tekst, true);
    cacheTexts[fileID]["filename"] = fileID;
    callbackText[fileID] = [];
    mutexText[fileID] = new Mutex();
}

function addToChatCache(fileID, tekst) {
    cacheChat[fileID] = decodeSourceFile(tekst, true);
    cacheChat[fileID]["filename"] = fileID;
    callbackChat[fileID] = [];
}

function addToUsersCache(userName, arr, fileID) {
    // We have in OldText history of changing sig and note
    // We should replace it just with latest value to save RAM
    let sig_text = "";
    let note_text = "";
    if (arr["OldText"]) {
        arr["OldText"].forEach(function(t0, index) {
            const t = t0["Text"].slice(0, -1);
            if (t.search('<!--sig-->') != -1) note_text = t.substr(0, t.search('<!--sig-->') - 1);
            const x = (t.search('<!--sig-->') != -1 ? t.substr(t.search('<!--sig-->') + 11) : t);
            if (x != "") sig_text = x;
        });
        delete arr["OldText"];
    }
    arr["sig"] = sig_text;
    arr["note"] = note_text;

    cacheUsers[userName] = arr;
    cacheUsers[userName]["filename"] = fileID;
}

function getUserLevelUserName(userName) {
    return (userName == "") ? "0" : cacheUsers[userName]["Level"];
}

function getPointsForText(arr) {
    if (!arr["Point"]) return 0;
    let points = 0;
    arr["Point"].split(',').forEach(function(usr) {
        points += parseInt(usr.substring(usr.indexOf("#") + 1));
    });
    return points;
}

function subForChat(chatID, userName) {
    return cacheUsers[userName]["CSub"] ? cacheUsers[userName]["CSub"].split(",").includes(chatID) : false;
}

function formatDate(date) {
    const d = new Date(date);
    return ret = d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ' ' +
        (d.getHours() < 10 ? "0" : "") + d.getHours() + ':' +
        (d.getMinutes() < 10 ? "0" : "") + d.getMinutes() + ':' +
        (d.getSeconds() < 10 ? "0" : "") + d.getSeconds();
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
        const x = fs.readFileSync(path.normalize(__dirname + fileName), 'utf8');
        return (x.charCodeAt(0) == 65279) ? x.substring(1) : x;
    }
}

// fixme: support Brotli files or LZ4
function createNewSourceFile(path, initialID, text) {
    let id = initialID;
    while (1) {
        let fd;
        try {
            fd = fs.openSync(__dirname + "//" + path + "//" + id + ".txt", 'wx');
            fs.appendFileSync(fd, text, 'utf8');
            break;
        } catch (err) {
            id++;
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
        }
    }
    return id;
}

// fixme: support Brotli files or LZ4
function appendToSourceFile(path, ID, text) {
    fs.appendFileSync(__dirname + "//" + path + "//" + ID + ".txt", text);
}

function getSourceFile(path, ID, callback) {
    //var stats = fs.statSync("/dir/file.txt");
    //var mtime = stats.mtime;
    //console.log(mtime);
    return readFileContentSync('//' + path + "//" + ID + '.txt', callback);
}

function getCacheFileSync(fileName) {
    if (!cacheFiles[fileName]) {
        const t = readFileContentSync(fileName.replace("_gzip", "").replace("_deflate", "").replace("_br", ""));
        // CAN'T USE // comments in JS !!!! Use /* */ instead.
        //        t = t.replace(/(\r\n|\n|\r)/gm, "");
        if (fileName.includes("_br")) {
            cacheFiles[fileName] = zlib.brotliCompressSync(t);
        } else if (fileName.includes("_gzip")) {
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

// Note: edited comment has got original When field + new field Edit with edit time
function addPendingCommentToArr(arr, comment) {
    if (comment == null) return;
    comment["When"] = Date.parse(comment["When"]);
    if (!arr["Comments"]) {
        arr["Comments"] = [];
    } else if (comment["Edit"]) {
        comment["Edit"] = Date.parse(comment["Edit"]);
        for (let index in arr["Comments"]) {
            if (arr["Comments"][index]["Who"] == comment["Who"] && arr["Comments"][index]["When"] == comment["When"]) {
                arr["Comments"][index]["Edit"] = comment["Edit"];
                if (comment["Text"]) arr["Comments"][index]["Text"] = comment["Text"];
                comment["When"] = 0;
                break;
            }
        }
    }
    if (comment["Edit"] && comment["When"] != 0) console.log("Error with comment time: " + comment["Who"] + "," + comment["When"] + "," + comment["Edit"]);
    if (comment["When"] != 0) {
        arr["commentsnum"]++;
        arr["Comments"].push(comment);
    }
    if ((comment["Edit"] ? comment["Edit"] : comment["When"]) < arr["commentswhen"]) console.log("Error!");
    arr["commentswhen"] = comment["Edit"] ? comment["Edit"] : comment["When"];
}

function addPendingTextToArr(arr, t, onlyHeaders) {
    if (!onlyHeaders && t != "") {
        if (!arr["OldText"]) arr["OldText"] = [];
        let oldtext = [];
        oldtext["Text"] = t;
        oldtext["When"] = Date.parse(arr["When"]);
        arr["OldText"].push(oldtext);
    }
}

//fields starting from big char are read from memory
function decodeSourceFile(txt, onlyHeaders) {
    let arr = [];
    let level = DecodingLevel.MainHeaders;
    let comment = null;
    let t = "";
    arr["commentsnum"] = 0; // for cache we don't want comments in memory; just number
    arr["commentswhen"] = 0; // for cache we don't want comments in memory; just number
    txt.split(/\r?\n/).forEach(function(line) {
        if (line == "<!--comment-->") {
            addPendingCommentToArr(arr, comment);
            level = DecodingLevel.CommentHeaders;
            comment = [];
            comment["Text"] = "";
            return;
        } else if (line == "<!--change-->") {
            level = DecodingLevel.MainHeaders;
            addPendingTextToArr(arr, t, onlyHeaders);
            t = "";
            return;
        }

        switch (level) {
            case DecodingLevel.MainHeaders:
                if (line == "") {
                    level = DecodingLevel.MainText;
                } else {
                    const x = line.split(":");
                    if (x.length >= 2) {
                        // When we get Who for <!--change--> we can override author name
                        if (x[0] != "Who" || (x[0] == "Who" && !arr["Who"])) {
                            arr[x[0]] = line.substring(x[0].length + 1, line.length);
                            if (Object.keys(cacheTexts).length != 0 && x[0] == "Who" && !cacheUsers[arr["Who"]]) {
                                console.log("Error with user: " + arr["Who"]);
                            }
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
                    if (x.length >= 2) {
                        comment[x[0]] = line.substring(x[0].length + 1, line.length);
                        if (Object.keys(cacheTexts).length != 0 && x[0] == "Who" && !cacheUsers[comment["Who"]]) {
                            console.log("Error with comment user: " + comment["Who"]);
                        }
                    }
                }
                break;
            case DecodingLevel.CommentText:
                if (!onlyHeaders) comment["Text"] += line + "\n";
        }
    });
    addPendingCommentToArr(arr, comment);
    addPendingTextToArr(arr, t, onlyHeaders);
    arr["When"] = Date.parse(arr["When"]);

    if (onlyHeaders) delete arr["Comments"];

    return arr;
}

function getPageList(pageNum, typeList, stateList, tag, specialplus, specialminus, sortLevel, userName, forUser) {
    let result = [];
    const plus = specialplus ? specialplus.split(",") : null;
    const minus = specialminus ? specialminus.split(",") : null;
    const tax = tag ? tag.split(",") : null;

    const t = Date.now();
    for (let index0 in cacheTexts) {
        entry = cacheTexts[index0];

        if ((typeList && !typeList.includes(entry["Type"])) ||
            !stateList.includes(entry["State"]) ||
            (entry["State"] == "szkic" && userName != entry["Who"])) continue;

        if (forUser && entry["Who"] != forUser) continue;

        if (userName != "" && userName != entry["Who"] && entry["State"] == "beta" &&
            entry["Beta"] && !entry["Beta"].split(",").includes(userName)) {
            continue;
        }

        if (entry["Tag"]) {
            if (tax) {
                let bad = false;
                tax.forEach(function(special) {
                    if (!entry["Tag"].split(",").includes(special)) bad = true;
                });
                if (bad) continue;
            }
        } else {
            if (tax) continue;
        }

        if (entry["Special"]) {
            let bad = false;
            if (plus) {
                plus.forEach(function(special) {
                    if (!entry["Special"].split(",").includes(special)) bad = true;
                });
            }
            if (!bad && minus) {
                minus.forEach(function(special) {
                    if (entry["Special"].split(",").includes(special)) bad = true;
                });
            }
            if (bad) continue;
        } else {
            if (plus) continue;
        }
        result.push(entry);
    }

    console.log(Date.now() - t);

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
    } else if (sortLevel == "punkty") {
        result.sort(function(a, b) {
            let aa = getPointsForText(a);
            let bb = getPointsForText(b);
            if (aa > bb) return -1;
            if (aa < bb) return 1;
            return (a["When"] > b["When"] ? -1 : 1);
        });
    }

    if (specialplus && specialplus.includes("przyklejone")) {
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

function directToMain(res) {
    res.statusCode = 302;
    res.setHeader('Location', '/');
    res.end();
}

function directToOKFileNotFound(res, txt, ok) {
    res.statusCode = ok ? 200 : 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end(txt);
}

function sendCommentToPage(res, comment) {
    res.write("event: c\n");
    if (comment) {
        const template = getCacheFileSync('//internal//comment0123.txt')
            .replace("<!--USER-->", addUserLink(comment["Who"]))
            .replace("<!--WHEN-->", formatDate(comment["When"]))
            .replace("<!--TEXT-->", comment["Text"]);

        res.write("data: " + encodeURI(template) + "\n\n");
    } else {
        res.write("data: \n\n");
    }
}

function sendInfoAboutChatEntryToPage(res, id) {
    res.write("event: m\n");
    res.write("data: " + cacheChat[id]["Title"] + "\n\n");
}

function sendNewTokenToPage(res, newtoken) {
    res.write("event: s\n");
    res.write("data: " + newtoken + "\n\n");
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
                sendReloadToPage(callbackOther[index0][index][CallbackField.ResponseCallback]);
            }
        }
    }
    for (let index in callbackText[arr["filename"]]) {
        sendReloadToPage(callbackText[arr["filename"]][index][CallbackField.ResponseCallback]);
    }
}

function reloadUserSessionsAfterLoginLogout(newUserName, token) {
    [callbackChat, callbackText, callbackOther].forEach(function(callback) {
        for (let index0 in callback) {
            for (let index in callback[index0]) {
                if (callback[index0][index][CallbackField.SessionToken] != token) continue;
                callback[index0][index][CallbackField.UserName] = newUserName;
                sendReloadToPage(callback[index0][index][CallbackField.ResponseCallback]);
            }
        }
    });
}

async function sendVerificationMail(mail, username) {
    const token = encodeURIComponent(crypto.randomBytes(32).toString('base64'));
    const info = await smtp.sendMail({
        from: 'marcin@mwiacek.com',
        to: mail,
        subject: "Zweryfikuj swoje konto w systemie",
        text: "Link jest ważny przez godzinę: q=verifymail/" + token +
            "\n Jeżeli straci ważność, spróbuj się zalogować i dostaniesz kolejny mail"
    });
    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
    //order inside TokenField; last field unused
    verifyToken.push([token, username, Date.now() + 1000 * 60 * 60, "", ""]);
}

async function sendRemindPasswordMail(mail, token) {
    const info = await smtp.sendMail({
        from: 'marcin@mwiacek.com',
        to: mail,
        subject: "Zmien haslo",
        text: "Link jest ważny przez godzinę: q=changepass/" + token +
            "\n Jeżeli straci ważność, spróbuj użyć funkcji przypominania i dostaniesz kolejny mail"
    });
    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
}

// chat or comment to the text
// FIXME: we need probably mutex here
function parsePOSTUploadComment(params, res, userName, isChat) {
    const folder = isChat ? "chat" : "texts";

    //checking for login
    //checking for correct filename protection
    if (!fs.existsSync(__dirname + "//" + folder + "//" + params["tekst"] + ".txt")) {
        directToOKFileNotFound(res, '', false);
        return;
    }

    const t = Date.now(); // FIXME: do we need conversion here?
    appendToSourceFile(folder, params["tekst"],
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
        cacheChat[params["tekst"]]["commentswhen"] = t;
        cacheChat[params["tekst"]]["commentsnum"]++;

        for (let index in callbackChat[params["tekst"]]) {
            sendCommentToPage(callbackChat[params["tekst"]][index][CallbackField.ResponseCallback], comment);
        }

        //inform other users about new chat entry
        for (let index0 in callbackOther) {
            for (let index in callbackOther[index0]) {
                if (callbackOther[index0][index][CallbackField.UserName] != userName &&
                    subForChat(params["tekst"], callbackOther[index0][index][CallbackField.UserName])) {
                    sendInfoAboutChatEntryToPage(callbackOther[index0][index][CallbackField.ResponseCallback], params["tekst"]);
                }
            }
        }
        //fixme: check the same on other callbackText
        //fixme: send refresh to user pages for other users
    } else {
        cacheTexts[params["tekst"]]["commentswhen"] = t;
        cacheTexts[params["tekst"]]["commentsnum"]++;

        for (let index in callbackText[params["tekst"]]) {
            sendCommentToPage(callbackText[params["tekst"]][index][CallbackField.ResponseCallback], comment);
        }
    }
    directToOKFileNotFound(res, '', true);
}

// FIXME: do we need mutex here?
function parsePOSTUploadNewText(params, res, userName) {
    if (!params["text"] || !params["state"] || !params["type"] || !params["title"]) {
        directToOKFileNotFound(res, '', false);
        return;
    }

    let txt = "Title:" + params["title"] + "\n" +
        "State:" + params["state"] + "\n" +
        "Type:" + params["type"] + "\n";
    if (params["beta"]) txt += "Beta:" + params["beta"] + "\n";
    if (params["tag"]) txt += "Tag:" + params["tag"] + "\n";
    if (params["special"]) txt += "Special:" + params["special"] + "\n";
    txt += "When:" + formatDate(Date.now()) + "\n" +
        "Who:" + userName + "\n\n" +
        (params["teaser"] ? params["teaser"] + "\n<!--teaser-->\n" : "") +
        params["text"] + "\n";

    const id = createNewSourceFile("texts", cacheTextsID, txt);
    cacheTextsID = id + 1;
    addToTextCache(id, txt);
    sendAllReloadsAfterTextChangeToPage(cacheTexts[id]);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    Object.keys(podstronyType).forEach(function(entry) {
        if (podstronyType[entry].includes(params["type"])) {
            res.end(entry + "/zmien/" + id.toString());
        }
    });
}

async function updateTextInTextFile(params, res, userName) {
    console.log("waiting for mutex");
    await mutexText[params["tekst"]].acquire();
    console.log("mutex OK");

    if (cacheTexts[params["tekst"]]["When"] != params["version"]) {
        mutexText[params["tekst"]].release();

        directToOKFileNotFound(res, 'Tekst był zmieniany w międzyczasie. Twoja wersja nie została zapisana!', false);
        return null;
    }

    const updateTime = Date.parse(formatDate(Date.now())); // to avoid small diff for 4 last digits int -> date -> int

    txt = "";
    if (userName != cacheTexts[params["tekst"]]["Who"]) txt += "Who:" + userName + "\n";
    if (params["title"]) txt += "Title:" + params["title"] + "\n";
    if (params["state"]) txt += "State:" + params["state"] + "\n";
    if (params["type"]) txt += "Type:" + params["type"] + "\n";
    if (params["beta"] || params['beta'] == '') txt += "Beta:" + params["beta"] + "\n";
    if (params["tag"] || params['tag'] == '') txt += "Tag:" + params["tag"] + "\n";
    if (params["special"] || params["special"] == '') txt += "Special:" + params["special"] + "\n";
    if (params["teaser"] || params["teaser"] == '') {
        txt += (params["teaser"] != "" ? "\n" : "") + params["teaser"] + "\n<!--teaser-->\n";
    }
    if (params["text"]) {
        if (!(params["teaser"] || params["teaser"] == '')) txt += "\n";
        txt += params["text"] + "\n";
    }

    appendToSourceFile("texts", params["tekst"],
        "<!--change-->\n" +
        "When:" + formatDate(updateTime) + "\n" +
        txt
    );

    //update cache
    if (params["title"]) cacheTexts[params["tekst"]]["Title"] = params["title"];
    if (params["state"]) cacheTexts[params["tekst"]]["State"] = params["state"];
    if (params["type"]) cacheTexts[params["tekst"]]["Type"] = params["type"];
    if (params["beta"] || params["beta"] == '') cacheTexts[params["tekst"]]["Beta"] = params["beta"];
    if (params["tag"] || params["tag"] == '') cacheTexts[params["tekst"]]["Tag"] = params["tag"];
    if (params["special"] || params["special"] == '') cacheTexts[params["tekst"]]["Special"] = params["special"];
    cacheTexts[params["tekst"]]["When"] = updateTime;
    cacheTexts[params["tekst"]]["Who"] = userName;

    mutexText[params["tekst"]].release();

    return updateTime.toString();
}

async function parsePOSTUploadUpdatedText(params, res, userName) {
    if (!params["tekst"] || !cacheTexts[params["tekst"]] || !params["version"] ||
        (!(params["teaser"] || params["teaser"] == '') &&
            !params["text"] && !params["state"] && !params["type"] &&
            !params["title"] &&
            !(params["beta"] || params["beta"] == '') &&
            !(params["tag"] || params["tag"] == '') &&
            !(params["special"] || params["special"] == ''))) {
        directToOKFileNotFound(res, '', false);
        return;
    }

    const ret = await updateTextInTextFile(params, res, userName);
    console.log("after mutex");
    if (ret == null) return;

    sendAllReloadsAfterTextChangeToPage(cacheTexts[params["tekst"]]);

    directToOKFileNotFound(res, ret.toString(), true);
}

async function updatePointInTextFile(params, res, userName) {
    console.log("waiting for mutex");
    await mutexText[params["tekst"]].acquire();
    console.log("mutex OK");

    if (cacheTexts[params["tekst"]]["When"] != params["version"]) {
        mutexText[params["tekst"]].release();

        directToOKFileNotFound(res, 'Tekst był zmieniany w międzyczasie. Twoja wersja nie została zapisana!', false);
        return null;
    }
    let txt = "";
    let wrong = false;
    if (parseInt(params["point"]) > 0 && parseInt(params["point"]) < 11) {
        if (cacheTexts[params["tekst"]]["Point"]) {
            cacheTexts[params["tekst"]]["Point"].split(',').forEach(function(usr) {
                // you can vote only once
                if (usr.indexOf(userName + "#") == 0) wrong = true;
            });
            txt = cacheTexts[params["tekst"]]["Point"] + ',';
        }
        txt += userName + "#" + params["point"];
    } else {
        wrong = true;
    }
    if (wrong) {
        directToOKFileNotFound(res, '', false);
        return;
    }

    const updateTime = Date.parse(formatDate(Date.now())); // to avoid small diff for 4 last digits int -> date -> int

    appendToSourceFile("texts", params["tekst"],
        "<!--change-->\n" +
        "When:" + formatDate(updateTime) + "\n" +
        "Point:" + txt + "\n"
    );

    //update cache
    cacheTexts[params["tekst"]]["When"] = updateTime;
    cacheTexts[params["tekst"]]["Point"] = txt;

    mutexText[params["tekst"]].release();

    return updateTime.toString();
}

async function parsePOSTUploadPointText(params, res, userName) {
    if (!params["tekst"] || !params["point"] || !params["version"]) {
        directToOKFileNotFound(res, '', false);
        return;
    }

    const ret = await updatePointInTextFile(params, res, userName);
    console.log("after mutex");
    if (ret == null) return;

    sendAllReloadsAfterTextChangeToPage(cacheTexts[params["tekst"]]);

    directToOKFileNotFound(res, ret.toString(), true);
}

function parsePOSTCreateChat(params, res, userName) {
    let wrong = false;
    params["users"].split(',').forEach(function(user) {
        if (!cacheUsers[user]) wrong = true;
    });
    if (wrong) {
        directToOKFileNotFound(res, '', false);
        return;
    }

    const txt = "Title:" + params["title"] + "\n" +
        "When:" + formatDate(Date.now()) + "\n" +
        "Who:" + params["users"] + "," + userName + "\n";
    const id = createNewSourceFile("chat", 1, txt);
    addToChatCache(id.toString(), txt);

    (params["users"] + "," + userName).split(",").forEach(function(entry) {
        let txt = entry["CSub"] ? entry["CSub"] : "";
        if (txt != "") txt += ",";
        txt += id.toString();
        appendToSourceFile("users", cacheUsers[entry]["filename"],
            "<!--change-->\n" +
            "When:" + formatDate(Date.now()) + "\n" +
            "CSub:" + txt + "\n"
        );
        cacheUsers[entry]["CSub"] = txt;
    });

    directToOKFileNotFound(res, id.toString(), true);
}

function parsePOSTSubscribeChatTextEntry(params, res, userName, textEntry) {
    const field = textEntry ? cacheUsers[userName]["ESub"] : cacheUsers[userName]["CSub"];
    let txt = "";
    let wrong = false;
    if (textEntry) {
        if (!cacheTexts[params["id"]]) wrong = true;
    } else {
        if (!cacheChat[params["id"]]) wrong = true;
    }
    if (!wrong) {
        if (params["onoff"] == "true") {
            if (field) {
                field.split(",").forEach(function(entry) {
                    if (entry == params["id"]) wrong = true;
                });
                txt = field + ",";
            }
            txt += params["id"];
        } else if (params["onoff"] == "false") {
            wrong = true;
            field.split(",").forEach(function(entry) {
                if (entry == params["id"]) {
                    wrong = false;
                } else {
                    if (txt != "") txt += ",";
                    txt += entry;
                }
            });
        } else {
            wrong = true;
        }
    }
    if (!wrong) {
        appendToSourceFile("users", cacheUsers[userName]["filename"],
            "<!--change-->\n" +
            "When:" + formatDate(Date.now()) + "\n" +
            (textEntry ? "ESub:" : "CSub:") + txt + "\n"
        );
        if (textEntry) {
            cacheUsers[userName]["ESub"] = txt;
        } else {
            cacheUsers[userName]["CSub"] = txt;
        }
    }

    directToOKFileNotFound(res, '', !wrong);
}

function parsePOSTCreateUser(params, res, userName) {
    if (!params["level"] || (params["level"] != "1" && params["level"] != "2" && params["level"] != "3") ||
        (Object.keys(cacheUsers).length != 0 && params["level"] == "3" && getUserLevelUserName(userName) != "3") ||
        (params["typ"] != "g" && params["typ"] != "w") || (params["typ"] == "w" && !params["pass"])) {
        directToOKFileNotFound(res, '', false);
        return;
    }
    if (cacheUsers[params["username"]]) {
        directToOKFileNotFound(res, 'Użytkownik o podanym nicku już istnieje', false);
        return;
    }

    let txt = "Who:" + params["username"] + "\n" +
        (params["typ"] == "w" ? "Pass:" + params["pass"] + "\n" : "") +
        "Mail:" + params["mail"] + "\n" +
        "When:" + formatDate(Date.now()) + "\n" +
        (params["typ"] != "g" ? "ConfirmMail:0\n" : "") +
        (params["typ"] == "g" ? "Type:google\n" : "") +
        (Object.keys(cacheUsers).length == 0 ? "Level:3\n" : "Level:" + params["level"] + "\n");

    if (params["note"] || params["note"] == '') {
        txt += (params["note"] != "" ? "\n" : "") + params["note"] + "\n<!--sig-->\n";
    }
    if (params["sig"] || params["sig"] == '') {
        if (!(params["note"] || params["note"] == '')) txt += "\n";
        txt += params["sig"] + "\n";
    }

    const id = createNewSourceFile("users", 1, txt);
    addToUsersCache(params["username"], decodeSourceFile(txt, false), id);

    if (params["typ"] != "g" && mailSupport) sendVerificationMail(params["mail"], params["username"]);

    directToOKFileNotFound(res, id.toString(), true);
}

// FIXME: semaphore?
function parsePOSTEditUser(params, res, userName) {
    if (params["typ"] != "g" && params["typ"] != "w") {
        directToOKFileNotFound(res, '', false);
        return;
    }
    const t = Date.now();

    let txt = "<!--change-->\n" +
        (params["typ"] == "w" && params["pass"] ? "Pass:" + params["pass"] + "\n" : "") +
        (params["typ"] == "g" ? "Type:google\n" : "Type:wlasny\n") +
        "Mail:" + params["mail"] + "\n" +
        "When:" + formatDate(t) + "\n";

    // In file have change for note/sig, in cache latest value
    if (params["note"] || params["note"] == '') {
        txt += (params["note"] != "" ? "\n" : "") + params["note"] + "\n<!--sig-->\n";
        cacheUsers[userName]["note"] = params["note"];
    }
    if (params["sig"] || params["sig"] == '') {
        if (!(params["note"] || params["note"] == '')) txt += "\n";
        txt += params["sig"] + "\n";
        cacheUsers[userName]["sig"] = params["sig"];
    }

    appendToSourceFile("users", cacheUsers[userName]["filename"], txt);

    if (params["typ"] == "w" && params["pass"] != "") cacheUsers[userName]["Pass"] = params["pass"];
    cacheUsers[userName]["Type"] = (params["typ"] == "g" ? "google\n" : "wlasny");
    cacheUsers[userName]["Mail"] = params["mail"];
    cacheUsers[userName]["When"] = t;

    directToOKFileNotFound(res, '', true);
}

function tryOwnLogin(params, googleMail, cookieSessionToken) {
    let found = null;
    for (let index in cacheUsers) {
        if (found != null) return found;
        sessions.forEach(function(session, index2) {
            if (found != null) return;
            if (session[SessionField.Expiry] < Date.now()) {
                if (session[SessionField.RefreshCallback] != null) clearTimeout(session[SessionField.RefreshCallback]);
                sessions.splice(index2, 1);
                return;
            }
            if (cookieSessionToken != session[SessionField.SessionToken] || session[SessionField.UserName] != "") {
                return;
            }
            if (cacheUsers[index]["Ban"] && cacheUsers[index]["Ban"] > Date.now()) {
                found = "Konto zablokowane przez administratora do " + formatDate(cacheUsers[index]["Ban"]);
                return;
            }
            if (googleMail) {
                console.log(googleMail + " vs " + cacheUsers[index]["Mail"]);
                //fixme check if verified
                if (cacheUsers[index]["Type"] == "google" && googleMail == cacheUsers[index]["Mail"]) {
                    session[SessionField.UserName] = cacheUsers[index]["Who"];
                    reloadUserSessionsAfterLoginLogout(cacheUsers[index]["Who"], session[SessionField.SessionToken]);
                    found = "";
                }
                return;
            }
            if (cacheUsers[index]["Type"] == "google") return;
            usr = crypto.createHash('sha256').update(session[SessionField.SessionToken] + cacheUsers[index]["Who"]).digest("hex");
            if (usr != params["user"]) return;
            pass = crypto.createHash('sha256').update(session[SessionField.SessionToken] + cacheUsers[index]["Pass"]).digest("hex");
            if (pass != params["password"]) return;
            if (params["typ"] != "g" && cacheUsers[index]["ConfirmMail"] == "0") {
                sendVerificationMail(cacheUsers[index]["Mail"], cacheUsers[index]["Who"]);
                found = "Konto niezweryfikowane. Kliknij na link w mailu";
            } else {
                session[SessionField.UserName] = cacheUsers[index]["Who"];
                reloadUserSessionsAfterLoginLogout(cacheUsers[index]["Who"], session[SessionField.SessionToken]);
                found = "";
            }
        });
    }
    return found;
}

async function parsePOSTLogin(params, res, userName, cookieSessionToken) {
    const found = tryOwnLogin(params, "", cookieSessionToken);
    directToOKFileNotFound(res, found, (found == ""));
}

async function parsePOSTGoogleLogin(params, res, userName, cookieSessionToken) {
    // this is not preffered version according to Google, but good enough for this milestone
    const premise = new Promise((resolve, reject) => {
        https.get('https://oauth2.googleapis.com/tokeninfo?id_token=' + params["id"], (resp) => {
            let data = '';
            resp.on('data', (chunk) => data += chunk);
            resp.on('end', () => resolve(data));
        }).on('error', e => reject(e))
    });
    const txt = await premise;
    const json = JSON.parse(txt);

    if (json.azp != GoogleSignInToken || json.aud != GoogleSignInToken) {
        directToOKFileNotFound(res, '', false);
        return;
    }

    const found = tryOwnLogin(params, json.email, cookieSessionToken);
    directToOKFileNotFound(res, found, (found == ""));
}

function parsePOSTLogout(params, res, userName, cookieSessionToken) {
    sessions.forEach(function(session, index) {
        if (session[SessionField.Expiry] < Date.now()) {
            if (session[SessionField.RefreshCallback] != null) clearTimeout(session[SessionField.RefreshCallback]);
            sessions.splice(index, 1);
            return;
        }
        if (cookieSessionToken == session[SessionField.SessionToken]) {
            session[SessionField.UserName] = '';
            reloadUserSessionsAfterLoginLogout('', session[SessionField.SessionToken]);
        }
    });

    directToOKFileNotFound(res, '', true);
}

async function parsePOSTRemind(params, res, userName) {
    let found = false;
    remindToken.forEach(function(tokenEntry, index1) {
        if (found) return;
        if (tokenEntry[TokenField.Expiry] < Date.now()) {
            remindToken.splice(index1, 1);
            return;
        }
        for (let index in cacheUsers) {
            if (found) return;
            usr = crypto.createHash('sha256').update(tokenEntry[TokenField.Token] + cacheUsers[index]["Who"]).digest("hex");
            if (usr != params["token1"]) continue;
            pass = crypto.createHash('sha256').update(tokenEntry[TokenField.Token] + cacheUsers[index]["Mail"]).digest("hex");
            if (pass != params["token2"]) continue;

            tokenEntry[TokenField.Token2FromMail] = encodeURIComponent(crypto.randomBytes(32).toString('base64'));
            tokenEntry[TokenField.UserName] = cacheUsers[index]["Who"];
            sendRemindPasswordMail(cacheUsers[index]["Mail"], tokenEntry[TokenField.Token2FromMail]);
            found = true;
        }
    });

    directToOKFileNotFound(res, '', found);
}

function parsePOSTChangePass(params, res, userName) {
    let found = false;
    remindToken.forEach(function(tokenEntry, index) {
        if (found) return;
        if (tokenEntry[TokenField.Expiry] < Date.now()) {
            remindToken.splice(index, 1);
            return;
        }
        if (params["hash"] != tokenEntry[TokenField.Token3]) return;
        appendToSourceFile("users", cacheUsers[tokenEntry[TokenField.UserName]]["filename"],
            "<!--change-->\n" +
            "When:" + formatDate(Date.now()) + "\n" +
            "Pass:" + params["token"] + "\n"
        );
        cacheUsers[tokenEntry[TokenField.UserName]]["Pass"] = params["token"];
        remindToken.splice(index, 1);
        found = true;
    });
    directToOKFileNotFound(res, '', found);
}

function parsePOSTVerifyMail(params, res, userName) {
    found = false;
    verifyToken.forEach(function(tokenEntry, index) {
        if (found) return;
        if (tokenEntry[TokenField.Expiry] < Date.now()) {
            verifyToken.splice(index, 1);
            return;
        }
        if (cacheUsers[tokenEntry[TokenField.UserName]]["Type"] == "google" ||
            cacheUsers[tokenEntry[TokenField.UserName]]["ConfirmMail"] == "1") {
            return;
        }
        if (params["token"] != crypto.createHash('sha256').update(tokenEntry[TokenField.Token] +
                cacheUsers[tokenEntry[TokenField.UserName]]["Pass"]).digest("hex")) return;
        appendToSourceFile("users", cacheUsers[tokenEntry[TokenField.UserName]]["filename"],
            "<!--change-->\n" +
            "When:" + formatDate(Date.now()) + "\n" +
            "ConfirmMail:1\n"
        );
        cacheUsers[tokenEntry[TokenField.UserName]]["ConfirmMail"] = "1";
        verifyToken.splice(index, 1);
        found = true;
    });

    directToOKFileNotFound(res, '', found);
}

async function parsePOSTforms(params, res, userName, cookieSessionToken) {
    console.log(params);
    if (userName != "") {
        if (params["upload_comment"] && params["obj"] && params["tekst"] && params["comment"]) {
            if (params["obj"] == "chat" || params["obj"] == "texts") {
                parsePOSTUploadComment(params, res, userName, params["obj"] == "chat");
                return;
            }
        } else if (params["upload_text"] && params["tekst"]) {
            if (params["tekst"] == "0") {
                parsePOSTUploadNewText(params, res, userName);
            } else {
                parsePOSTUploadUpdatedText(params, res, userName);
            }
            return;
        } else if (params["point_text"] && params["tekst"]) {
            parsePOSTUploadPointText(params, res, userName);
            return;
        } else if (params["new_chat"] && params["title"] && params["users"]) {
            parsePOSTCreateChat(params, res, userName);
            return;
        } else if (params["edit_user"] && params["typ"] && params["mail"]) {
            parsePOSTEditUser(params, res, userName);
            return;
        } else if (params["esub"] && params["id"] && params["onoff"]) {
            parsePOSTSubscribeChatTextEntry(params, res, userName, true);
            return;
        } else if (params["csub"] && params["id"] && params["onoff"]) {
            parsePOSTSubscribeChatTextEntry(params, res, userName, false);
            return;
        }
    } else { // UserName == ""
        if (params["login"] && params["user"] && params["password"]) {
            parsePOSTLogin(params, res, userName, cookieSessionToken);
            return;
        } else if (enableGoogleWithToken && params["glogin"] && params["id"]) {
            parsePOSTGoogleLogin(params, res, userName, cookieSessionToken);
            return;
        }
    }
    if (params["logout"]) {
        parsePOSTLogout(params, res, userName, cookieSessionToken);
        return;
    } else if (params["remind"] && params["token1"] && params["token2"]) {
        parsePOSTRemind(params, res, userName);
        return;
    } else if (params["changepass"] && params["hash"] && params["token"]) {
        parsePOSTChangePass(params, res, userName);
        return;
    } else if (params["verify"] && params["token"]) {
        parsePOSTVerifyMail(params, res, userName);
        return;
    } else if (params["new_user"] && params["username"] && params["typ"] && params["mail"]) {
        parsePOSTCreateUser(params, res, userName);
        return;
    }

    directToOKFileNotFound(res, '', false);
}

function isMobile(req) {
    return req.headers['user-agent'] ?
        req.headers['user-agent'].includes('iPad') || req.headers['user-agent'].includes('iPhone') ||
        req.headers['user-agent'].includes('Android') :
        false;
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
        .replace("<!--MENU-->", getCacheFileSync('//internal//menu' +
            ((userName == "") ? '0' : '123') +
            '.txt'))
        .replace("<!--DARK-LINK-->", "<p><a href=\"?set=dark" +
            ((req.headers['cookie'] && req.headers['cookie'].includes('dark=1')) ? "0\">Wy" : "1\">W") +
            "łącz ciemny kolor</a>")
        .replace("<!--MOBILE-LINK-->", "<p><a href=\"?set=mobile" +
            ((req.headers['cookie'] && req.headers['cookie'].includes('mobile=1')) ? "0\">Wy" : "1\">W") +
            "łącz mobile</a>")
        .replace("<!--JSASYNC-->", getCacheFileSync('//internal//jsasync.txt'));

    if (userName == "") {
        return text.replace("<!--LOGIN-LOGOUT-->", getCacheFileSync('//internal//login.txt'));
    }
    return text.replace("<!--ID-USER-->", cacheUsers[userName]["filename"])
        .replace("<!--LOGIN-LOGOUT-->", getCacheFileSync('//internal//logout' +
                (cacheUsers[userName]["Type"] == "google" ? "google" : "") + '.txt')
            .replace(/<!--SIGN-IN-TOKEN-->/g, GoogleSignInToken));
}

function addRadio(idname, value, description, checked, readonly) {
    return "<input type=\"radio\" name=\"" + idname + "\" id=" + idname + value + " value=\"" + value + "\"" +
        (readonly ? " disabled" : "") + (checked ? " checked" : "") +
        "><label for=\"" + idname + value + "\">" + description + "</label>";
}

function addOption(idname, value, selected) {
    return "<option value=\"" + idname + "\"" + (selected ? " selected" : "") + ">" + value + "</option>";
}

function addUserLink(name) {
    if (!cacheUsers[name]) return "";
    return "<a href=\"?q=profil/pokaz/" + cacheUsers[name]["filename"] + "\">" + name + "</a>";
}

function showPassReminderPage(req, res, params, userName) {
    const token = encodeURIComponent(crypto.randomBytes(32).toString('base64'));
    // order like with TokenField
    remindToken.push([token, "", Date.now() + 1000 * 60 * 60, "", "", ""]);

    sendHTML(req, res, genericReplace(req, res, getCacheFileSync('//internal//passremind.txt'), userName)
        .replace("<!--HASH-->", token));
}

function showChangePasswordPage(req, res, params, id, userName) {
    let token = "";
    remindToken.forEach(function(tokenEntry) {
        if (token != "") return;
        if (tokenEntry[TokenField.Expiry] < Date.now()) {
            remindToken.splice(index, 1);
            return;
        }
        if (id[1] == decodeURIComponent(tokenEntry[TokenField.Token2FromMail])) {
            token = crypto.randomBytes(32).toString('base64');
            tokenEntry[TokenField.Token3] = token;
        }
    });

    if (token == "") {
        directToMain(res);
        return;
    }

    sendHTML(req, res, genericReplace(req, res, getCacheFileSync('//internal//passchange.txt'), userName)
        .replace("<!--HASH-->", token));
}

function showMailVerifyPage(req, res, params, id, userName) {
    let token = '';
    verifyToken.forEach(function(tokenEntry) {
        if (token != '') return;
        if (tokenEntry[TokenField.Expiry] < Date.now()) {
            verifyToken.splice(index, 1);
            return;
        }
        if (id[1] == decodeURIComponent(tokenEntry[TokenField.Token]) &&
            cacheUsers[tokenEntry[TokenField.UserName]]["Type"] != "google" &&
            cacheUsers[tokenEntry[TokenField.UserName]]["ConfirmMail"] == 0) {
            token = crypto.randomBytes(32).toString('base64');
            tokenEntry[TokenField.Token] = token;
        }
    });
    if (token == '') {
        directToMain(res);
        return;
    }
    sendHTML(req, res, genericReplace(req, res, getCacheFileSync('//internal//verifymail.txt'), userName)
        .replace("<!--HASH-->", token));
}

function showLoginGooglePage(req, res, userName) {
    sendHTML(req, res, genericReplace(req, res, getCacheFileSync('//internal//logingoogle.txt'), userName)
        .replace("<!--SIGN-IN-TOKEN-->", GoogleSignInToken));
}

function showAddChatPage(req, res, params, userName) {
    if (userName == "") {
        directToMain(res);
        return;
    }

    let txt = "";
    for (let index in cacheUsers) {
        if (cacheUsers[index]["Who"] != userName) {
            txt += addOption(cacheUsers[index]["Who"], cacheUsers[index]["Who"], false);
        }
    }

    sendHTML(req, res, genericReplace(req, res, getCacheFileSync('//internal//addchat123.txt'), userName)
        .replace("<!--USERS-LIST-->", txt));
}

function showChatPage(req, res, params, id, userName) {
    if (userName == "") {
        directToMain(res);
        return;
    }

    getSourceFile("chat", id[1], (data) => {
        if (data == "") {
            directToMain(res);
            return;
        }

        let arr = decodeSourceFile(data, false);

        if (arr["Who"] && !arr["Who"].split(",").includes(userName)) {
            directToMain(res);
            return;
        }

        sendHTMLHead(res);

        let text = genericReplace(req, res, getCacheFileSync('//internal//chat123.txt'), userName)
            .replace(/<!--TITLE-->/g, arr["Title"]); // multiple

        if (arr["Who"]) {
            txt = "";
            arr["Who"].split(",").forEach(function(autor) {
                txt += (txt != "" ? "," : "") + addUserLink(autor);
            });
            text = text.replace("<!--USERS-->", txt);
        }

        if (arr["Comments"]) {
            const template0 = getCacheFileSync('//internal//comment0123.txt');
            let txt = "";
            arr["Comments"].reverse().forEach(function(comment) {
                txt += template0.replace("<!--USER-->", addUserLink(comment["Who"]))
                    .replace("<!--WHEN-->", formatDate(comment["When"]))
                    .replace("<!--EDITED-->", comment["Edit"] ? " (edited " + formatDate(comment["Edit"]) + ")" : "")
                    .replace("<!--TEXT-->", comment["Text"]);
            });
            text = text.replace("<!--COMMENTS-->", txt);
        }

        sendHTMLBody(req, res, text.replace("<!--COMMENTEDIT-->", getCacheFileSync('//internal//commentedit123.txt'))
            .replace(/<!--PAGEID-->/g, id[1]) //many entries
            .replace("<!--OBJECT-->", "chat"));
    });
}

function getChatList(pageNum, userName) {
    let result = [];

    cacheChat.forEach((entry, key) => {
        if (!entry["Who"] || entry["Who"].split(",").includes(userName)) result.push(entry);
    });

    result.sort(function(a, b) {
        return (a["commentswhen"] == b["commentswhen"]) ? 0 : (a["commentswhen"] < b["commentswhen"] ? 1 : -1);
    });

    return [result.slice(pageNum * onThePage, (pageNum + 1) * onThePage), result.length];
}

function getESubList(pageNum, userName) {
    if (!cacheUsers[userName]["ESub"]) return [null, null];

    let result = [];

    cacheUsers[userName]["ESub"].split(',').forEach((ID) => {
        if (cacheTexts[ID]["State"] == "szkic") return;
        result.push(cacheTexts[ID]);
    });

    result.sort(function(a, b) {
        return (a["When"] == b["When"]) ? 0 : (a["When"] < b["When"] ? 1 : -1);
    });

    return [result.slice(pageNum * onThePage, (pageNum + 1) * onThePage), result.length];
}

function formatChatEntry(template, arr, userName) {
    template = template.replace("<!--TITLE-->",
        "<a href=\"?q=chat/pokaz/" + arr["filename"] + "\">" + arr["Title"] + "</a>");
    if (arr["commentsnum"] != "0") {
        template = template.replace("<!--COMMENTSWHEN-->", "(ostatni " + formatDate(arr["commentswhen"]) + ")");
    }

    template = template.replace("<!--SUB-->", "<a href=javascript:csub(" + arr["filename"] + "," +
        !subForChat(arr["filename"], userName) + ");>" + (subForChat(arr["filename"], userName) ? "on" : "off") + "</a>");

    if (arr["Who"]) {
        let txt = "";
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
        directToMain(res);
        return;
    }

    sendHTMLHead(res);

    let text = genericReplace(req, res, getCacheFileSync('//internal//useredit.txt'), userName);

    let txt = "";
    if (Object.keys(cacheUsers).length != 0) {
        txt += addRadio("userlevel", "1", "standardowy bez opcji komentowania", false, false) + "<p>" +
            addRadio("userlevel", "2", "standardowy z opcją komentowania", true, false);
        if (userLevel == "3") txt += "<p>" + addRadio("userlevel", "3", "admin", false, false);
    } else {
        txt += "<p>" + addRadio("userlevel", "3", "admin", true, false);
    }
    text = text.replace("<!--LEVEL-->", txt);

    if (params["q"] == "profil/zmien") {
        if (cacheUsers[userName]["Type"] != "google") {
            text = text.replace("<!--CHECKED-WLASNE-->", " checked")
                .replace("<!--CHECKED-GOOGLE-->", "");
        } else {
            text = text.replace("<!--CHECKED-WLASNE-->", "")
                .replace("<!--CHECKED-GOOGLE-->", " checked");
        }
        text = text.replace("<!--USER-PARAMS-->", " value=\"" + cacheUsers[userName]["Who"] + "\" placeholder=\"Cannot be empty\" readonly ")
            .replace("<!--MAIL-PARAMS-->", " value=\"" + cacheUsers[userName]["Mail"] + "\" placeholder=\"Cannot be empty\"")
            .replace(/<!--PASS-PARAMS-->/g, " placeholder=\"Leave empty if you don't want to change it\"")
            .replace(/<!--OPERATION-->/g, "edit_user")
            .replace("<!--NOTE-->", cacheUsers[userName]["note"] ? cacheUsers[userName]["note"] : "")
            .replace("<!--SIG-->", cacheUsers[userName]["sig"] ? cacheUsers[userName]["sig"] : "");
    } else { // new profile
        text = text.replace("<!--CHECKED-WLASNE-->", " checked")
            .replace("<!--CHECKED-GOOGLE-->", "")
            .replace("<!--USER-PARAMS-->", " value=\"\" placeholder=\"Cannot be empty\"")
            .replace("<!--MAIL-PARAMS-->", " value=\"\" placeholder=\"Cannot be empty\"")
            .replace(/<!--PASS-PARAMS-->/g, " placeholder=\"Cannot be empty\"")
            .replace(/<!--OPERATION-->/g, "new_user")
            .replace("<!--NOTE-->", "")
            .replace("<!--SIG-->", "");
    }

    sendHTMLBody(req, res, text);
}

// for example profil/pokaz/1
function showProfilePage(req, res, params, id, userName, userLevel) {
    for (let index0 in cacheUsers) {
        if (cacheUsers[index0]["filename"] != id[1]) continue;
        const arr = cacheUsers[index0];

        sendHTMLHead(res);
        res.setHeader('Cache-Control', 'no-store');

        let text = genericReplace(req, res, getCacheFileSync('//internal//user.txt'), userName)
            .replace(/<!--TITLE-->/g, arr["Who"])
            .replace("<!--USER-->", arr["Who"])
            .replace("<!--NOTE-->", arr["note"] ? "<hr>" + arr["note"] : "")
            .replace("<!--SIG-->", arr["sig"] ? "<hr>" + arr["sig"] : "");

        if (userName == arr["Who"]) {
            text = text.replace("<!--USER-EDIT-->", "<a href=\"?q=profil/zmien\">Edycja</a>");
        }

        const template = getCacheFileSync('//internal//listentry.txt');

        if (userName != "") {
            const list = getChatList(0, userName);
            txt = "";
            if (list[0]) {
                list[0].forEach(function(arr) {
                    txt += (txt != "" ? "<hr>" : "") + formatChatEntry(template, arr, userName);
                });
            }
            text = text.replace("<!--CHAT-LIST-->", "<div class=ramki><table width=100%><tr><td>" +
                (txt != "" ? (userName == arr["Who"] ? "Ostatnie chaty" : "Ostatnie chaty z Tobą") : "Chat") +
                "</td><td align=right><a href=\"?q=chat/dodaj\">Dodaj</a></td></tr></table><hr>" + txt + "</div>");

            const list2 = getESubList(0, userName);
            txt = "";
            if (list2[0]) {
                list2[0].forEach(function(arr) {
                    txt += (txt != "" ? "<hr>" : "") + formatListEntry(template, arr, userName);
                });
            }
            if (txt != "") {
                text = text.replace("<!--ESUB-LIST-->", "<div class=ramki><table width=100%><tr><td>Kolejka" +
                    "</td></tr></table><hr>" + txt + "</div>");
            }
        }

        let allTypes = [];
        for (let rodzaj in podstronyType) {
            allTypes = allTypes.concat(podstronyType[rodzaj]);
        }

        txt = "";
        ([
            ["biblioteka"],
            ["poczekalnia", "beta"],
            (userName != "") ? ["szkic"] : []
        ]).forEach(function(state) {
            if (state.length == 0) return;
            const list = getPageList(0,
                allTypes, state,
                null,
                null, null,
                "ostatni",
                userName,
                arr["Who"]);
            let t = "";
            if (list[0]) {
                list[0].forEach(function(arr) {
                    t += (t != "" ? "<hr>" : "") + formatListEntry(template, arr, userName);
                });
            }
            if (t != "") {
                txt += "<div class=ramki>Ostatnie teksty (";
                state.forEach(function(s, index) {
                    txt += s + (index != state.length - 1 ? " " : "")
                });
                txt += ")<hr>" + t + "</div>";
            }
        });

        sendHTMLBody(req, res, text.replace("<!--TEXT-LIST-->", txt));
        return;
    }
    directToMain(res);
}

// for example opowiadania/dodaj
// for example opowiadania/zmien/1
function showAddChangeTextPage(req, res, params, id, userName, userLevel) {
    if (userLevel == "0" || !podstronyType[id[1]]) {
        directToMain(res);
        return;
    }
    const arr = id[2] ? decodeSourceFile(getSourceFile("texts", id[2]), false) : null;
    if (id[2]) { //edit
        if (!podstronyType[id[1]].includes(arr["Type"]) || (userLevel != "3" && userName != arr["Who"])) {
            directToMain(res);
            return;
        }
    }

    sendHTMLHead(res);

    let text = genericReplace(req, res, getCacheFileSync('//internal//entryedit.txt'), userName)
        .replace("<!--RODZAJ-->", id[1]);
    if (id[2]) { //edit
        let teaser_text = "";
        let main_text = "";
        arr["OldText"].forEach(function(t0) {
            const t = t0["Text"].slice(0, -1);
            if (t.search('<!--teaser-->') != -1) teaser_text = t.substr(0, t.search('<!--teaser-->') - 1);
            const x = (t.search('<!--teaser-->') != -1 ? t.substr(t.search('<!--teaser-->') + 14) : t);
            if (x != "") main_text = x;
        });

        text = text.replace("<!--TEASER-->", teaser_text)
            .replace("<!--TEXT-->", main_text)
            .replace(/<!--TITLE-->/g, arr["Title"]) //many entries
            .replace("<!--VERSION-->", arr["When"])
            .replace(/<!--PAGEID-->/g, id[2]) //many entries
            .replace("<!--BACK-TO-VIEW-->", "<div align=right><a href=\"?q=" +
                params["q"].replace("zmien", "pokaz") + "\">Powrót do przeglądania tekstu</a></div>");
    } else { //new page
        text = text.replace(/<!--TITLE-->/g, "") //many entries
            .replace("<!--VERSION-->", 0)
            .replace(/<!--PAGEID-->/g, "0"); //many entries
    }

    let txt = "";
    for (let index in cacheUsers) {
        if (cacheUsers[index]["Who"] != userName) {
            const check =
                id[2] ? (arr["Beta"] ? arr["Beta"].split(",").includes(cacheUsers[index]["Who"]) : false) : false;
            txt += addOption(cacheUsers[index]["Who"], cacheUsers[index]["Who"], check);
        }
    }
    text = text.replace("<!--BETAUSERS-->", txt);

    txt = "";
    podstronyState[id[1]].forEach(function(state) {
        if (userLevel != "3" && state == "biblioteka" && id[1] != "hydepark" &&
            (!id[2] || (id[2] && arr["State"] != "biblioteka"))) return;
        txt += addRadio("state", state, state, (!id[2] && state == "szkic" || id[2] && state == arr["State"]), false);
    });
    text = text.replace("<!--STATE-->", txt + "<p>");

    txt = "";
    podstronyType[id[1]].forEach(function(type) {
        txt += addRadio("type", type, type, (podstronyType[id[1]].length == 1 || (id[2] && arr["Type"] == type)), false);
    });
    text = text.replace("<!--TYPE-->", txt + "<p>");

    txt = "<select id=\"tag\" name=\"tag\" size=5 multiple>";
    tag.forEach(function(tax) {
        txt += addOption(tax, tax, (id[2] && arr["Tag"] && arr["Tag"].split(",").includes(tax)));
    });
    text = text.replace("<!--TAG-->", txt + "</select><p>");

    if (userLevel == "3") {
        txt = "<select id=\"special\" name=\"special\" size=5 multiple>";
        special.forEach(function(tax) {
            txt += addOption(tax, tax, (id[2] && arr["Special"] && arr["Special"].split(",").includes(tax)));
        });
        text = text.replace("<!--SPECIAL-->", txt + "</select><p>");
    }

    sendHTMLBody(req, res, text);
}

// for example opowiadania/pokaz/1
function showTextPage(req, res, params, id, userName, userLevel) {
    if (!podstronyType[id[1]]) {
        directToMain(res);
        return;
    }

    getSourceFile("texts", id[2], (data) => {
        const arr = decodeSourceFile(data, false);
        if (!podstronyType[id[1]].includes(arr["Type"]) || (arr["State"] == "szkic" && userName != arr["Who"])) {
            directToMain(res);
            return;
        }

        let teaser_text = "";
        let main_text = "";
        let when_first = 0;
        let versions = "";

        if (arr["Who"] == userName && arr["OldText"].length != 1) {
            versions = "";
            let sel = false;
            arr["OldText"].forEach(function(t0, index) {
                if (when_first == 0) when_first = t0["When"];
                // descend order
                versions = addOption(t0["When"], formatDate(t0["When"]),
                    id[3] ? (t0["When"] == parseInt(id[3].substring(4))) : (index == arr["OldText"].length - 1)) + versions;
                if (sel) return;
                const t = t0["Text"].slice(0, -1);
                if (t.search('<!--teaser-->') != -1) teaser_text = t.substr(0, t.search('<!--teaser-->') - 1);
                const x = (t.search('<!--teaser-->') != -1 ? t.substr(t.search('<!--teaser-->') + 14) : t);
                if (x != "") main_text = x;
                if (id[3] ? (t0["When"] == parseInt(id[3].substring(4))) : (index == arr["OldText"].length - 1)) {
                    sel = true;
                }
            });
            versions = "<br>Wersje tekstu i wstępu<br><select id=\"versions\"  name=\"versions\" size=5>" + versions;

            if (!sel) {
                directToMain(res);
                return;
            }
            versions += "</select>";
            sendHTMLHead(res);
            res.setHeader('Cache-Control', 'no-store');
        } else {
            sendHTMLHead(res);
            res.setHeader('Cache-Control', 'no-store');

            arr["OldText"].forEach(function(t0) {
                if (when_first == 0) when_first = t0["When"];
                const t = t0["Text"].slice(0, -1);
                if (t.search('<!--teaser-->') != -1) teaser_text = t.substr(0, t.search('<!--teaser-->') - 1);
                const x = (t.search('<!--teaser-->') != -1 ? t.substr(t.search('<!--teaser-->') + 14) : t);
                if (x != "") main_text = x;
            });
        }

        let txt = "";
        if (arr["Tag"]) {
            arr["Tag"].split(",").forEach(function(tax) {
                if (txt != "") txt += ", ";
                txt += tax;
            });
        }

        let text = genericReplace(req, res, getCacheFileSync('//internal//entry.txt'), userName)
            .replace(/<!--TITLE-->/g, arr["Title"])
            .replace("<!--TAG-->", txt ? "<br>Tagi: " + txt : "")
            .replace("<!--USER-->", addUserLink(arr["Who"]))
            .replace("<!--TEASER-->", teaser_text)
            .replace("<!--TEXT-->", main_text)
            .replace("<!--TYPE-->", arr["Type"])
            .replace("<!--VERSIONS-->", "<br>" + versions)
            .replace("<!--WHEN-->", versions ? "" : "<br>Dodane: " + formatDate(when_first))
            .replace("<!--WHEN2-->", (when_first != arr["When"] ? "<br>Ostatnio zmienione: " + formatDate(arr["When"]) : ""));

        let lu = arr["When"];
        if (arr["Comments"]) {
            const template0 = getCacheFileSync('//internal//comment0123.txt');
            let txt = "";
            arr["Comments"].forEach(function(comment) {
                txt += template0.replace("<!--USER-->", addUserLink(comment["Who"]))
                    .replace("<!--WHEN-->", formatDate(comment["When"]))
                    .replace("<!--EDITED-->", comment["Edit"] ? " (edited " + formatDate(comment["Edit"]) + ")" : "")
                    .replace("<!--TEXT-->", comment["Text"]);
                lu = comment["When"];
            });
            text = text.replace("<!--COMMENTS-->", txt);
        }
        text = text.replace("<!--LASTUPDATE-->", formatDate(lu));

        if (userName != "") {
            if (arr["Who"] != userName) {
                let txt = "";
                const points = getPointsForText(arr);
                for (let i = 1; i < 11; i++) {
                    txt += addRadio("point", i, i, points == i, points != 0);
                }
                text = text.replace("<!--POINTS-->", "<p>Twoja ocena: " + txt)
                    .replace("<!--VERSION-->", arr["When"])
                    .replace(/<!--PAGEID-->/g, id[2]); //many entries
            }
            if (userLevel != "1") {
                text = text.replace("<!--COMMENTEDIT-->", getCacheFileSync('//internal//commentedit123.txt'))
                    .replace(/<!--PAGEID-->/g, id[2]) //many entries
                    .replace("<!--OBJECT-->", "texts");
            }
            if (userName == arr["Who"] || userLevel == "3") {
                text = text.replace("<!--LOGIN-EDIT-->", "<div align=right><a href=\"?q=" +
                    params["q"].replace("pokaz", "zmien").split('/ver')[0] + "\">Edycja ostatniej wersji</a></div>");
            }
        }

        sendHTMLBody(req, res, text);
    });
}

function formatListEntry(template, arr, userName) {
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
    if (arr["Tag"]) {
        arr["Tag"].split(",").forEach(function(tax) {
            if (txt != "") txt += ", ";
            txt += tax;
        });
    }

    if (userName != "") {
        if (!cacheUsers[userName]["ESub"]) {
            template = template.replace("<!--SUB-->", "<a href=javascript:esub(" + arr["filename"] + ",true);>off</a>");
        } else {
            template = template.replace("<!--SUB-->", "<a href=javascript:esub(" + arr["filename"] + "," +
                !cacheUsers[userName]["ESub"].split(",").includes(arr["filename"]) +
                ");>" + (cacheUsers[userName]["ESub"].split(",").includes(arr["filename"]) ? "on" : "off") + "</a>");
        }
    }

    return template.replace("<!--TAG-->", txt)
        .replace("<!--USER-->", addUserLink(arr["Who"]))
        .replace("<!--TYPE-->", arr["Type"])
        .replace("<!--COMMENTSNUM-->", arr["commentsnum"])
        .replace("<!--WHEN-->", formatDate(arr["When"]));
}

function showMainPage(req, res, page, params, userName) {
    sendHTMLHead(res);

    let text = genericReplace(req, res, getCacheFileSync('//internal//main.txt'), userName)
        .replace("<!--TITLE-->", "");

    const template = getCacheFileSync('//internal//listentry.txt');

    const listGlue = getPageList(page,
        null, ["biblioteka"],
        null,
        "przyklejonegłówna", null,
        "ostatni",
        userName,
        null);

    let txt = "";
    if (listGlue[0]) {
        listGlue[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListEntry(template, arr, userName);
        });
    }
    text = text.replace("<!--LIST-GLUE-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");

    const list = getPageList(page,
        null,
        ["biblioteka"], null,
        "główna", "przyklejonegłówna",
        "ostatni",
        userName,
        null);

    txt = "";
    if (list[0]) {
        list[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListEntry(template, arr, userName);
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
        directToMain(res);
        return;
    }

    const pageNum = id[4] ? parseInt(id[4].substring(1)) : 0;

    const list = getPageList(pageNum,
        typ ? [typ] : podstronyType[rodzaj], status ? [status] : podstronyState[rodzaj],
        tax,
        null, "przyklejone",
        sortLevel == "" ? "ostatni" : sortLevel,
        userName,
        null);

    if (pageNum * onThePage > list[1]) {
        directToMain(res);
        return;
    }

    sendHTMLHead(res);

    let text = genericReplace(req, res, getCacheFileSync('//internal//list.txt'), userName)
        .replace("<!--TITLE-->", rodzaj + (typ != "" ? "/" + typ : "") + (status != "" ? "/" + status : ""))
        .replace("<!--RODZAJ-->", rodzaj)
        .replace("<!--CRITERIA-->", getCacheFileSync("//internal//criteria0123.txt"))
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
    tag.forEach(function(t) {
        txt += (txt != "" ? " | " : "") +
            (tax == t ? "<b>" + t + "</b>" : buildURLForListPage(t, rodzaj, typ, status, pageNum, sortLevel, t));
    });
    text = text.replace("<!--TAG-->", txt);

    txt = "";
    sortParam.forEach(function(s) {
        txt += (txt != "" ? " | " : "") +
            ((!sortLevel && s == "ostatni") || (sortLevel == s) ?
                "<b>" + s + "</b>" : buildURLForListPage(s, rodzaj, typ, status, pageNum, s, tax));
    });
    text = text.replace("<!--SORTBY-->", txt);

    const template = getCacheFileSync('//internal//listentry.txt');

    const listGlue = getPageList(0,
        podstronyType[rodzaj], status ? [status] : podstronyState[rodzaj],
        null,
        "przyklejone", null,
        "ostatni",
        userName,
        null);

    txt = "";
    if (listGlue[0]) {
        listGlue[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListEntry(template, arr, userName);
        });
    }
    text = text.replace("<!--LIST-GLUE-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : "");

    txt = "";
    if (list[0]) {
        list[0].forEach(function(arr) {
            txt += (txt != "" ? "<hr>" : "") + formatListEntry(template, arr, userName);
        });
    }

    sendHTMLBody(req, res, text.replace("<!--LIST-->", txt != "" ? "<div class=ramki>" + txt + "</div>" : ""));
}

function setRefreshSession(token, firstCall) {
    sessions.forEach(function(sessionEntry, index) {
        if (sessionEntry[SessionField.SessionToken] != token) return;
        if (sessionEntry[SessionField.RefreshCallback] != null) clearTimeout(sessionEntry[SessionField.RefreshCallback]);
        if (!firstCall) {
            newtoken = crypto.randomBytes(32).toString('base64');
            [callbackChat, callbackText, callbackOther].forEach(function(callback) {
                for (let index0 in callback) {
                    for (let index in callback[index0]) {
                        if (callback[index0][index][CallbackField.SessionToken] != token) continue;
                        callback[index0][index][CallbackField.SessionToken] = newtoken;
                        sendNewTokenToPage(callback[index0][index][CallbackField.ResponseCallback], newtoken);
                    }
                }
            });
        } else {
            newtoken = token;
        }
        console.log(token + " -> " + newtoken);
        sessionEntry[SessionField.SessionToken] = newtoken;
        sessionEntry[SessionField.RefreshCallback] = setTimeout(function() {
            setRefreshSession(newtoken, false);
        }, 30000); //30 seconds
        sessionEntry[SessionField.Expiry] = Date.now() + 1000 * 50;
    });
}

function addToCallback(req, res, id, callback, userName, other, token) {
    res.writeHead(200, {
        'Cache-Control': 'no-cache',
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
    });
    sendCommentToPage(res, null);
    const session = crypto.randomBytes(32).toString('base64');
    if (other && !callback[id]) callback[id] = [];
    // order consistent with CallbackField
    callback[id][session] = [res, userName, token];
    res.on('close', function() {
        sessions.forEach(function(sessionEntry, index) {
            if (sessionEntry[SessionField.Expiry] < Date.now()) {
                if (sessionEntry[SessionField.RefreshCallback] != null) clearTimeout(sessionEntry[SessionField.RefreshCallback]);
                sessionEntry.splice(index, 1);
                return;
            }
            if (sessionEntry[SessionField.SessionToken] == callback[id][session][CallbackField.SessionToken]) {
                if (sessionEntry[SessionField.RefreshCallback] != null) clearTimeout(sessionEntry[SessionField.RefreshCallback]);
            }
        });
        delete callback[id][session];
    });
    setTimeout(function() {
        res.end();
    }, 60000); //60 seconds
    setRefreshSession(token, true);
}

function parseGETWithQParam(req, res, params, userName) {
    //must be before opowiadania/dodaj i opowiadania/zmien/1
    if (params["q"] == "profil/dodaj") {
        showAddChangeProfilePage(req, res, params, userName, getUserLevelUserName(userName));
        return;
    } else if (params["q"] == "haslo/zmien/1") {
        showPassReminderPage(req, res, params, userName);
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
    } else if (params["q"] == "logingoogle") { // userName==""
        showLoginGooglePage(req, res, userName);
        return;
    }
    let id = params["q"].match(/^changepass\/([A-Za-z0-9+\/=]+)$/);
    if (id) {
        showChangePasswordPage(req, res, params, id, userName);
        return;
    }
    id = params["q"].match(/^verifymail\/([A-Za-z0-9+\/=]+)$/);
    if (id) {
        showMailVerifyPage(req, res, params, id, userName);
        return;
    }
    // must be before opowiadania/pokaz/1
    id = params["q"].match(/^profil\/pokaz\/([0-9]+)$/);
    if (id) {
        showProfilePage(req, res, params, id, userName, getUserLevelUserName(userName));
        return;
    }
    // for example opowiadania/pokaz/1
    id = params["q"].match(/^([a-ząż]+)\/pokaz\/([0-9]+)(\/ver{1,1}[0-9]*)?$/);
    if (id) {
        showTextPage(req, res, params, id, userName, getUserLevelUserName(userName));
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
    directToMain(res);
}

function parseGETWithSetParam(req, res, params) {
    if (params["set"] == "mobile1") {
        res.setHeader('Set-Cookie', 'mobile=' +
            (isMobile(req) ? "; expires=Sun, 21 Dec 1980 14:14:14 GMT" : "1; SameSite=Strict; Secure"));
    } else if (params["set"] == "mobile0") {
        res.setHeader('Set-Cookie', 'mobile=' +
            (isMobile(req) ? "0; SameSite=Strict; Secure" : "; expires=Sun, 21 Dec 1980 14:14:14 GMT"));
    } else if (params["set"] == "dark1") {
        res.setHeader('Set-Cookie', 'dark=1; SameSite=Strict; Secure');
    } else if (params["set"] == "dark0") {
        res.setHeader('Set-Cookie', 'dark=0; SameSite=Strict; Secure');
    }
    res.statusCode = 302;
    res.setHeader('Location', req.headers['referer']);
    res.end();
}

function parseGETWithSseParam(req, res, userName, cookieSessionToken) {
    //check field format
    //            console.log(req.headers);
    //fixme - we need checking URL beginning
    let id = req.headers['referer'].match(/.*chat\/pokaz\/([0-9]+)$/);
    if (id && fs.existsSync(__dirname + "//chat//" + id[1] + ".txt")) {
        addToCallback(req, res, id[1], callbackChat, userName, false, cookieSessionToken);
        return;
    }
    id = req.headers['referer'].match(/.*([a-ząż]+)\/pokaz\/([0-9]+)(\/ver{1,1}[0-9]*)?$/);
    if (id && fs.existsSync(__dirname + "//texts//" + id[2] + ".txt")) {
        addToCallback(req, res, id[2], callbackText, userName, false, cookieSessionToken);
        return;
    }
    const params = url.parse(req.headers['referer'], true).query;
    addToCallback(req, res, params["q"] ? params["q"] : "", callbackOther, userName, true, cookieSessionToken);
}

const onRequestHandler = (req, res) => {
    if (req.url == "/external/styles.css" || req.url == "/external/dark.css" || req.url == "/external/sha256.js" ||
        req.url == "/external/suneditor.min.css" || req.url == "/external/suneditor.min.js") {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/' +
            (req.url.includes('.js') ? 'javascript' : 'css') + '; charset=UTF-8');
        res.setHeader('Cache-Control', 'must-revalidate');
        const stats = fs.statSync(path.normalize(__dirname + req.url));
        res.setHeader('Last-Modified', stats.mtime.toUTCString());
        if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('br')) {
            res.setHeader('Content-Encoding', 'br');
            res.end(getCacheFileSync(req.url + "_br"));
        } else if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('gzip')) {
            res.setHeader('Content-Encoding', 'gzip');
            res.end(getCacheFileSync(req.url + "_gzip"));
        } else if (req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('deflate')) {
            res.setHeader('Content-Encoding', 'deflate');
            res.end(getCacheFileSync(req.url + "_deflate"));
        } else {
            res.end(getCacheFileSync(req.url));
        }
        return;
    } else if (req.url == "/favicon.ico") {
        directToOKFileNotFound(res, '', false);
        return;
    }

    console.log(' ');
    let cookieSessionToken = "";
    let userName = null;
    //console.log(req.headers);
    if (req.headers['cookie']) {
        console.log(req.headers['cookie']);
        req.headers['cookie'].split("; ").forEach(function(cookie) {
            if (cookie.indexOf("session=") == 0) cookieSessionToken = cookie.substr(8);
        });
    }
    if (cookieSessionToken != "") {
        sessions.forEach(function(session, index) {
            if (session[SessionField.Expiry] < Date.now()) {
                if (session[SessionField.RefreshCallback] != null) clearTimeout(session[SessionField.RefreshCallback]);
                sessions.splice(index, 1);
                return;
            }
            if (cookieSessionToken == session[SessionField.SessionToken]) {
                userName = session[SessionField.UserName];
                console.log("found user " + userName);
            }
        });
    }
    if (userName == null) {
        cookieSessionToken = "";
        userName = "";

        const session = crypto.randomBytes(32).toString('base64');
        res.setHeader('Set-Cookie', 'session=' + session + '; SameSite=Strict; Secure');

        // order must be consistent with SessionField
        sessions.push([session, Date.now() + 1000 * 60, '', null]); // 60 seconds, non logged

        console.log("nowa sesja " + session);
    }
    console.log('user name is ' + userName);

    if (req.method === 'GET') {
        console.log(req.url);
        const params = url.parse(req.url, true).query;
        if (params["sse"] && cookieSessionToken != "") { // PUSH functionality
            parseGETWithSseParam(req, res, userName, cookieSessionToken);
        } else if (params["set"]) { // setting cookies with config
            parseGETWithSetParam(req, res, params);
        } else if (params["q"]) {
            parseGETWithQParam(req, res, params, userName);
        } else {
            showMainPage(req, res, 0, [], userName);
        }
    } else if (req.headers['content-type'] == "application/x-www-form-urlencoded" && cookieSessionToken != "") { // POST
        let body = "";
        req.on('data', function(data) {
            body += data;
            if (body.length > 1e6 * 6) req.connection.destroy(); // 6 MB 
        });
        req.on('end', function() {
            console.log(body);
            parsePOSTforms(url.parse("/?" + body, true).query, res, userName, cookieSessionToken);
        });
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

if (!fs.existsSync(__dirname + '//users')) fs.mkdirSync(__dirname + '//users');
fs.readdirSync(__dirname + '//users').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    arr = decodeSourceFile(getSourceFile("users", file.replace(".txt", "")), false);
    if (cacheUsers[arr["Who"]]) process.exit(2); // duplicate user
    addToUsersCache(arr["Who"], arr, file.replace(".txt", ""));
})

if (!fs.existsSync(__dirname + '//texts')) fs.mkdirSync(__dirname + '//texts');
fs.readdirSync(__dirname + '//texts').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    addToTextCache(file.replace(".txt", ""), getSourceFile("texts", file.replace(".txt", "")));
})

if (!fs.existsSync(__dirname + '//chat')) fs.mkdirSync(__dirname + '//chat');
if (!fs.existsSync(__dirname + '//chat//0.txt')) {
    fs.appendFileSync(__dirname + "//chat//0.txt", "Title:Shoutbox\nWhen:" + formatDate(Date.now()) + "\n");
}
fs.readdirSync(__dirname + '//chat').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    addToChatCache(file.replace(".txt", ""), getSourceFile("chat", file.replace(".txt", "")));
})

//http.createServer(onRequestHandler).listen // delete secure from set-cookie when using this
http2.createSecureServer({
    key: fs.readFileSync(__dirname + '//internal//localhost-privkey.pem'),
    cert: fs.readFileSync(__dirname + '//internal//localhost-cert.pem')
}, onRequestHandler).listen(port, hostname, () => {
    console.log(`Server running at https://${hostname}:${port}/`);
});