<?php

//filesystem limit for one folder
$gMaxPerFolder=10000000;

$gEntryPerPage = 10;

function strncmp_startswith($haystack, $needle)
{
    return strncmp($haystack, $needle, strlen($needle)) === 0;
}

function str_replace_first($search, $replace, $subject) 
{
    $pos = strpos($subject, $search);
    if ($pos !== false) {
        return substr_replace($subject, $replace, $pos, strlen($search));
    }
    return $subject;
}

function readFileContent($fileName)
{
    $nodeFileName = $fileName;

    $handle = @fopen($nodeFileName, "r");
    if ($handle == false) {
        header('HTTP/1.1 404 Not Found');
        exit;
    }

    $text = fread($handle, filesize($nodeFileName));
    if (!$text) {
        header('HTTP/1.1 404 Not Found');
        exit;
    }
    fclose($handle);

    // support for UTF8 files
    if (ord($text[0])==239) {
        return substr($text, 3);
    }
    return $text;
}

abstract class DecodingLevel
{
    const MainHeaders = 1;
    const MainText = 2;
    const CommentHeaders = 3;
    const CommentText = 4;
}

// one weakness - we don't have edits for comments
// maybe <!--commentedit?-->
function decodeFileContent0($text,$headersOnly,$normalHeaders,$commentInFile,$commentInArr,$commentHeaders)
{
    $arr = array();
    $parsingLevel = DecodingLevel::MainHeaders;
    if ($headersOnly) {
        foreach(preg_split("/\\r\\n|\\r|\\n/", $text) as $singleLine) {
            if ($singleLine == $commentInFile) {
                $parsingLevel = DecodingLevel::CommentHeaders;
                continue;
            } else if ($singleLine == "<!--change-->") {
                $parsingLevel = DecodingLevel::MainHeaders;
                continue;
            }
            if ($parsingLevel== DecodingLevel::MainHeaders) {
                if ($singleLine == "") {
                    $parsingLevel = DecodingLevel::MainText;
                } else {
                    $x = explode(":", $singleLine);
                    if (count($x)>=2 && in_array($x[0], $normalHeaders)) { 
                        $arr[$x[0]] = substr($singleLine, strlen($x[0])+1, strlen($singleLine)-strlen($x[0])); 
                    }
                }
            }
        }
        $arr["When"] = strtotime($arr["When"]);
        return $arr;
    }
    $arr["Text"]="";
    foreach(preg_split("/\\r\\n|\\r|\\n/", $text) as $singleLine) {
        if ($singleLine == $commentInFile) {
            if (isset($comment)) {
                if (!isset($arr[$commentInArr])) {
                    $arr[$commentInArr] = array();
                }
                $comment["When"] = strtotime($comment["When"]);
                array_push($arr[$commentInArr], $comment);
            }
            $parsingLevel = DecodingLevel::CommentHeaders;
            $comment = array();
            $comment["Text"] = "";
            continue;
        } else if ($singleLine == "<!--change-->") {
            $parsingLevel = DecodingLevel::MainHeaders;
            continue;
        }

        switch ($parsingLevel) {
        case DecodingLevel::MainHeaders:
            if ($singleLine == "") {
                $parsingLevel = DecodingLevel::MainText;
            } else {
                $x = explode(":", $singleLine);
                if (count($x)>=2 && in_array($x[0], $normalHeaders)) {
                        $arr[$x[0]] = substr($singleLine, strlen($x[0])+1, strlen($singleLine)-strlen($x[0])); 
                }
            }
            break;
        case DecodingLevel::MainText:
            $arr["Text"] = $arr["Text"].$singleLine."\n";
            break;
        case DecodingLevel::CommentHeaders:
            if ($singleLine == "") {
                $parsingLevel = DecodingLevel::CommentText;
            } else {
                $x = explode(":", $singleLine);
                if (count($x)>=2 && in_array($x[0], $commentHeaders)) {
                        $comment[$x[0]] = substr($singleLine, strlen($x[0])+1, strlen($singleLine)-strlen($x[0])); 
                }
            }
            break;
        case DecodingLevel::CommentText:
            $comment["Text"] = $comment["Text"].$singleLine."\n";
            break;
        }
    }

    if (isset($comment)) {
        if (!isset($arr[$commentInArr])) {
            $arr[$commentInArr] = array();
        }
        $comment["When"] = strtotime($comment["When"]);
        array_push($arr[$commentInArr], $comment);
    }
    $arr["When"] = strtotime($arr["When"]);
    return $arr;
}

function decodeFileContent($text,$headersOnly)
{
        return decodeFileContent0(
            $text, $headersOnly,
            array("Title","Author","Taxonomy","MainPage","When","State","Type","Species"),
            "<!--comment-->",
            "Comments",
            array("Title","Author","When")
        );
}

function GetPagesList($pageNum, $stateList, $typeList, $speciesList, $taxonomy) 
{
    global $gEntryPerPage;

    $files = array();
    $i=0;

    if (file_exists("test.db")) {
        $db = new SQLite3("test.db");
        $db->busyTimeout(5000);
        $statement = $db->prepare(
            "SELECT mod, filename, title, whentime, ".
            "state, type, species,taxonomy,author FROM pages ORDER by whentime"
        );
        $result = $statement->execute();
        while ($row = $result->fetchArray()) {
            /*            if (filemtime("teksty/".$row["filename"].".txt")!=$row["mod"]) {
                    $arr = decodeFileContent(readFileContent("teksty/".$fileNameArray[1].".txt"), true);
                $db->exec(
                    "UPDATE  pages SET mod=".filemtime("teksty/".$row["filename"].".txt").
                    ",title='".$arr["Title"].
                    "',whentime='".$arr["When"].
                    "',state='".$arr["State"].
                    "',type='".$arr["Type"].
                    "',species='".$arr["Species"].
                    "',taxonomy='".$arr["Taxonomy"].
                    "',author='".$arr["Author"]."' WHERE filename='".$row["filename"]."'"
                );
            }
            */
            if (!in_array($row["state"], $stateList)) { continue;
            }
            if (!in_array($row["type"], $typeList)) { continue;
            }
            if (!in_array($row["species"], $speciesList)) { continue;
            }
            if ($taxonomy!="" && isset($row["taxonomy"])) {
                $tax = explode(",", $row["taxonomy"]);
                if (!in_array($taxonomy, $tax)) { continue;
                }
            }
            $arr= array();
            $arr["Author"]=$row["author"];
            $arr["Title"]=$row["title"];
            $arr["When"]=$row["whentime"];
            $arr["State"]=$row["state"];
            $arr["Type"]=$row["type"];
            $arr["Species"]=$row["species"];
            $arr["Taxonomy"]=$row["taxonomy"];
            $i++;
            if ($i>=$gEntryPerPage*$pageNum) {
                       $files[$row["filename"]] = $arr;
            }
            if ($i>=$gEntryPerPage*($pageNum+1)) { break;
            }
        }
        $db->close();
        return $files;
    }

    $db = new SQLite3("test.db");
    $db->busyTimeout(5000);
    $db->exec('PRAGMA journal_mode = wal;');
    $db->exec(
        "CREATE TABLE IF NOT EXISTS pages(mod INTEGER, filename TEXT, title TEXT, whentime TEXT, ".
        "state TEXT, type TEXT, species TEXT, taxonomy TEXT, author TEXT)"
    );
    $db->exec('BEGIN');
    foreach (scandir("teksty", 0) as $file) {
        if (is_file("teksty/$file") && preg_match("/^(.*)\.txt/", $file, $fileNameArray)) {
            $arr = decodeFileContent(readFileContent("teksty/".$fileNameArray[1].".txt"), true);
            $db->exec(
                "INSERT INTO pages(mod, filename, title, whentime, state, type, species, taxonomy, author) ".
                "VALUES(".filemtime("teksty/".$fileNameArray[1].".txt").",'".$fileNameArray[1]."','".$arr["Title"]."','".
                $arr["When"]."','".$arr["State"]."','".$arr["Type"]."','".$arr["Species"]."','".
                $arr["Taxonomy"]."','".$arr["Author"]."')"
            );

            if (!isset($arr["State"]) || !in_array($arr["State"], $stateList)) { continue;
            }
            if (!isset($arr["Type"]) || !in_array($arr["Type"], $typeList)) { continue;
            }
            if (!isset($arr["Species"]) || !in_array($arr["Species"], $speciesList)) { continue;
            }
            if ($taxonomy!="" && isset($arr["Taxonomy"])) {
                $tax = explode(",", $arr["Taxonomy"]);
                if (!in_array($taxonomy, $tax)) { continue;
                }
            }
            $i++;
            if ($i>=$gEntryPerPage*$pageNum && $i<$gEntryPerPage*($pageNum+1)) {
                $files[$fileNameArray[1]] = $arr;
            }
        }
    }

    $db->exec('COMMIT');
    $db->close();

    //    uksort($fileNames,"cmpByDate");

    return $files;
}

function decodeFileContent2($text,$headersOnly)
{
        return decodeFileContent0(
            $text, $headersOnly,
            array("When","Author","Mail","Password"),
            "<!--PW-->",
            "PW",
            array("To","When","From")
        );
}

function genericReplace($text,$userID) 
{
    $text = str_replace_first("<!--MENU-->", readFileContent("templates/menu.txt"), $text);
    $text = str_replace_first("<!--JS-->", readFileContent("templates/js.txt"), $text);
    if ($userID!="") {
        $text = str_replace_first("<!--LOGIN-LOGOUT-->", readFileContent("templates/logout.txt"), $text);
    } else {
        $text = str_replace_first("<!--LOGIN-LOGOUT-->", readFileContent("templates/login.txt"), $text);

        $db = new SQLite3("session.db");
        $db->busyTimeout(5000);
        $db->exec(
            "CREATE TABLE IF NOT EXISTS sessions(expire INTEGER, userID TEXT, token TEXT, salt TEXT); ".
            "delete from sessions where expire < ".time().";"
        );

        $salt = random_int(0, PHP_INT_MAX-1);
        $text = str_replace_first("<!--HASH-->", $salt, $text);
        $db->exec(
            "INSERT INTO sessions(expire, userID, token, salt) ".
            "VALUES(".(time()+(30 * 60)).",'','',".$salt.")"
        );
        $db->close();
    }
    return $text;
}

$userID="";
if (isset($_COOKIE["login"])) {
    $db = new SQLite3("session.db");
    $db->busyTimeout(5000);
    $db->exec(
        "CREATE TABLE IF NOT EXISTS sessions(expire INTEGER, userID TEXT, token TEXT, salt TEXT); ".
        "delete from sessions where expire < ".time().";"
    );
    //TODO: limit number of sessions per user
    $statement = $db->prepare(
        "SELECT userID from sessions where token = '".$_COOKIE["login"]."';"
    );
    $result = $statement->execute();
    while ($row = $result->fetchArray()) {
        $userID=$row['userID'];
    }
    $db->close();
}

$podstronyType = array();
$podstronyType["opowiadania"]=array("opowiadanie","szort");
$podstronyType["publicystyka"]=array("artykul","felieton");

// showing text page
// for example: opowiadanie/pokaz/1
if (isset($_GET["q"]) && preg_match("/^([a-z]+)\/pokaz\/([0-9\-]+)$/", $_GET["q"], $id)) {
    if (!isset($podstronyType[$id[1]])) {
        header('Location: '.$_SERVER['PHP_SELF']);
        exit(0);
    }

    $arr = decodeFileContent(readFileContent("teksty/".$id[2].".txt"), false);
    if (!in_array($arr["Type"], $podstronyType[$id[1]])) { 
        header('Location: '.$_SERVER['PHP_SELF']);
        exit(0);
    }

    $text = readFileContent("templates/entry.txt");
    $text = genericReplace($text, $userID);
    $text = str_replace("<!--TITLE-->", $arr["Title"], $text); // multiple instances
    $text = str_replace_first("<!--USER-->", $arr["Author"], $text);
    $text = str_replace_first("<!--TEXT-->", $arr["Text"], $text);
    $text = str_replace_first("<!--TYPE-->", $arr["Type"], $text);
    $text = str_replace_first("<!--SPECIES-->", $arr["Species"], $text);
    $last = $arr["When"];
    if (isset($arr["Comments"])) {
        $template0 = readFileContent("templates/comment.txt");
        $txt = "";
        foreach($arr["Comments"] as $comment) {
            $last = $arr["When"];
            $template = $template0;
            $template = str_replace_first("<!--USER-->", $comment["Author"], $template);
            $template = str_replace_first("<!--TITLE-->", $comment["Title"], $template);
            $template = str_replace_first("<!--WHEN-->", date("d M Y H:i:s", $comment["When"]), $template);
            $template = str_replace_first("<!--TEXT-->", $comment["Text"], $template);

            $txt = $txt.$template;
        }
        $text = str_replace_first("<!--COMMENTS-->", $txt, $text);
    }
    $text = str_replace_first("<!--LASTUPDATE-->", $last, $text);
    if ($userID!="") {
        $text = str_replace_first("<!--COMMENTEDIT-->", readFileContent("templates/commentedit.txt"), $text);
    }
    $text = str_replace("<!--PAGEID-->", $id[2], $text); //many entries

    echo $text;
    return;
}

$podstronyState = array();
$podstronyState["opowiadania"]=array("biblioteka","beta","archiwum");
$podstronyState["publicystyka"]=array("artykuly","felietony","poradniki");

// for example opowiadania/biblioteka
if (isset($_GET["q"]) && preg_match("/^([a-z]+)\/([a-z]+)(\/{1,1}[0-9]*)?$/", $_GET["q"], $id)) {
    if (isset($podstronyState[$id[1]]) && in_array($id[2], $podstronyState[$id[1]])) {
        $pageNum=0;
        if (isset($id[3])) {
            $pageNum = intval(substr($id[3], 1, strlen($id[3])-1));
        }
        $list = GetPagesList($pageNum, array($id[2]), $podstronyType[$id[1]], array("inne","scifi"), "");
    } else {
        header('Location: '.$_SERVER['PHP_SELF']);
        exit(0);
    }

    $text = readFileContent("templates/list.txt");
    $text = genericReplace($text, $userID);
    $text = str_replace_first("<!--TITLE-->", "", $text);

    if (!empty($list)) {
        $template0 = readFileContent("templates/listentry.txt");
        $txt="";
        foreach($list as $fileName => $arr) {
            $template = $template0;
            $template = str_replace_first("<!--USER-->", $arr["Author"], $template);
            $template = str_replace_first("<!--TITLE-->", "<a href=\"?q=".$id[1]."/pokaz/$fileName\">".$arr["Title"]."</a>", $template);
            $template = str_replace_first("<!--TYPE-->", $arr["Type"], $template);
            $template = str_replace_first("<!--SPECIES-->", $arr["Species"], $template);
            $template = str_replace_first("<!--WHEN-->", date("d M Y H:i:s", $arr["When"]), $template);
            $txt = $txt.$template;
        }
        $text = str_replace_first("<!--LIST-->", $txt, $text);
    }
    $text = str_replace_first("<!--NEXTLINK-->", "<a href=?q=".$id[1]."/".$id[2]."/".($pageNum-1).">Prev page</a><a href=?q=".$id[1]."/".$id[2]."/".($pageNum+1).">Next page</a>", $text);

    echo $text;
    return;
}

if (isset($_POST["q"]) && $_POST["q"]=="upload_comment" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
    //checking for login
    //checking for correct filename protection
    if (file_exists("teksty/".$_POST["tekst"].".txt")) {
        $handle = @fopen("teksty/".$_POST["tekst"].".txt", "a");
        //checking for <!--comment--> and others
        //saving pictures separately
        fwrite($handle, "\n<!--comment-->\nTitle:ala\nWhen:".date("d M Y H:i:s", time())."\nAuthor:marcin\n\n".rawurldecode($_POST["comment"]));
        fclose($handle);
    }

    exit(0);
}


/*if (isset($_POST["q"]) && $_POST["q"]=="get_page_updates" && isset($_POST["tekstID"]) && isset($_POST["lastUpdate"])) {
        $handle = @fopen("log", "a");
        fwrite($handle, $_POST["q"]."-".$_POST["tekstID"]."-".$_POST["lastUpdate"]);
        fclose($handle);
    $arr = decodeFileContent(readFileContent("teksty/".$_POST["tekstID"].".txt"), false);
        $txt = "";
$last = $_POST["lastUpdate"];
    if (isset($arr["Comments"])) {
        $template0 = readFileContent("templates/comment.txt");
        foreach($arr["Comments"] as $comment) {
if ($comment["When"]>$last) $last = $comment["When"];
        if ($comment["When"]<=$_POST["lastUpdate"]) continue;
            $template = $template0;
            $template = str_replace_first("<!--USER-->", $comment["Author"], $template);
            $template = str_replace_first("<!--TITLE-->", $comment["Title"], $template);
            $template = str_replace_first("<!--WHEN-->", $comment["When"], $template);
            $template = str_replace_first("<!--TEXT-->", $comment["Text"], $template);

            $txt = $txt.$template;
        }
    
    }
    if ($txt !="") {
// of course create JSON here
//    echo("document.getElementById(\"newcomments\").innerHTML = ".
//"document.getElementById(\"newcomments\").innerHTML+
    echo(rawurlencode($txt));
//    echo("lastUpdate = $last;");
    }
    return;
}
*/


if (isset($_POST["q"]) && $_POST["q"]=="upload_new_page" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
}
if (isset($_POST["q"]) && $_POST["q"]=="edit_page" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
}
if (isset($_POST["q"]) && $_POST["q"]=="new_user" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
}
if (isset($_POST["q"]) && $_POST["q"]=="edit_user" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
}
// profil/1234
if (isset($_GET["q"]) && preg_match("/^profil\/([0-9\-]+)$/", $_GET["q"], $id)) {
}






if (isset($_POST["logout"]) && $userID!="") {
    $db = new SQLite3("session.db");
    $db->busyTimeout(5000);
    $db->exec(
        "CREATE TABLE IF NOT EXISTS sessions(expire INTEGER, userID TEXT, token TEXT, salt TEXT);".
        "delete from sessions where expire < ".time()." OR token=".$_COOKIE["login"].";"
    );
    setcookie("login", "", time() - 3600);
    $db->close();
    exit(0);
} else if (isset($_POST["login"]) && isset($_POST["user"]) && isset($_POST["password"]) && $userID=="") {
    $db = new SQLite3("session.db");
    $db->busyTimeout(5000);
    $db->exec(
        "CREATE TABLE IF NOT EXISTS sessions(expire INTEGER, userID TEXT, token TEXT, salt TEXT);".
        "delete from sessions where expire < ".time().";"
    );

    $statement = $db->prepare(
        "SELECT salt from sessions where salt <> ''"
    );
    $result = $statement->execute();
    while ($row = $result->fetchArray()) {
        foreach (scandir("uzytkownicy", 0) as $file) {
            if (is_file("uzytkownicy/$file") && preg_match("/^(.*)\.txt/", $file, $fileNameArray)) {
                $arr = decodeFileContent2(readFileContent("uzytkownicy/$file"), true);
                $usr = hash('sha256', $row['salt'].$arr["Author"]);
                if ($usr != $_POST["user"]) { continue;
                }
                $pass = hash('sha256', $row['salt'].$arr["Password"]);
                if ($pass==$_POST["password"]) {
                    $salt = random_int(0, PHP_INT_MAX-1);
                    $exp = (time()+(1 * 24 * 60 * 60));
                    $db->exec(
                        "UPDATE sessions SET expire=".$exp.", userID='".$file."',token='".$salt."',salt=''".
                        "where salt=".$row['salt']
                    );
                    setcookie("login", $salt, $exp, "/");
                    $db->close();
                    exit(0);
                }
            }
        }
    }
    $db->close();
    header('HTTP/1.1 404 Not Found');
    exit(0);
}

$text = readFileContent("templates/main.txt");
$text = str_replace_first("<!--TITLE-->", "", $text);
$text = genericReplace($text, $userID);
echo $text;

?>
