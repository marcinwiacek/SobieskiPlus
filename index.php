<?php

//filesystem limit for one folder
$gMaxPerFolder=10000000;

$gEntryPerPage = 10;

$podstronyType = array();
$podstronyType["opowiadania"]=array("opowiadanie","szort");
$podstronyType["publicystyka"]=array("artykul","felieton");

$podstronyState = array();
$podstronyState["opowiadania"]=array("biblioteka","beta","archiwum");
$podstronyState["publicystyka"]=array("artykuly","felietony","poradniki");

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
                $arr["Text"]="";
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

// PUSH functionality
//check field format
//check if session is OK
if (isset($_GET["fileid"]) && file_exists("teksty/".$_GET["fileid"].".txt")) {
    //session_write_close();
    ignore_user_abort(false);
    set_time_limit(60);//1 minute
    header('Content-Type: text/event-stream');
    header('Cache-Control: no-cache');

    //        $handle = @fopen("log", "a");
    //        fwrite($handle, "wchodze");
    //        fclose($handle);

    $template0 = readFileContent("internal/comment.txt");
    clearstatcache();
    $t = filemtime("teksty/".$_GET["fileid"].".txt");
    $arr = decodeFileContent(readFileContent("teksty/".$_GET["fileid"].".txt"), false);

    $num=0;
    if (isset($arr["Comments"])) { $num = count($arr["Comments"]);
    }

    echo "data:\n\n";
    ob_flush();
    flush();

    while (true) {
        clearstatcache();
        if ($t != filemtime("teksty/".$_GET["fileid"].".txt")) {
            $arr = decodeFileContent(readFileContent("teksty/".$_GET["fileid"].".txt"), false);
            if (isset($arr["Comments"])) {
                for ($i=$num;$i<count($arr["Comments"]);$i++) {
                    $comment = $arr["Comments"][$i];
                    $template = $template0;
                    $template = str_replace_first("<!--USER-->", $comment["Author"], $template);
                    $template = str_replace_first("<!--TITLE-->", $comment["Title"], $template);
                    $template = str_replace_first("<!--WHEN-->", date("d M Y H:i:s", $comment["When"]), $template);
                    $template = str_replace_first("<!--TEXT-->", $comment["Text"], $template);
                    echo "data: ".rawurlencode($template)."\n\n";
                }
                $num = count($arr["Comments"]);
            }
            ob_flush();
            flush();
            if (connection_aborted()==1) { break;
            }
            $t = filemtime("teksty/".$_GET["fileid"].".txt");
        }
        sleep(1);
    }
    exit(0);
}

abstract class SortLevel
{
    const DateSort = 1;
    const CommentsNumSort = 2;
    const AuthorSort = 3;
}

function GetPagesList($pageNum, $stateList, $typeList, $speciesList, $taxonomy, $sortLevel) 
{
    global $gEntryPerPage;

    $files = array();
    $i=0;

    if (file_exists("internal/test.db")) {
        $t = "whentime desc";
        switch ($sortLevel) {
        case SortLevel::DateSort:
            break;
        case SortLevel::CommentsNumSort:
            $t="commentsNum desc";
            break;
        case SortLevel::AuthorSort:
            $t = "author";
            break;
        }

        $db = new SQLite3("internal/test.db");
        $db->busyTimeout(5000);
        $statement = $db->prepare(
            "SELECT mod, filename, title, whentime, ".
            "state, type, species,taxonomy,author,commentsNum FROM pages ORDER by ".$t
        );
        $result = $statement->execute();
        while ($row = $result->fetchArray()) {
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
    $text = str_replace_first("<!--WHEN-->", date("d M Y H:i:s", $arr["When"]), $text);

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

    if ($userID!="") {
        $text = str_replace_first("<!--LOGIN-EDIT-->", "<div align=right><a href=?q=".$_GET["q"]."/edit>Edycja</a></div>", $text);
    }

    echo $text;
    return;
}

//opowiadania/biblioteka/add
if (isset($_GET["q"]) && preg_match("/^([a-z]+)\/([a-z]+)\/add$/", $_GET["q"], $id)) {
    if (isset($podstronyState[$id[1]]) && in_array($id[2], $podstronyState[$id[1]])) {
        $text = readFileContent("internal/entryedit.txt");
        $text = genericReplace($text, $userID);
        //    $text = str_replace_first("<!--TEXT-->", $arr["Text"], $text);
        $text = str_replace("<!--PAGEID-->", "0", $text); //many entries

        $txt = "";
        foreach($podstronyState[$id[1]] as $state) {
            $txt=$txt."<input type=\"radio\" name=\"state\" value=\"$state\"";
            if ($id[2] == $state) { $txt=$txt." checked";
            }
            $txt=$txt."><label for=\"$state\">$state</label>";
        }
        $txt=$txt."<p>";
        $text = str_replace_first("<!--STATE-->", $txt, $text);

        $txt = "";
        foreach($podstronyType[$id[1]] as $type) {
            $txt=$txt."<input type=\"radio\" name=\"type\" value=\"$type\">";
            $txt=$txt."<label for=\"$type\">$type</label>";
            //  $txt=$txt."<input type=\"checkbox\" name=\"type\" value=\"$type\">$type";
        }
        $txt=$txt."<p>";
        $text = str_replace_first("<!--TYPE-->", $txt, $text);

        echo $text;
        return;
    }
}
//opowiadania/1234/edit
if (isset($_GET["q"]) && preg_match("/^([a-z]+)\/pokaz\/([0-9\-]+)\/edit$/", $_GET["q"], $id)) {
    if (!isset($podstronyType[$id[1]])) {
        header('Location: '.$_SERVER['PHP_SELF']);
        exit(0);
    }

    $arr = decodeFileContent(readFileContent("teksty/".$id[2].".txt"), false);
    if (!in_array($arr["Type"], $podstronyType[$id[1]])) { 
        header('Location: '.$_SERVER['PHP_SELF']);
        exit(0);
    }

    $text = readFileContent("internal/entryedit.txt");
    $text = genericReplace($text, $userID);
    $text = str_replace_first("<!--TEXT-->", $arr["Text"], $text);
    $text = str_replace("<!--PAGEID-->", $id[2], $text); //many entries
    $text = str_replace("<!--TITLE-->", $arr["Title"], $text); //many entries

    $txt = "";
    foreach($podstronyState[$id[1]] as $state) {
        $txt=$txt."<input type=\"radio\" name=\"state\" value=\"$state\"";
        if ($arr["State"] == $state) { $txt=$txt." checked";
        }
        $txt=$txt."><label for=\"$state\">$state</label>";
    }
    $txt=$txt."<p>";
    $text = str_replace_first("<!--STATE-->", $txt, $text);

    $txt = "";
    foreach($podstronyType[$id[1]] as $type) {
        $txt=$txt."<input type=\"radio\" name=\"type\" value=\"$type\"";
        if ($arr["Type"] == $type) { $txt=$txt." checked";
        }
        $txt=$txt."><label for=\"$type\">$type</label>";
        //  $txt=$txt."<input type=\"checkbox\" name=\"type\" value=\"$type\">$type";
    }
    $txt=$txt."<p>";
    $text = str_replace_first("<!--TYPE-->", $txt, $text);

    echo $text;
    return;
}

// for example opowiadania/biblioteka
if (isset($_GET["q"]) && preg_match("/^([a-z]+)\/([a-z]+)(\/{1,1}[0-9]*)?$/", $_GET["q"], $id)) {
    if (isset($podstronyState[$id[1]]) && in_array($id[2], $podstronyState[$id[1]])) {
        if (isset($_GET["t"])) {
            if (!in_array($_GET["t"], $podstronyType[$id[1]])) {
                header('Location: '.$_SERVER['PHP_SELF']);
                exit(0);
            }
            $typ = $_GET["t"];
        } else {
            $typ="";
        }
        $sortLevel = SortLevel::DateSort;
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

        $pageNum=0;
        if (isset($id[3])) {
            $pageNum = intval(substr($id[3], 1, strlen($id[3])-1));
        }
        $list = GetPagesList(
            $pageNum, 
            array($id[2]), 
            ($typ=="")?$podstronyType[$id[1]]:array($typ), 
            array("inne","scifi"), 
            "",
            $sortLevel
        );
    } else {
        header('Location: '.$_SERVER['PHP_SELF']);
        exit(0);
    }

    $text = readFileContent("internal/list.txt");
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

    $txt = "";
    if (isset($_GET["s"])) { $txt = "&s=".$_GET["s"];
    }
    if (isset($_GET["t"])) { $txt = $txt."&t=".$_GET["t"];
    }
    $text = str_replace_first(
        "<!--NEXTLINK-->", 
        "<a href=?q=".$id[1]."/".$id[2]."/".($pageNum-1)."$txt>&lt; Prev page</a>&nbsp;".
        "<a href=?q=".$id[1]."/".$id[2]."/".($pageNum+1)."$txt>Next page &gt;</a>", $text
    );

    if ($userID!="") {
        $text = str_replace_first("<!--LOGIN-NEW-->", "<div align=right><a href=?q=".$_GET["q"]."/add>Nowy tekst</a></div>", $text);
    }

    echo $text;
    return;
}

if (isset($_POST["q"]) && $_POST["q"]=="upload_comment" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
    //checking for login
    //checking for correct filename protection
    if (file_exists("teksty/".$_POST["tekst"].".txt")) {
        $t = time();
        $handle = @fopen("teksty/".$_POST["tekst"].".txt", "a");
        //checking for <!--comment--> and others
        //saving pictures separately
        fwrite(
            $handle, "\n<!--comment-->\n".
            "Title:ala\n".
            "When:".date("d M Y H:i:s", $t)."\n".
            "Author:marcin\n\n".
            rawurldecode($_POST["comment"])
        );
        fclose($handle);

        $arr = decodeFileContent(readFileContent("teksty/".$_POST["tekst"].".txt"), false);

        $cn = 0;
        if (isset($arr["Comments"])) {
            $cn = count($arr["Comments"]);
        }
        $arr["CommentsNum"] = $cn;

        $db = new SQLite3("internal/test.db");
        $db->busyTimeout(5000);
        $db->exec('PRAGMA journal_mode = wal;');
        $db->exec(
            "CREATE TABLE IF NOT EXISTS pages(mod INTEGER, filename TEXT, title TEXT, whentime TEXT, ".
            "state TEXT, type TEXT, species TEXT, taxonomy TEXT, author TEXT, commentsNum INTEGER)"
        );
        $db->exec(
            "UPDATE pages SET mod=".filemtime("teksty/".$_POST["tekst"].".txt").
                    ",whentime='".$t.
                    "',commentsNum=".$cn.
                    " WHERE filename='".$_POST["tekst"]."'"
        );
        $db->exec('COMMIT');
        $db->close();
    }

    exit(0);
}
if (isset($_POST["q"]) && $_POST["q"]=="change_text"  && isset($_POST["title"])    
    && isset($_POST["tekst"]) && isset($_POST["text"])      && isset($_POST["state"]) && isset($_POST["type"])
) {
    //checking for login
    //checking for correct filename protection
    if ($_POST["tekst"] == "0") {
        //fixme - when two users trying to use the same in the same time
        $id=1;
        while(1) {
            if (!file_exists("teksty/$id.txt")) {
                $handle = @fopen("teksty/$id.txt", "a");
                fwrite(
                    $handle, 
                    "Title:".$_POST["title"]."\n".
                    "State:".$_POST["state"]."\n".
                    "Type:".$_POST["type"]."\n".
                    "Species:inne\n".
                    "Taxonomy:inne\n".
                    "When:".date("d M Y H:i:s", time())."\n".
                    "Author:marcin\n\n".
                    rawurldecode($_POST["text"])
                );
                fclose($handle);

                $db = new SQLite3("internal/test.db");
                $db->busyTimeout(5000);
                $db->exec('PRAGMA journal_mode = wal;');
                $db->exec(
                    "CREATE TABLE IF NOT EXISTS pages(mod INTEGER, filename TEXT, title TEXT, whentime TEXT, ".
                    "state TEXT, type TEXT, species TEXT, taxonomy TEXT, author TEXT, commentsNum INTEGER)"
                );
                $db->exec('BEGIN');
                $arr = decodeFileContent(readFileContent("teksty/$id.txt"), false);

                $cn = 0;
                if (isset($arr["Comments"])) {
                      $cn = count($arr["Comments"]);
                }
                $arr["CommentsNum"] = $cn;

                $db->exec(
                    "INSERT INTO pages(mod, filename, title, whentime, state, type, species, taxonomy, author, commentsNum) ".
                    "VALUES(".filemtime("teksty/$id.txt").",'".$id."','".$arr["Title"]."','".
                    $arr["When"]."','".$arr["State"]."','".$arr["Type"]."','".$arr["Species"]."','".
                    $arr["Taxonomy"]."','".$arr["Author"]."',".$cn.")"
                );
                $db->exec('COMMIT');
                $db->close();

                echo $id;
                exit(0);            
            }
            $id++;
        }
    }
    if (file_exists("teksty/".$_POST["tekst"].".txt")) {
        $t = time();
        $handle = @fopen("teksty/".$_POST["tekst"].".txt", "a");
        //checking for <!--comment--> and others
        //saving pictures separately
        fwrite(
            $handle, "\n<!--change-->\n".
            "Title:".$_POST["title"]."\n".
            "State:".$_POST["state"]."\n".
            "Type:".$_POST["type"]."\n".
            "When:".date("d M Y H:i:s", $t)."\n".
            "Author:marcin\n\n".
            rawurldecode($_POST["text"])
        );
        fclose($handle);

        $db = new SQLite3("internal/test.db");
        $db->busyTimeout(5000);
        $db->exec('PRAGMA journal_mode = wal;');
        $db->exec(
            "CREATE TABLE IF NOT EXISTS pages(mod INTEGER, filename TEXT, title TEXT, whentime TEXT, ".
            "state TEXT, type TEXT, species TEXT, taxonomy TEXT, author TEXT, commentsNum INTEGER)"
        );
        $db->exec('BEGIN');
        $db->exec(
            "UPDATE  pages SET mod=".filemtime("teksty/".$_POST["tekst"].".txt").
                    ",whentime='".$t.
                    "',title='".$_POST["title"].
                    "',state='".$_POST["state"].
                    "',type='".$_POST["type"]."' WHERE filename='".$_POST["tekst"]."'"
        );
        $db->exec('COMMIT');
        $db->close();
    }

    exit(0);
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
