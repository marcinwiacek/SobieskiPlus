//formatted with js-beautify

const hostname = '127.0.0.1';
const port = 3000;
var callbackID = 0;

podstronyType = new Array();
podstronyType["opowiadania"] = new Array("opowiadanie", "szort");
podstronyType["publicystyka"] = new Array("artykul", "felieton");

podstronyState = new Array();
podstronyState["opowiadania"] = new Array("biblioteka", "beta", "archiwum");
podstronyState["publicystyka"] = new Array("artykuly", "felietony", "poradniki");

const http = require('http');
const fs = require('fs');
const url = require('url');
const crypto = require('crypto');

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
                arr["Text"] = arr["Text"] + line + "\n";
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
                comment["Text"] = comment["Text"] + line + "\n";
                break;
        }
    });
    if (comment != null) {
        if (!arr["Comments"]) arr["Comments"] = new Array();
        arr["Comments"].push(comment);
    }
    console.log(arr);
    return arr;
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

function readFileContent(fileName) {
    var x = fs.readFileSync(__dirname + fileName, 'utf8');
    if (x.charCodeAt(0) == 65279) x = x.substring(1);
    return x;
}

function parsePOSTforms(params, req, res) {
    console.log(params);

    if (params["q"] && params["q"] == "upload_comment" && params["tekst"] && params["comment"]) {
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
        return;
    }

    if (params["q"] == "change_text" && params["title"] && params["tekst"] && params["text"] &&
        params["state"] && params["type"]) {
        /*            if ($_POST["tekst"] == "0") {*/
        if (fs.existsSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt")) {
            fs.appendFileSync(__dirname + "\\teksty\\" + params["tekst"] + ".txt",
                "\n<!--change-->\n" +
                "Title:" + params["title"] + "\n" +
                "State:" + params["state"] + "\n" +
                "Type:" + params["type"] + "\n" +
                //                          "When:".date("d M Y H:i:s", $t)."\n"+
                "Author:marcin\n\n" +
                params["text"]
            );
        }
    }

    if (params["login"] && params["user"] && params["password"] && !req.headers.cookie) {
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
                cookies.push(salt);
                console.log("jest login");
                res.setHeader('Set-Cookie', 'login=' + salt);
                found = true;
            });
        });

        if (!found) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'Content-Type: text/plain');
            res.end();
        }
    }
}

function updateComment(comment, res) {
    console.log("jest callbark");
    var template = fs.readFileSync(__dirname + '\\internal\\comment.txt', 'utf8');
    template = template.replace("<!--USER-->", comment["Author"]);
    template = template.replace("<!--TITLE-->", comment["Title"]);
    //           template = text.replace("<!--WHEN-->", date("d M Y H:i:s", $comment["When"]), $template);
    template = template.replace("<!--TEXT-->", comment["Text"]);

    res.write("data: " + encodeURI(template) + "\n\n")
}

function pokazStrona(res, params, id) {
    if (!podstronyType[id[1]]) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    var arr = decodeFileContent(fs.readFileSync(__dirname + '\\teksty\\' + id[2] + '.txt', 'utf8'), true);
    if (!podstronyType[id[1]].includes(arr["Type"])) {
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
    }

    var text = fs.readFileSync(__dirname + '\\internal\\entry.txt', 'utf8');
    text = text.replace("<!--MENU-->", fs.readFileSync(__dirname + '\\internal\\menu.txt', 'utf8'));
    text = text.replace("<!--JS-->", fs.readFileSync(__dirname + '\\internal\\js.txt', 'utf8'));
    text = text.replace("<!--LOGIN-LOGOUT-->", fs.readFileSync(__dirname + '\\internal\\login.txt', 'utf8'));

    text = text.replace(/<!--TITLE-->/g, arr["Title"]);
    text = text.replace("<!--USER-->", arr["Author"]);
    text = text.replace("<!--TEXT-->", arr["Text"]);
    text = text.replace("<!--TYPE-->", arr["Type"]);
    text = text.replace("<!--SPECIES-->", arr["Species"]);
    //       text = text.replace("<!--WHEN-->",arr["Text"]);

    if (arr["Comments"]) {
        const template0 = fs.readFileSync(__dirname + '\\internal\\comment.txt', 'utf8');
        var txt = "";
        arr["Comments"].forEach(function(comment) {
            var template = template0;
            template = template.replace("<!--USER-->", comment["Author"]);
            template = template.replace("<!--TITLE-->", comment["Title"]);
            //           template = text.replace("<!--WHEN-->", date("d M Y H:i:s", $comment["When"]), $template);
            template = template.replace("<!--TEXT-->", comment["Text"]);
            txt = txt + template;
        });
        text = text.replace("<!--COMMENTS-->", txt);
    }
    //    $text = str_replace_first("<!--LASTUPDATE-->", $last, $text);
    //if ($userID!="") {
    text = text.replace("<!--COMMENTEDIT-->", fs.readFileSync(__dirname + '\\internal\\commentedit.txt', 'utf8'));
    //    }
    text = text.replace(/<!--PAGEID-->/g, id[2]); //many entries

    //  if ($userID!="") {
    text = text.replace("<!--LOGIN-EDIT-->", "<div align=right><a href=?q=" + params["q"] + "/edit>Edycja</a></div>");
    //  }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'Content-Type: text/html; charset=UTF-8');
    res.end(text);
}

function pokazLista(res, params, id) {
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

    const pageNum = 0;
    /*
                    if (isset($id[3])) {
                        $pageNum = intval(substr($id[3], 1, strlen($id[3])-1));
                    }
*/

    list = getPageList(pageNum, new Array(id[2]), typ == "" ? podstronyType[id[1]] : new Array(typ),
        new Array("inne", "scifi"), "", 0);

    var text = fs.readFileSync(__dirname + '\\internal\\list.txt', 'utf8');

    text = text.replace("<!--TITLE-->", "");
    text = text.replace("<!--MENU-->", fs.readFileSync(__dirname + '\\internal\\menu.txt', 'utf8'));
    text = text.replace("<!--JS-->", fs.readFileSync(__dirname + '\\internal\\js.txt', 'utf8'));
    text = text.replace("<!--LOGIN-LOGOUT-->", fs.readFileSync(__dirname + '\\internal\\login.txt', 'utf8'));

    /*    $text = readFileContent("internal/list.txt");
        $text = genericReplace($text, $userID);
        $text = str_replace_first("<!--TITLE-->", "", $text);

        $template = readFileContent("internal/criteria.txt");

        $txt = "";
        if ($typ=="") {
            $txt = $txt."<b>wszystkie</b>, ";
        } else {
            $txt = $txt."<a href=?q=".$id[1]."/".$id[2];
            if (isset($_GET["s"])) { $txt = $txt."&s=".$_GET["s"];
            }
            $txt=$txt.">wszystkie</a>, ";
        }
        foreach($podstronyType[$id[1]] as $t) {
            if ($typ==$t) {
                $txt = $txt."<b>$t</b>, ";
            } else {
                $txt = $txt."<a href=?q=".$id[1]."/".$id[2]."&t=$t";
                if (isset($_GET["s"])) { $txt = $txt."&s=".$_GET["s"];
                }
                $txt = $txt.">$t</a>, ";
            }
        }
        $template = str_replace_first("<!--TYPE-->", $txt, $template);

        $txt = "";
        foreach($podstronyState[$id[1]] as $t) {
            if ($id[2] == $t) {
                $txt = $txt."<b>$t</b>, ";
            } else {
                $txt = $txt."<a href=?q=".$id[1]."/".$t.">$t</a>, ";
            }
        }
        $template = str_replace_first("<!--STATE-->", $txt, $template);

        $txt = "";
        foreach(array("date","author","comments") as $t) {
            if ((!isset($_GET["s"]) && $t=="date") || (isset($_GET["s"]) && $_GET["s"]==$t)) {
                $txt = $txt."<b>$t</b>, ";
            } else {
                $txt = $txt."<a href=?q=".$id[1]."/".$id[2]."&s=$t";
                if (isset($_GET["t"])) { $txt = $txt."&t=".$_GET["t"];
                }
                $txt = $txt.">$t</a>, ";
            }
        }
        $template = str_replace_first("<!--SORTBY-->", "$txt", $template);

        $text = str_replace_first("<!--CRITERIA-->", $template, $text);

    */
    if (list) {
        const template0 = fs.readFileSync(__dirname + '\\internal\\listentry.txt', 'utf8');
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
            txt = txt + template;
        });
        text = text.replace("<!--LIST-->", txt);
    }

    var txt = "";
    if (params["s"]) txt = "&s=" + params["s"];
    if (params["t"]) txt = txt + "&t=" + params["t"];
    text = text.replace("<!--NEXTLINK-->",
        "<a href=?q=" + id[1] + "/" + id[2] + "/" + (pageNum - 1) + txt + ">&lt; Prev page</a>&nbsp;" +
        "<a href=?q=" + id[1] + "/" + id[2] + "/" + (pageNum + 1) + txt + ">Next page &gt;</a>"
    );

    //  if ($userID!="") {
    //    $text = str_replace_first("<!--LOGIN-NEW-->", "<div align=right><a href=?q=".$_GET["q"]."/add>Nowy tekst</a></div>", $text);
    //}

    //}

    res.statusCode = 200;
    res.setHeader('Content-Type', 'Content-Type: text/html; charset=UTF-8');
    res.end(text);
}

function genericReplace(text) {
    const session = crypto.randomBytes(32).toString('base64');
    sessions.push(session);

    text = text.replace("<!--MENU-->", fs.readFileSync(__dirname + '\\internal\\menu.txt', 'utf8'));
    text = text.replace("<!--JS-->", fs.readFileSync(__dirname + '\\internal\\js.txt', 'utf8'));
    text = text.replace("<!--LOGIN-LOGOUT-->", fs.readFileSync(__dirname + '\\internal\\login.txt', 'utf8'));
    return text.replace("<!--HASH-->", session);
}

const server = http.createServer((req, res) => {
    //console.log(req.url);
    if (req.url == "/external/styles.css") {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'Content-Type: text/css');
        res.end(fs.readFileSync(__dirname + '\\external\\styles.css', ''));
        return;
    }
    if (req.url == "/external/quill.snow.css") {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'Content-Type: text/css');
        res.end(fs.readFileSync(__dirname + '\\external\\quill.snow.css', ''));
        return;
    }
    if (req.url == "/external/sha256.js") {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'Content-Type: text/javascript');
        res.end(fs.readFileSync(__dirname + '\\external\\sha256.js', ''));
        return;
    }
    if (req.url == "/external/quill.min.js") {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'Content-Type: text/javascript');
        res.end(fs.readFileSync(__dirname + '\\external\\quill.min.js', ''));
        return;
    }
    if (req.url == "/favicon.ico") {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'Content-Type: text/plain');
        res.end();
        return;
    }
    if (req.method === 'GET') {
        const params = url.parse(req.url, true).query;

        // PUSH functionality
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
                if (params["fileid"] == entry["filename"]) {
                    entry["callback"][id] = new Array(updateComment, res);
                }
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
            var id = params["q"].match(/^([a-z]+)\/pokaz\/([0-9\-]+)$/);
            if (id) {
                pokazStrona(res, params, id);
                return;
            }
            // for example opowiadania/biblioteka
            var id = params["q"].match(/^([a-z]+)\/([a-z]+)(\/{1,1}[0-9]*)?$/);
            if (id) {
                pokazLista(res, params, id);
                return;
            }
        }
    } else if (req.headers['content-type'] == "application/x-www-form-urlencoded") {
        var body = "";
        req.on('data', function(data) {
            body += data;
            if (body.length > 1e6 * 6) { // 6 MB 
                req.connection.destroy();
            }
        });
        req.on('end', function() {
            parsePOSTforms(url.parse("/?" + body, true).query, req, res);
            return;
        });
        return;
    }

    var text = fs.readFileSync(__dirname + '\\internal\\main.txt', 'utf8');
    text = text.replace("<!--TITLE-->", "");
    text = genericReplace(text);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'Content-Type: text/html; charset=UTF-8');
    res.end(text);
});

var cache = new Array();
fs.readdirSync(__dirname + '\\teksty').filter(file => (file.slice(-4) === '.txt')).forEach((file) => {
    console.log(file);
    var x = decodeFileContent(fs.readFileSync(__dirname + '\\teksty\\' + file, 'utf8'), false);
    x["filename"] = file.replace(".txt", "");
    x["callback"] = new Array();
    cache.push(x);
})

var sessions = new Array();
var cookies = new Array();

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});