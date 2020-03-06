<?php

//filesystem limit for one folder
$gMaxPerFolder=10000000;

$gEntryPerPage = 10;

require "internal/shared.php";

function GetPagesList($pageNum, $stateList, $typeList, $speciesList, $taxonomy) 
{
    global $gEntryPerPage;

    $files = array();
    $i=0;

    if (file_exists("internal/test.db")) {
        $db = new SQLite3("internal/test.db");
        $db->busyTimeout(5000);
        $statement = $db->prepare(
            "SELECT mod, filename, title, whentime, ".
            "state, type, species,taxonomy,author,commentsNum FROM pages ORDER by whentime"
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
            $arr["CommentsNum"]=$row["commentsNum"];
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

    $db = new SQLite3("internal/test.db");
    $db->busyTimeout(5000);
    $db->exec('PRAGMA journal_mode = wal;');
    $db->exec(
        "CREATE TABLE IF NOT EXISTS pages(mod INTEGER, filename TEXT, title TEXT, whentime TEXT, ".
        "state TEXT, type TEXT, species TEXT, taxonomy TEXT, author TEXT, commentsNum INTEGER)"
    );
    $db->exec('BEGIN');
    foreach (scandir("teksty", 0) as $file) {
        if (is_file("teksty/$file") && preg_match("/^(.*)\.txt/", $file, $fileNameArray)) {
            $arr = decodeFileContent(readFileContent("teksty/".$fileNameArray[1].".txt"), false);

            $cn = 0;
            if (isset($arr["Comments"])) {
                      $cn = count($arr["Comments"]);
            }
            $arr["CommentsNum"] = $cn;

            $db->exec(
                "INSERT INTO pages(mod, filename, title, whentime, state, type, species, taxonomy, author, commentsNum) ".
                "VALUES(".filemtime("teksty/".$fileNameArray[1].".txt").",'".$fileNameArray[1]."','".$arr["Title"]."','".
                $arr["When"]."','".$arr["State"]."','".$arr["Type"]."','".$arr["Species"]."','".
                $arr["Taxonomy"]."','".$arr["Author"]."',".$cn.")"
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
    $text = str_replace_first("<!--MENU-->", readFileContent("internal/menu.txt"), $text);
    $text = str_replace_first("<!--JS-->", readFileContent("internal/js.txt"), $text);
    if ($userID!="") {
        $text = str_replace_first("<!--LOGIN-LOGOUT-->", readFileContent("internal/logout.txt"), $text);
    } else {
        $text = str_replace_first("<!--LOGIN-LOGOUT-->", readFileContent("internal/login.txt"), $text);

        $db = new SQLite3("internal/session.db");
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
    $db = new SQLite3("internal/session.db");
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

    $text = readFileContent("internal/entry.txt");
    $text = genericReplace($text, $userID);
    $text = str_replace("<!--TITLE-->", $arr["Title"], $text); // multiple instances
    $text = str_replace_first("<!--USER-->", $arr["Author"], $text);
    $text = str_replace_first("<!--TEXT-->", $arr["Text"], $text);
    $text = str_replace_first("<!--TYPE-->", $arr["Type"], $text);
    $text = str_replace_first("<!--SPECIES-->", $arr["Species"], $text);
    $last = $arr["When"];
    if (isset($arr["Comments"])) {
        $template0 = readFileContent("internal/comment.txt");
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
        $text = str_replace_first("<!--COMMENTEDIT-->", readFileContent("internal/commentedit.txt"), $text);
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

    $text = readFileContent("internal/list.txt");
    $text = genericReplace($text, $userID);
    $text = str_replace_first("<!--TITLE-->", "", $text);

    $template = readFileContent("internal/criteria.txt");
    $txt = "";
    foreach($podstronyType[$id[1]] as $t) {
        $txt = $txt.$t.", ";
    }
    $template = str_replace_first("<!--TYPE-->", $txt, $template);
    $txt = "";
    foreach($podstronyState[$id[1]] as $t) {
        $txt = $txt.$t.", ";
    }
    $template = str_replace_first("<!--STATE-->", $txt, $template);
    $template = str_replace_first("<!--SORTBY-->", "Data", $template);
    $text = str_replace_first("<!--CRITERIA-->", $template, $text);

    if (!empty($list)) {
        $template0 = readFileContent("internal/listentry.txt");
        $txt="";
        foreach($list as $fileName => $arr) {
            $template = $template0;
            $template = str_replace_first("<!--USER-->", $arr["Author"], $template);
            $template = str_replace_first("<!--TITLE-->", "<a href=\"?q=".$id[1]."/pokaz/$fileName\">".$arr["Title"]."</a>", $template);
            $template = str_replace_first("<!--TYPE-->", $arr["Type"], $template);
            $template = str_replace_first("<!--SPECIES-->", $arr["Species"], $template);
            $template = str_replace_first("<!--COMMENTSNUM-->", $arr["CommentsNum"], $template);
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
        fwrite(
            $handle, "\n<!--comment-->\n".
            "Title:ala\n".
            "When:".date("d M Y H:i:s", time())."\n".
            "Author:marcin\n\n".
            rawurldecode($_POST["comment"])
        );
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
        $template0 = readFileContent("internal/comment.txt");
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
    $db = new SQLite3("internal/session.db");
    $db->busyTimeout(5000);
    $db->exec(
        "CREATE TABLE IF NOT EXISTS sessions(expire INTEGER, userID TEXT, token TEXT, salt TEXT);".
        "delete from sessions where expire < ".time()." OR token=".$_COOKIE["login"].";"
    );
    setcookie("login", "", time() - 3600);
    $db->close();
    exit(0);
} else if (isset($_POST["login"]) && isset($_POST["user"]) && isset($_POST["password"]) && $userID=="") {
    $db = new SQLite3("internal/session.db");
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

$text = readFileContent("internal/main.txt");
$text = str_replace_first("<!--TITLE-->", "", $text);
$text = genericReplace($text, $userID);
echo $text;

?>
